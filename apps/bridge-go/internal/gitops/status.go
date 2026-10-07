package gitops

import (
	"errors"
	"strconv"
	"strings"
)

// maxStatusFiles caps rows returned by ReadStatus; the rest set Truncated.
const maxStatusFiles = 5000

// FileStatus is one changed path from `git status --porcelain=v2`.
// Paths are relative to the work-tree root with `/` separators.
type FileStatus struct {
	// Path is the current path (the destination of a rename).
	Path string `json:"path"`
	// OrigPath is the rename / copy source; empty otherwise.
	OrigPath string `json:"origPath,omitempty"`
	// Index is the porcelain X column (staged state); "." when unchanged.
	Index string `json:"index"`
	// Worktree is the porcelain Y column (unstaged state); "." when unchanged.
	Worktree string `json:"worktree"`
	// Kind is a single summary: added | modified | deleted | renamed |
	// copied | typechange | untracked | conflicted.
	Kind string `json:"kind"`
}

// Status is the branch + dirty-file snapshot shown in the top nav and used to
// gate commit / push / PR actions.
type Status struct {
	// IsRepo is false when the workspace is not inside a git work tree; every
	// other field is then zero.
	IsRepo bool `json:"isRepo"`
	// Root is the absolute work-tree top level.
	Root string `json:"root,omitempty"`
	// Branch is the checked-out branch name; empty when Detached.
	Branch string `json:"branch,omitempty"`
	// Detached is true when HEAD points at a commit, not a branch.
	Detached bool `json:"detached"`
	// Head is the full HEAD commit id; empty before the first commit.
	Head string `json:"head,omitempty"`
	// Initial is true when the branch has no commits yet.
	Initial bool `json:"initial"`
	// Upstream is the tracking ref (e.g. "origin/feat"); empty when unset.
	Upstream string `json:"upstream,omitempty"`
	// Ahead counts local commits not on the upstream (0 without upstream).
	Ahead int `json:"ahead"`
	// Behind counts upstream commits not merged locally.
	Behind int `json:"behind"`
	// Files lists changed paths, including untracked (never ignored) files.
	Files []FileStatus `json:"files"`
	// Truncated is true when the file list was capped.
	Truncated bool `json:"truncated"`
}

// ReadStatus answers the `git_status` cli command for the workspace cwd.
// A cwd outside any work tree returns `{isRepo: false}` with no error so the
// desktop can quietly hide git chrome; spawn failures (git missing) and
// unexpected git errors are returned as errors.
// @param cwd Absolute session workspace directory.
// @returns Branch / upstream / file snapshot.
func ReadStatus(cwd string) (*Status, error) {
	r, err := openRepo(cwd)
	if errors.Is(err, errNotRepo) {
		return &Status{IsRepo: false, Files: []FileStatus{}}, nil
	}
	if err != nil {
		return nil, err
	}
	return r.status()
}

// status runs porcelain v2 status in the repo root and parses it.
// `-uall` lists every untracked file (not just the directory) so the diff
// panel and the commit dialog can address them individually.
// @returns Parsed snapshot with IsRepo and Root set.
func (r *repo) status() (*Status, error) {
	spec := r.git(statusTimeout, "status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all")
	res, err := runExec(spec)
	if err != nil {
		return nil, err
	}
	if res.Code != 0 {
		return nil, errors.New(failureDetail(res))
	}
	st := parsePorcelainV2(string(res.Stdout))
	st.IsRepo = true
	st.Root = r.root
	st.Truncated = st.Truncated || res.StdoutTruncated
	return st, nil
}

// parsePorcelainV2 parses `git status --porcelain=v2 --branch -z` output.
// Header lines (`# branch.*`) fill branch fields; `1`/`2`/`u`/`?` records
// become FileStatus rows (rename records consume the next NUL token as the
// original path). Unknown records are skipped so newer git output degrades
// gracefully. Rows beyond maxStatusFiles set Truncated.
// @param out Raw NUL-separated stdout.
// @returns Snapshot without IsRepo / Root (the caller sets those).
func parsePorcelainV2(out string) *Status {
	st := &Status{Files: []FileStatus{}}
	tokens := strings.Split(out, "\x00")
	for i := 0; i < len(tokens); i++ {
		tok := tokens[i]
		if tok == "" {
			continue
		}
		switch tok[0] {
		case '#':
			applyBranchHeader(st, tok)
		case '1':
			if f, ok := parseOrdinaryRecord(tok); ok {
				appendStatusFile(st, f)
			}
		case '2':
			f, ok := parseRenameRecord(tok)
			if i+1 < len(tokens) {
				i++
				f.OrigPath = tokens[i]
			}
			if ok {
				appendStatusFile(st, f)
			}
		case 'u':
			if parts := strings.SplitN(tok, " ", 11); len(parts) == 11 {
				appendStatusFile(st, FileStatus{
					Path: parts[10], Index: string(parts[1][0]), Worktree: string(parts[1][1]), Kind: "conflicted",
				})
			}
		case '?':
			if len(tok) > 2 {
				appendStatusFile(st, FileStatus{Path: tok[2:], Index: "?", Worktree: "?", Kind: "untracked"})
			}
		}
	}
	return st
}

// appendStatusFile adds f unless the cap is reached, in which case it only
// flags the snapshot as truncated.
// @param st Snapshot being built.
// @param f Parsed row.
func appendStatusFile(st *Status, f FileStatus) {
	if len(st.Files) >= maxStatusFiles {
		st.Truncated = true
		return
	}
	st.Files = append(st.Files, f)
}

// applyBranchHeader folds one `# branch.<key> <value>` line into st.
// `(initial)` oid means no commits yet; `(detached)` head means detached HEAD.
// @param st Snapshot being built.
// @param line Header line including the leading "# ".
func applyBranchHeader(st *Status, line string) {
	body := strings.TrimPrefix(line, "# ")
	key, value, _ := strings.Cut(body, " ")
	switch key {
	case "branch.oid":
		if value == "(initial)" {
			st.Initial = true
			return
		}
		st.Head = value
	case "branch.head":
		if value == "(detached)" {
			st.Detached = true
			return
		}
		st.Branch = value
	case "branch.upstream":
		st.Upstream = value
	case "branch.ab":
		for _, part := range strings.Fields(value) {
			n, err := strconv.Atoi(strings.TrimLeft(part, "+-"))
			if err != nil {
				continue
			}
			if strings.HasPrefix(part, "+") {
				st.Ahead = n
			} else if strings.HasPrefix(part, "-") {
				st.Behind = n
			}
		}
	}
}

// parseOrdinaryRecord parses `1 XY sub mH mI mW hH hI path`.
// @param tok One NUL-delimited record.
// @returns Row and true, or false when the record is malformed.
func parseOrdinaryRecord(tok string) (FileStatus, bool) {
	parts := strings.SplitN(tok, " ", 9)
	if len(parts) != 9 || len(parts[1]) != 2 {
		return FileStatus{}, false
	}
	x, y := parts[1][0], parts[1][1]
	return FileStatus{Path: parts[8], Index: string(x), Worktree: string(y), Kind: ordinaryKind(x, y)}, true
}

// parseRenameRecord parses `2 XY sub mH mI mW hH hI Xscore path` (the
// original path follows as the next NUL token; the caller fills it).
// @param tok One NUL-delimited record.
// @returns Row and true, or false when the record is malformed.
func parseRenameRecord(tok string) (FileStatus, bool) {
	parts := strings.SplitN(tok, " ", 10)
	if len(parts) != 10 || len(parts[1]) != 2 {
		return FileStatus{}, false
	}
	kind := "renamed"
	if strings.HasPrefix(parts[8], "C") {
		kind = "copied"
	}
	return FileStatus{Path: parts[9], Index: string(parts[1][0]), Worktree: string(parts[1][1]), Kind: kind}, true
}

// ordinaryKind summarizes an XY pair for a non-rename record. Additions win
// over later edits (an added-then-modified file is still new to HEAD), then
// deletions, then type changes; everything else is a modification.
// @param x Index status byte.
// @param y Work-tree status byte.
// @returns Kind label used by the desktop badges.
func ordinaryKind(x, y byte) string {
	switch {
	case x == 'A':
		return "added"
	case x == 'D' || y == 'D':
		return "deleted"
	case x == 'T' || y == 'T':
		return "typechange"
	default:
		return "modified"
	}
}
