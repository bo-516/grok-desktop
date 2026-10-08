package gitops

import (
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// untrackedFiles lists untracked, non-ignored files (repo-relative).
// @param filter When non-empty, only these paths are kept.
// @returns Paths (capped at maxUntrackedFiles), whether the cap hit, or an error.
func (r *repo) untrackedFiles(filter []string) ([]string, bool, error) {
	res, err := runExec(r.git(statusTimeout, "ls-files", "--others", "--exclude-standard", "-z"))
	if err != nil {
		return nil, false, err
	}
	if res.Code != 0 {
		return nil, false, errors.New(failureDetail(res))
	}
	keep := map[string]bool{}
	for _, p := range filter {
		keep[p] = true
	}
	out := []string{}
	truncated := res.StdoutTruncated
	for _, p := range strings.Split(string(res.Stdout), "\x00") {
		if p == "" || (len(filter) > 0 && !keep[p]) {
			continue
		}
		if len(out) >= maxUntrackedFiles {
			truncated = true
			break
		}
		out = append(out, p)
	}
	return out, truncated, nil
}

// withIntentIndex runs fn with GIT_INDEX_FILE pointing at a temporary copy of
// the real index in which the untracked files are marked intent-to-add, so
// `git diff <commit>` reports them as new files. With no untracked files fn
// runs against the real index (env nil). The temp file lives next to the real
// index (split-index shared files resolve there) and is always removed.
// @param untracked Repo-relative untracked paths.
// @param fn Callback receiving the extra env for every git call it makes.
// @returns fn's error, or a setup error.
func (r *repo) withIntentIndex(untracked []string, fn func(env []string) error) error {
	if len(untracked) == 0 {
		return fn(nil)
	}
	indexPath, err := r.output("rev-parse", "--git-path", "index")
	if err != nil {
		return err
	}
	if !filepath.IsAbs(indexPath) {
		indexPath = filepath.Join(r.root, indexPath)
	}
	tmpPath, err := copyIndex(indexPath)
	if err != nil {
		return err
	}
	defer func() {
		_ = os.Remove(tmpPath)
		_ = os.Remove(tmpPath + ".lock")
	}()
	env := []string{"GIT_INDEX_FILE=" + tmpPath}
	spec := r.git(diffTimeout, "add", "--intent-to-add", "--pathspec-from-file=-", "--pathspec-file-nul")
	spec.stdin = strings.NewReader(strings.Join(untracked, "\x00") + "\x00")
	spec.extraEnv = env
	res, err := runExec(spec)
	if err != nil {
		return err
	}
	if res.Code != 0 {
		return errors.New(failureDetail(res))
	}
	return fn(env)
}

// copyIndex copies the index at src into a fresh temp file in the same
// directory (falling back to the OS temp dir when that is not writable).
// A missing src (no `git add` ever ran) yields a reserved but nonexistent
// path: git rejects a zero-byte index, while a missing one reads as empty.
// @param src Absolute path of the real index.
// @returns Temp file path.
func copyIndex(src string) (string, error) {
	tmp, err := os.CreateTemp(filepath.Dir(src), "grok-desktop-diff-*.index")
	if err != nil {
		tmp, err = os.CreateTemp("", "grok-desktop-diff-*.index")
		if err != nil {
			return "", err
		}
	}
	defer tmp.Close()
	in, err := os.Open(src)
	if errors.Is(err, os.ErrNotExist) {
		_ = os.Remove(tmp.Name())
		return tmp.Name(), nil
	}
	if err != nil {
		_ = os.Remove(tmp.Name())
		return "", err
	}
	defer in.Close()
	if _, err := io.Copy(tmp, in); err != nil {
		_ = os.Remove(tmp.Name())
		return "", err
	}
	return tmp.Name(), nil
}
