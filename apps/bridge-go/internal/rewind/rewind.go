// Package rewind restores a session's files to a turn boundary through
// grok-build's own per-prompt file checkpoints. grok-build records, for every
// user prompt, the pre-edit and post-edit content of each file its edit tools
// touch (`rewind_points.jsonl` in the session folder) and exposes two ACP
// extension methods over `grok agent stdio`:
//
//   - `_x.ai/rewind/points` {sessionId} → {rewind_points: [{prompt_index,
//     created_at, num_file_snapshots, has_file_changes, prompt_preview}]}
//   - `_x.ai/rewind/execute` {sessionId, targetPromptIndex, mode, force} →
//     {success, reverted_files, clean_files, conflicts[{path, conflict_type}],
//     error}. mode is one of all / conversation_only / code_only / files_only.
//
// The bridge only uses mode `files_only` (the conversation is kept). Without
// force, grok-build never writes: it answers success=false with the files it
// would restore (clean_files) and those changed outside the agent since its
// last edit (conflicts, plus an error asking to confirm). With force it
// applies the restore and overwrites conflicts. Execute treats a non-force
// answer without conflicts as that confirmation gate and applies at once —
// the user already confirmed the file list in the desktop dialog — so only
// outside edits need the explicit force. No parallel checkpoint store is kept.
//
// One gap is filled on the bridge side: when the client serves `fs/*`
// (as this bridge does), grok-build restores modified files through
// fs/write_text_file but has no ACP call to delete a file the rewound turns
// created — it reports the file as reverted and leaves it on disk. Execute
// therefore reads the checkpoint file before the call to learn which paths did
// not exist at the target boundary and removes those that are still present
// after a successful rewind (confined to the session workspace).
package rewind

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// Mode is the only rewind mode the bridge requests: restore files, keep chat.
const Mode = "files_only"

// RequestFunc sends one ACP extension request on the session's connection and
// returns the decoded JSON result (map[string]any for objects). Implemented
// by PooledRuntime.XaiRequest; tests pass a fake.
type RequestFunc func(method string, params map[string]any) (any, error)

// Point is one rewind boundary: the state right before user prompt
// PromptIndex (0-based, counted over the whole session) was sent.
type Point struct {
	// PromptIndex is grok-build's 0-based prompt ordinal (the rewind target).
	PromptIndex int `json:"promptIndex"`
	// Preview is the prompt text prefix grok-build shows (≈57 chars + "...").
	Preview string `json:"preview"`
	// CreatedAt is the RFC 3339 time the prompt started ("" once rewound).
	CreatedAt string `json:"createdAt"`
	// FileCount is the number of file snapshots held for this prompt.
	FileCount int `json:"fileCount"`
	// HasFileChanges is false when the prompt edited nothing (or was rewound).
	HasFileChanges bool `json:"hasFileChanges"`
}

// Conflict is a file changed outside the agent after the agent last wrote it.
type Conflict struct {
	// Path as grok-build reports it (workspace-relative when inside cwd).
	Path string `json:"path"`
	// Type is modified_externally / created_externally / deleted_externally.
	Type string `json:"type"`
}

// Result is the normalized outcome of one files-only rewind.
type Result struct {
	// Success is true when grok-build applied the rewind.
	Success bool `json:"success"`
	// TargetPromptIndex echoes the requested boundary.
	TargetPromptIndex int `json:"targetPromptIndex"`
	// RevertedFiles were restored (or removed) by the rewind.
	RevertedFiles []string `json:"revertedFiles"`
	// CleanFiles would revert without overwriting outside edits (refusals only).
	CleanFiles []string `json:"cleanFiles"`
	// Conflicts lists files changed outside the agent since its last edit.
	Conflicts []Conflict `json:"conflicts"`
	// DeletedFiles were created by the rewound turns and removed by the bridge.
	DeletedFiles []string `json:"deletedFiles"`
	// Warnings are non-fatal bridge-side problems (a delete that failed, …).
	Warnings []string `json:"warnings"`
	// Error is grok-build's refusal text ("" on success).
	Error string `json:"error,omitempty"`
}

// ExecuteOptions configures Execute.
type ExecuteOptions struct {
	// SessionID is the live grok-build session (required).
	SessionID string
	// Cwd is the session workspace; relative paths resolve against it and the
	// delete shim never touches anything outside it. "" disables the shim.
	Cwd string
	// SessionDir is the grok-build session folder holding rewind_points.jsonl;
	// "" disables the delete shim (modified files are still restored).
	SessionDir string
	// TargetPromptIndex is the boundary to restore to (must be ≥ 0).
	TargetPromptIndex int
	// Force overwrites files changed outside the agent (user confirmed).
	Force bool
}

// ListPoints fetches the session's rewind boundaries.
// @param req Extension request sender for the session.
// @param sessionID Live session id (required).
// @returns Points in grok-build order, or the transport / agent error.
func ListPoints(req RequestFunc, sessionID string) ([]Point, error) {
	if req == nil {
		return nil, errors.New("rewind is not available for this session")
	}
	if strings.TrimSpace(sessionID) == "" {
		return nil, errors.New("sessionId is required")
	}
	raw, err := req("_x.ai/rewind/points", map[string]any{"sessionId": sessionID})
	if err != nil {
		return nil, fmt.Errorf("rewind points: %w", err)
	}
	return normalizePoints(raw), nil
}

// Execute restores files to the state right before prompt TargetPromptIndex
// (undoing that turn and every later one) and completes deletions of files
// those turns created. Without Force, a gate answer with no conflicts is
// re-sent with force (see the package doc); a refusal with conflicts comes
// back as a Result with Success false — not as an error — so the caller can
// show it and ask before forcing.
// @param req Extension request sender for the session.
// @param opts Session, workspace, checkpoint folder, target and force flag.
// @returns Normalized result; error only for bad input or transport failures.
func Execute(req RequestFunc, opts ExecuteOptions) (Result, error) {
	if req == nil {
		return Result{}, errors.New("rewind is not available for this session")
	}
	if strings.TrimSpace(opts.SessionID) == "" {
		return Result{}, errors.New("sessionId is required")
	}
	if opts.TargetPromptIndex < 0 {
		return Result{}, fmt.Errorf("invalid targetPromptIndex %d", opts.TargetPromptIndex)
	}
	absent, shimErr := absentForOptions(opts)
	raw, err := sendExecute(req, opts, opts.Force)
	if err != nil {
		return Result{}, err
	}
	if !opts.Force && isConfirmGate(raw) {
		if raw, err = sendExecute(req, opts, true); err != nil {
			return Result{}, err
		}
	}
	res := normalizeResult(raw, opts.TargetPromptIndex)
	if !res.Success {
		return res, nil
	}
	if shimErr != nil {
		res.Warnings = append(res.Warnings, fmt.Sprintf("could not read checkpoints to remove created files: %v", shimErr))
		return res, nil
	}
	res.DeletedFiles, res.Warnings = removeCreatedFiles(opts.Cwd, res.RevertedFiles, absent, res.Warnings)
	return res, nil
}

// sendExecute sends one `_x.ai/rewind/execute` request.
// @param req Extension request sender.
// @param opts Session and target.
// @param force Value of the force flag for this request.
// @returns Raw result, or the wrapped transport error.
func sendExecute(req RequestFunc, opts ExecuteOptions, force bool) (any, error) {
	raw, err := req("_x.ai/rewind/execute", map[string]any{
		"sessionId":         opts.SessionID,
		"targetPromptIndex": opts.TargetPromptIndex,
		"mode":              Mode,
		"force":             force,
	})
	if err != nil {
		return nil, fmt.Errorf("rewind: %w", err)
	}
	return raw, nil
}

// isConfirmGate reports grok-build's non-force answer that only asks for
// confirmation: not applied, no conflicts, no error text, something to restore.
// @param raw Raw execute result.
// @returns True when re-sending with force overwrites nothing outside the agent.
func isConfirmGate(raw any) bool {
	m, ok := raw.(map[string]any)
	if !ok || toBool(m["success"]) || toString(m["error"]) != "" {
		return false
	}
	conflicts, _ := m["conflicts"].([]any)
	return len(conflicts) == 0 && len(toStrings(pick(m, "clean_files", "cleanFiles"))) > 0
}

// absentForOptions loads the created-by-the-turns path set when the shim is
// enabled (both Cwd and SessionDir set).
// @param opts Execute options.
// @returns Absent set (empty when disabled) and the read error, if any.
func absentForOptions(opts ExecuteOptions) (map[string]bool, error) {
	if opts.Cwd == "" || opts.SessionDir == "" {
		return map[string]bool{}, nil
	}
	return AbsentAtTarget(filepath.Join(opts.SessionDir, CheckpointFile), opts.TargetPromptIndex)
}

// removeCreatedFiles deletes reverted paths that did not exist at the target
// boundary and are still on disk. Only regular files and symlinks inside cwd
// are removed; directories and anything outside the workspace are left alone.
// @param cwd Session workspace (absolute).
// @param reverted Paths grok-build reported as reverted.
// @param absent Normalized paths that did not exist at the boundary.
// @param warnings Existing warnings to append to.
// @returns Removed paths (as reported) and the updated warnings.
func removeCreatedFiles(cwd string, reverted []string, absent map[string]bool, warnings []string) ([]string, []string) {
	deleted := []string{}
	for _, p := range reverted {
		if !absent[normalizeKey(p)] {
			continue
		}
		abs, ok := resolveInside(cwd, p)
		if !ok {
			warnings = append(warnings, fmt.Sprintf("left %s in place: outside the workspace", p))
			continue
		}
		info, err := os.Lstat(abs)
		if err != nil {
			continue // already gone
		}
		if info.IsDir() {
			warnings = append(warnings, fmt.Sprintf("left %s in place: it is a directory", p))
			continue
		}
		if err := os.Remove(abs); err != nil {
			warnings = append(warnings, fmt.Sprintf("could not remove %s: %v", p, err))
			continue
		}
		deleted = append(deleted, p)
	}
	return deleted, warnings
}

// resolveInside maps a reported path onto an absolute path inside cwd.
// @param cwd Workspace root.
// @param p Relative (to cwd) or absolute path.
// @returns Absolute path and true when it lies strictly inside cwd.
func resolveInside(cwd, p string) (string, bool) {
	root := filepath.Clean(cwd)
	abs := filepath.FromSlash(p)
	if !filepath.IsAbs(abs) {
		abs = filepath.Join(root, abs)
	}
	abs = filepath.Clean(abs)
	rel, err := filepath.Rel(root, abs)
	if err != nil || rel == "." || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", false
	}
	return abs, true
}

// normalizeKey folds a reported path for comparison between the checkpoint
// file and the execute result (separators, `./`, duplicate slashes).
// @param p Path as grok-build wrote it.
// @returns Slash-separated cleaned path.
func normalizeKey(p string) string {
	return filepath.ToSlash(filepath.Clean(filepath.FromSlash(p)))
}
