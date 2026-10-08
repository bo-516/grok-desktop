package worktree

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"

	"github.com/xai-org/grok-desktop/apps/bridge-go/internal/spawn"
)

// Listed is one row of `grok worktree list --json`.
// Only the fields session start and Inspect need are decoded; extra CLI
// fields are ignored.
type Listed struct {
	// ID is the grok worktree id (`worktree rm` accepts it).
	ID string `json:"id"`
	// Path is the worktree directory grok created.
	Path string `json:"path"`
	// SourceRepo is the repository the worktree was created from.
	SourceRepo string `json:"source_repo"`
	// GitRef is the ref passed to create, often "HEAD" when --ref was omitted.
	GitRef string `json:"git_ref"`
	// Metadata carries the human label (the name, or the generated one).
	Metadata struct {
		// Label is the worktree name shown in `worktree show`.
		Label string `json:"label"`
	} `json:"metadata"`
}

// ShowFields is the useful subset of `grok worktree show` plain text.
// The CLI has no JSON flag for show; labels are matched on the text before
// the colon (`Source Repo`, `Path`, `ID`, `Label`, `Git Ref`).
type ShowFields struct {
	// Path is the worktree directory from the Path line.
	Path string
	// ID is the grok id from the ID line.
	ID string
	// SourceRepo is the Source Repo line.
	SourceRepo string
	// Label is the Label line (worktree name).
	Label string
	// GitRef is the Git Ref line. "HEAD" means the CLI default, not a branch name.
	GitRef string
}

// ParseCreatePath reads the directory `grok worktree create` printed.
// grok 1.0.46 prints a single absolute path on stdout and has no JSON flag.
// When stdout is a JSON object with `path` (or `worktree` / `worktreePath`),
// that value wins so a future JSON mode does not need a second parser.
// Otherwise the last absolute-path line wins, so a leading log line cannot
// hide the path and a trailing status line cannot replace it.
//
// @param stdout Raw stdout. Empty, relative-only, or JSON without a path errors.
// @returns Absolute path string as printed (not symlink-resolved). Error when
// nothing usable was printed — callers must not spawn in the source checkout.
func ParseCreatePath(stdout string) (string, error) {
	if path, ok := pathFromJSON(stdout); ok {
		return path, nil
	}
	found := ""
	for _, line := range strings.Split(stdout, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || !isAbsolutePath(line) {
			continue
		}
		found = line
	}
	if found == "" {
		return "", fmt.Errorf("worktree create did not return a path")
	}
	return found, nil
}

// pathFromJSON returns a path field when stdout is one JSON object.
// Arrays and plain text return false so the line scanner can run.
//
// @param stdout Raw stdout.
// @returns Path and true when a non-empty string field was present.
func pathFromJSON(stdout string) (string, bool) {
	parsed := spawn.TryParseJSON(stdout)
	fields, ok := parsed.(map[string]any)
	if !ok {
		return "", false
	}
	for _, key := range []string{"path", "worktreePath", "worktree"} {
		text, ok := fields[key].(string)
		if !ok {
			continue
		}
		text = strings.TrimSpace(text)
		if text != "" {
			return text, true
		}
	}
	return "", false
}

// isAbsolutePath reports whether a create stdout line is a directory path.
// filepath.IsAbs covers `C:\…` on Windows. A leading slash covers POSIX
// paths even if this helper is evaluated with a mismatched GOOS in tests.
//
// @param line One trimmed stdout line.
// @returns True when the line should be treated as the created directory.
func isAbsolutePath(line string) bool {
	if filepath.IsAbs(line) {
		return true
	}
	return strings.HasPrefix(line, "/")
}

// ParseShow reads `grok worktree show` plain text.
// Unknown lines are ignored. A missing label leaves that field empty;
// callers fall back to git and to the cwd they invoked create in.
//
// @param text Combined show stdout. Empty input returns zero fields.
// @returns Parsed labels. Never errors — show is a best-effort enrichment.
func ParseShow(text string) ShowFields {
	fields := ShowFields{}
	for _, line := range strings.Split(text, "\n") {
		key, value, ok := strings.Cut(strings.TrimSpace(line), ":")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		value = strings.TrimSpace(value)
		switch key {
		case "Path":
			fields.Path = value
		case "ID":
			fields.ID = value
		case "Source Repo":
			fields.SourceRepo = value
		case "Label":
			fields.Label = value
		case "Git Ref":
			fields.GitRef = value
		}
	}
	return fields
}

// DecodeList parses `grok worktree list --json`.
// A bare array is the 1.0.46 shape. An object with `worktrees`, `items`, or
// `data` is accepted so a wrapped payload still matches. Unparseable text
// returns nil — callers then try `worktree show`.
//
// @param stdout Raw list stdout.
// @returns Rows, or nil when stdout is not a list payload.
func DecodeList(stdout string) []Listed {
	trimmed := strings.TrimSpace(stdout)
	if trimmed == "" {
		return nil
	}
	var rows []Listed
	if err := json.Unmarshal([]byte(trimmed), &rows); err == nil {
		return rows
	}
	var wrapped map[string]json.RawMessage
	if err := json.Unmarshal([]byte(trimmed), &wrapped); err != nil {
		return nil
	}
	for _, key := range []string{"worktrees", "items", "data"} {
		raw, ok := wrapped[key]
		if !ok {
			continue
		}
		var nested []Listed
		if err := json.Unmarshal(raw, &nested); err == nil {
			return nested
		}
	}
	return nil
}

// MatchList finds the row whose path is the created worktree.
// Comparison is symlink-resolved so `/tmp/...` and `/private/tmp/...` match.
//
// @param stdout Raw `worktree list --json` stdout.
// @param path Worktree directory create printed.
// @returns The row and true, or the zero row and false when none match.
func MatchList(stdout, path string) (Listed, bool) {
	for _, row := range DecodeList(stdout) {
		if SamePath(row.Path, path) {
			return row, true
		}
	}
	return Listed{}, false
}
