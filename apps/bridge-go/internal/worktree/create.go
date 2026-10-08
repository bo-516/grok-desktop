package worktree

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/xai-org/grok-desktop/apps/bridge-go/internal/spawn"
)

// Create runs `grok worktree create` in the source repository and returns
// the new checkout's path, branch, and source repo.
// Failure (not a git repo, CLI error, no path, path equal to the source)
// returns an error and does not invent a fallback cwd. The caller must abort
// session start rather than spawn the agent in the main checkout.
//
// Branch comes from `git rev-parse --abbrev-ref HEAD` inside the new
// directory. Source repo prefers `worktree list --json`, then `worktree show`,
// then the toplevel Create was invoked in (that invocation cwd is the source
// by construction when the CLI created the directory there).
//
// @param req Name and ref may be empty. Cwd must be the source checkout.
// @returns Filled Info. Path is symlink-resolved and is never the source repo.
// Error leaves no agent process; a directory the CLI created before failing
// the parse may still exist (the CLI owns that cleanup).
func Create(req Request) (Info, error) {
	if err := rejectFlagToken("worktree name", req.Name); err != nil {
		return Info{}, err
	}
	if err := rejectFlagToken("worktree ref", req.Ref); err != nil {
		return Info{}, err
	}
	source, err := ensureGitRepo(req.Cwd)
	if err != nil {
		return Info{}, err
	}
	result, err := spawn.RunGrokCli(BuildCreateArgs(req.Name, req.Ref), source, createTimeoutMs)
	if err != nil {
		return Info{}, fmt.Errorf("worktree create failed: %w", err)
	}
	if err := spawn.AssertCliOk(result, "worktree create"); err != nil {
		return Info{}, err
	}
	rawPath, err := ParseCreatePath(result.Stdout)
	if err != nil {
		return Info{}, err
	}
	created := canonicalPath(rawPath)
	if created == "" || SamePath(created, source) {
		return Info{}, fmt.Errorf("worktree create returned the source checkout %s", rawPath)
	}
	stat, err := os.Stat(created)
	if err != nil || !stat.IsDir() {
		return Info{}, fmt.Errorf("worktree create reported %s but that directory is not available", rawPath)
	}
	info := Info{
		Path:       created,
		SourceRepo: source,
		Name:       req.Name,
	}
	if branch, err := gitAbbrevHead(created); err == nil && branch != "" {
		info.Branch = branch
	}
	enrichCreated(&info)
	if info.Branch == "" {
		info.Branch = "HEAD"
	}
	if info.Name == "" {
		info.Name = filepath.Base(info.Path)
	}
	return info, nil
}

// enrichCreated fills id, label, and canonical source from grok list/show.
// List is preferred because it is JSON. Show is the plain-text fallback.
// Neither failure changes Path: create already returned a directory. Source
// stays the invocation toplevel when both lookups miss.
//
// @param info In/out. Path must already be the created directory.
func enrichCreated(info *Info) {
	if info == nil || info.Path == "" {
		return
	}
	listed, err := spawn.RunGrokCli(
		[]string{"worktree", "list", "--json"},
		info.SourceRepo,
		listTimeoutMs,
	)
	if err == nil && listed.Code != nil && *listed.Code == 0 {
		if row, ok := MatchList(listed.Stdout, info.Path); ok {
			applyListed(info, row)
			return
		}
	}
	shown, err := spawn.RunGrokCli(
		[]string{"worktree", "show", info.Path},
		info.SourceRepo,
		listTimeoutMs,
	)
	if err != nil || shown.Code == nil || *shown.Code != 0 {
		return
	}
	applyShow(info, ParseShow(shown.Stdout))
}

// applyListed copies id, label, and source from a list row onto info.
// An empty source on the row does not wipe the invocation toplevel.
// GitRef replaces Branch only when git could not name a branch.
//
// @param info In/out identity. Nil is a no-op.
// @param row Matching list row.
func applyListed(info *Info, row Listed) {
	if info == nil {
		return
	}
	if row.ID != "" {
		info.ID = row.ID
	}
	if row.Metadata.Label != "" {
		info.Name = row.Metadata.Label
	}
	if row.SourceRepo != "" {
		info.SourceRepo = canonicalPath(row.SourceRepo)
	}
	if (info.Branch == "" || info.Branch == "HEAD") && row.GitRef != "" && row.GitRef != "HEAD" {
		info.Branch = row.GitRef
	}
}

// applyShow copies show labels onto info with the same empty-field rules
// as applyListed.
//
// @param info In/out identity. Nil is a no-op.
// @param fields Parsed show text.
func applyShow(info *Info, fields ShowFields) {
	if info == nil {
		return
	}
	if fields.ID != "" {
		info.ID = fields.ID
	}
	if fields.Label != "" && info.Name == "" {
		info.Name = fields.Label
	}
	if fields.SourceRepo != "" {
		info.SourceRepo = canonicalPath(fields.SourceRepo)
	}
	if (info.Branch == "" || info.Branch == "HEAD") && fields.GitRef != "" && fields.GitRef != "HEAD" {
		info.Branch = fields.GitRef
	}
}

// Inspect describes path for the new-chat option and the remove-worktree check.
// Not a git repository is IsRepo false, not an error. git status failure is
// an error so the desktop can refuse removal instead of guessing. A grok
// worktree copy (its own `.git` under `~/.grok/worktrees`) is resolved with
// `worktree list --json` when the path looks like one.
//
// @param path File or directory. A file inside a repo resolves via git to
// the toplevel. Empty path is not a repository.
// @returns Inspect result. Error only when a repo was found but status failed,
// or the path cannot be made absolute.
func Inspect(path string) (InspectResult, error) {
	trimmed := path
	if trimmed == "" {
		return InspectResult{IsRepo: false}, nil
	}
	abs, err := filepath.Abs(trimmed)
	if err != nil {
		return InspectResult{}, err
	}
	top, err := ensureGitRepo(abs)
	if err != nil {
		return InspectResult{IsRepo: false}, nil
	}
	branch, err := gitAbbrevHead(top)
	if err != nil || branch == "" {
		branch = "HEAD"
	}
	dirty, err := dirtyAt(top)
	if err != nil {
		return InspectResult{}, err
	}
	source := SourceRepoFromCommonDir(top, gitCommonDir(top))
	if source == "" {
		source = top
	}
	result := InspectResult{
		IsRepo:     true,
		Branch:     branch,
		Toplevel:   top,
		SourceRepo: source,
		Dirty:      dirty,
		Worktree:   !SamePath(source, top),
	}
	if result.Worktree {
		result.WorktreePath = top
	}
	if !result.Worktree && looksLikeGrokWorktree(top) {
		enrichInspect(&result)
	}
	return result, nil
}

// enrichInspect sets source, id, and name from grok when git thinks the
// checkout is its own repository. A miss leaves the git-only result: the
// folder stays grouped as itself.
//
// @param result In/out. Toplevel must be the checkout root.
func enrichInspect(result *InspectResult) {
	if result == nil || result.Toplevel == "" {
		return
	}
	listed, err := spawn.RunGrokCli(
		[]string{"worktree", "list", "--json"},
		result.Toplevel,
		listTimeoutMs,
	)
	if err == nil && listed.Code != nil && *listed.Code == 0 {
		if row, ok := MatchList(listed.Stdout, result.Toplevel); ok {
			applyInspectRow(result, row.ID, row.Metadata.Label, row.SourceRepo)
			return
		}
	}
	shown, err := spawn.RunGrokCli(
		[]string{"worktree", "show", result.Toplevel},
		result.Toplevel,
		listTimeoutMs,
	)
	if err != nil || shown.Code == nil || *shown.Code != 0 {
		return
	}
	fields := ParseShow(shown.Stdout)
	applyInspectRow(result, fields.ID, fields.Label, fields.SourceRepo)
}

// applyInspectRow records a grok identity when it names a different source.
// An empty or same-directory source does not flip Worktree on.
//
// @param result In/out inspect payload.
// @param id Grok worktree id; may be empty.
// @param name Label; may be empty.
// @param source Source repository from list or show; may be empty.
func applyInspectRow(result *InspectResult, id, name, source string) {
	if result == nil {
		return
	}
	resolved := canonicalPath(source)
	if resolved == "" || SamePath(resolved, result.Toplevel) {
		return
	}
	result.SourceRepo = resolved
	result.Worktree = true
	result.WorktreePath = result.Toplevel
	if id != "" {
		result.WorktreeID = id
	}
	if name != "" {
		result.WorktreeName = name
	}
}
