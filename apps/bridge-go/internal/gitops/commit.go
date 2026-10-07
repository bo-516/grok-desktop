package gitops

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
)

// CommitRequest is the `git_commit` cli payload.
type CommitRequest struct {
	// Message is the full commit message; must contain non-whitespace text.
	Message string
	// Paths selects files to commit (repo-relative). Pass both sides of a
	// rename to commit it as one. Ignored when All is true.
	Paths []string
	// All commits every change in the work tree (`git add -A` + commit).
	All bool
}

// CommitResult is the `git_commit` reply.
type CommitResult struct {
	// Commit is the new HEAD id.
	Commit string `json:"commit"`
	// Summary is the message's first line.
	Summary string `json:"summary"`
	// Branch is the branch the commit landed on ("" when detached).
	Branch string `json:"branch,omitempty"`
}

// Commit answers the `git_commit` cli command.
//
// Selected paths are committed with `--only` semantics: other changes the
// user already staged stay staged and out of this commit. Untracked and
// modified selections are staged first (`git add -A -- <paths>` for those
// that exist on disk); deletions and rename sources are picked up by the
// commit pathspec itself. Hooks run normally (no --no-verify), so a rejecting
// pre-commit hook surfaces its output verbatim. Empty commits are refused
// before git runs, and git's own "nothing to commit" is returned verbatim.
// @param cwd Absolute session workspace.
// @param req Message + selection.
// @returns New commit id / summary, or an error (not a repo, no changes,
//
//	empty message, hook failure, missing identity, …).
func Commit(cwd string, req CommitRequest) (*CommitResult, error) {
	message := strings.TrimRight(req.Message, " \t\r\n")
	if strings.TrimSpace(message) == "" {
		return nil, errors.New("commit message is required")
	}
	r, err := openRepo(cwd)
	if errors.Is(err, errNotRepo) {
		return nil, errors.New("this workspace is not inside a git repository")
	}
	if err != nil {
		return nil, err
	}
	st, err := r.status()
	if err != nil {
		return nil, err
	}
	if len(st.Files) == 0 {
		return nil, errors.New("nothing to commit — the working tree is clean")
	}
	msgFile, err := writeMessageFile(message)
	if err != nil {
		return nil, err
	}
	defer os.Remove(msgFile)
	if req.All {
		if err := r.runOrFail(r.git(commitTimeout, "add", "-A")); err != nil {
			return nil, err
		}
		if err := r.runOrFail(r.git(commitTimeout, "commit", "-F", msgFile)); err != nil {
			return nil, err
		}
	} else if err := r.commitSelected(st, req.Paths, msgFile); err != nil {
		return nil, err
	}
	head, err := r.output("rev-parse", "HEAD")
	if err != nil {
		return nil, err
	}
	summary, _, _ := strings.Cut(strings.TrimSpace(message), "\n")
	return &CommitResult{Commit: head, Summary: strings.TrimSpace(summary), Branch: st.Branch}, nil
}

// commitSelected stages and commits only the requested paths.
// @param st Current status (selection is intersected with its changed paths).
// @param paths Client selection.
// @param msgFile Path of the message file for `git commit -F`.
// @returns Validation or git error.
func (r *repo) commitSelected(st *Status, paths []string, msgFile string) error {
	if len(paths) == 0 {
		return errors.New("no files selected to commit")
	}
	selected, err := selectChangedPaths(r.root, st, paths)
	if err != nil {
		return err
	}
	if len(selected.commit) == 0 {
		return errors.New("nothing to commit — the selected files have no changes")
	}
	if len(selected.add) > 0 {
		add := r.git(commitTimeout, "add", "-A", "--pathspec-from-file=-", "--pathspec-file-nul")
		add.stdin = nulList(selected.add)
		if err := r.runOrFail(add); err != nil {
			return err
		}
	}
	commit := r.git(commitTimeout, "commit", "-F", msgFile, "--pathspec-from-file=-", "--pathspec-file-nul")
	commit.stdin = nulList(selected.commit)
	return r.runOrFail(commit)
}

// pathSelection splits a commit selection by what each git step needs.
type pathSelection struct {
	// add are selected paths that exist on disk (staged before committing).
	add []string
	// commit are selected paths plus rename sources (the commit pathspec).
	commit []string
}

// selectChangedPaths validates the client paths and keeps those git reports
// as changed. A selected rename destination also commits its source, so the
// rename is recorded instead of a stray add.
// @param root Work-tree root.
// @param st Current status.
// @param paths Client selection.
// @returns Selection, or the first path validation error.
func selectChangedPaths(root string, st *Status, paths []string) (pathSelection, error) {
	byPath := map[string]FileStatus{}
	for _, f := range st.Files {
		byPath[f.Path] = f
		if f.OrigPath != "" {
			byPath[f.OrigPath] = f
		}
	}
	seen := map[string]bool{}
	out := pathSelection{}
	push := func(p string) {
		if seen[p] {
			return
		}
		seen[p] = true
		out.commit = append(out.commit, p)
		if _, err := os.Lstat(filepath.Join(root, filepath.FromSlash(p))); err == nil {
			out.add = append(out.add, p)
		}
	}
	for _, raw := range paths {
		p, err := cleanRepoPath(root, raw)
		if err != nil {
			return pathSelection{}, err
		}
		f, ok := byPath[p]
		if !ok {
			continue
		}
		push(f.Path)
		if f.OrigPath != "" {
			push(f.OrigPath)
		}
	}
	return out, nil
}

// runOrFail runs spec and converts a non-zero exit into an error carrying
// git's own output.
// @param spec Invocation.
// @returns nil on exit 0.
func (r *repo) runOrFail(spec execSpec) error {
	res, err := runExec(spec)
	if err != nil {
		return err
	}
	if res.Code != 0 {
		return errors.New(failureDetail(res))
	}
	return nil
}

// writeMessageFile stores the commit message in a temp file for
// `git commit -F`, so multi-line text and leading dashes are never parsed as
// arguments. The caller removes the file.
// @param message Commit message.
// @returns Temp file path.
func writeMessageFile(message string) (string, error) {
	f, err := os.CreateTemp("", "grok-desktop-commit-*.txt")
	if err != nil {
		return "", err
	}
	defer f.Close()
	if _, err := f.WriteString(message + "\n"); err != nil {
		_ = os.Remove(f.Name())
		return "", err
	}
	return f.Name(), nil
}

// nulList renders paths for `--pathspec-from-file=- --pathspec-file-nul`,
// which also keeps long selections off the command line (Windows limits argv).
// @param paths Repo-relative paths.
// @returns Reader over NUL-terminated paths.
func nulList(paths []string) *strings.Reader {
	return strings.NewReader(strings.Join(paths, "\x00") + "\x00")
}
