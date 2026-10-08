package gitops

import (
	"strings"
	"testing"
)

// Working tree vs HEAD covers tracked edits, deletions, a staged rename,
// binary files and untracked files — without touching the real index.
func TestReadDiffHeadIncludesUntrackedRenamesBinary(t *testing.T) {
	lines := strings.Repeat("same line\n", 20)
	dir := newRepo(t, map[string]string{"keep.txt": "a\nb\nc\n", "del.txt": "x\n", "ren.txt": lines})
	writeFile(t, dir, "keep.txt", "a\nB\nc")
	runGit(t, dir, "rm", "-q", "del.txt")
	runGit(t, dir, "mv", "ren.txt", "moved.txt")
	writeFile(t, dir, "moved.txt", lines+"extra\n")
	writeFile(t, dir, "untracked.txt", "new\n")
	writeFile(t, dir, "bin.dat", "\x00\x01bin")
	writeFile(t, dir, "sp ace\"q.txt", "q\n")

	res, err := ReadDiff(dir, DiffRequest{})
	if err != nil {
		t.Fatalf("ReadDiff: %v", err)
	}
	if !res.IsRepo || res.Mode != DiffModeHead || res.Base != "HEAD" || res.BaseCommit == "" || res.Root != dir {
		t.Fatalf("header: %+v", res)
	}
	keep, _ := diffByPath(res.Files, "keep.txt")
	if keep.Status != "modified" || keep.Added != 2 || keep.Removed != 2 ||
		!strings.Contains(keep.Patch, "\n-b\n") || !strings.Contains(keep.Patch, "\\ No newline at end of file") {
		t.Errorf("keep.txt: %+v", keep)
	}
	del, _ := diffByPath(res.Files, "del.txt")
	if del.Status != "deleted" || del.Removed != 1 || !strings.Contains(del.Patch, "\n-x\n") {
		t.Errorf("del.txt: %+v", del)
	}
	moved, _ := diffByPath(res.Files, "moved.txt")
	if moved.Status != "renamed" || moved.OrigPath != "ren.txt" || moved.Added != 1 || !strings.Contains(moved.Patch, "+extra") {
		t.Errorf("moved.txt: %+v", moved)
	}
	// Full context: every unchanged line is in the patch, so the desktop can
	// rebuild both whole files.
	if strings.Count(moved.Patch, "\n same line") != 20 {
		t.Errorf("moved.txt patch lacks full context:\n%s", moved.Patch)
	}
	untracked, _ := diffByPath(res.Files, "untracked.txt")
	if untracked.Status != "added" || !untracked.Untracked || !strings.Contains(untracked.Patch, "+new") {
		t.Errorf("untracked.txt: %+v", untracked)
	}
	bin, _ := diffByPath(res.Files, "bin.dat")
	if !bin.Binary || bin.Patch != "" || !bin.Untracked {
		t.Errorf("bin.dat: %+v", bin)
	}
	quoted, ok := diffByPath(res.Files, "sp ace\"q.txt")
	if !ok || !strings.Contains(quoted.Patch, "+q") {
		t.Errorf("quoted path: %+v", quoted)
	}
	// The temp index must not leak into the user's staging area.
	st, err := ReadStatus(dir)
	if err != nil {
		t.Fatal(err)
	}
	if f, _ := fileByPath(st.Files, "untracked.txt"); f.Kind != "untracked" {
		t.Errorf("real index changed: %+v", f)
	}
}

// Before the first commit the base is the empty tree.
func TestReadDiffWithoutCommits(t *testing.T) {
	isolateGitConfig(t)
	dir := t.TempDir()
	runGit(t, dir, "init", "-q", "-b", "main", ".")
	writeFile(t, dir, "a.txt", "a\n")
	res, err := ReadDiff(dir, DiffRequest{})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Files) != 1 || res.Files[0].Status != "added" || res.Added != 1 {
		t.Fatalf("want one added file, got %+v", res.Files)
	}
}

// merge-base mode shows committed branch work plus uncommitted edits.
func TestReadDiffMergeBase(t *testing.T) {
	dir := newRepo(t, map[string]string{"base.txt": "base\n"})
	runGit(t, dir, "checkout", "-q", "-b", "feat")
	writeFile(t, dir, "feature.txt", "committed\n")
	runGit(t, dir, "add", "feature.txt")
	runGit(t, dir, "commit", "-q", "-m", "feature")
	writeFile(t, dir, "base.txt", "base\nedited\n")
	// main moves on; its change must not appear in the branch diff.
	runGit(t, dir, "checkout", "-q", "main")
	writeFile(t, dir, "mainonly.txt", "main\n")
	runGit(t, dir, "add", "mainonly.txt")
	runGit(t, dir, "commit", "-q", "-m", "main moves")
	runGit(t, dir, "checkout", "-q", "feat")

	res, err := ReadDiff(dir, DiffRequest{Mode: DiffModeMergeBase})
	if err != nil {
		t.Fatal(err)
	}
	if res.Base != "main" {
		t.Fatalf("default base: %q", res.Base)
	}
	if _, ok := diffByPath(res.Files, "feature.txt"); !ok {
		t.Errorf("committed branch file missing: %+v", res.Files)
	}
	if _, ok := diffByPath(res.Files, "base.txt"); !ok {
		t.Errorf("uncommitted edit missing: %+v", res.Files)
	}
	if _, ok := diffByPath(res.Files, "mainonly.txt"); ok {
		t.Errorf("base-branch change leaked into branch diff")
	}
	headOnly, err := ReadDiff(dir, DiffRequest{Mode: DiffModeHead})
	if err != nil {
		t.Fatal(err)
	}
	if len(headOnly.Files) != 1 || headOnly.Files[0].Path != "base.txt" {
		t.Errorf("head mode should only show the uncommitted edit: %+v", headOnly.Files)
	}
}

func TestReadDiffMergeBaseRejectsBadRefs(t *testing.T) {
	dir := newRepo(t, map[string]string{"a.txt": "a\n"})
	for _, base := range []string{"--output=/tmp/x", "no-such-branch", "a b"} {
		if _, err := ReadDiff(dir, DiffRequest{Mode: DiffModeMergeBase, Base: base}); err == nil {
			t.Errorf("base %q: want error", base)
		}
	}
	if _, err := ReadDiff(dir, DiffRequest{Mode: "sideways"}); err == nil {
		t.Error("unknown mode: want error")
	}
}

// Per-file cap → tooLarge; aggregate budget → omitted; counts still present.
func TestReadDiffCaps(t *testing.T) {
	dir := newRepo(t, map[string]string{"a.txt": "a\n", "b.txt": "b\n", "c.txt": "c\n"})
	writeFile(t, dir, "a.txt", strings.Repeat("big line of text\n", 400))
	writeFile(t, dir, "b.txt", "b2\n")
	writeFile(t, dir, "c.txt", "c2\n")
	// b.txt's section is ~105 bytes: it fits a 150-byte budget, c.txt does not.
	res, err := ReadDiff(dir, DiffRequest{MaxFileBytes: 2048, MaxTotalBytes: 150})
	if err != nil {
		t.Fatal(err)
	}
	a, _ := diffByPath(res.Files, "a.txt")
	if !a.TooLarge || a.Patch != "" || a.Added != 400 {
		t.Errorf("a.txt: %+v", a)
	}
	b, _ := diffByPath(res.Files, "b.txt")
	c, _ := diffByPath(res.Files, "c.txt")
	if b.Patch == "" || !c.Omitted || c.Patch != "" {
		t.Errorf("budget: b=%+v c=%+v", b, c)
	}
	// Re-requesting the omitted file alone loads it.
	one, err := ReadDiff(dir, DiffRequest{Paths: []string{"c.txt"}})
	if err != nil {
		t.Fatal(err)
	}
	if len(one.Files) != 1 || one.Files[0].Patch == "" {
		t.Errorf("paths filter: %+v", one.Files)
	}
}

func TestReadDiffRejectsEscapingPaths(t *testing.T) {
	dir := newRepo(t, map[string]string{"a.txt": "a\n"})
	for _, p := range []string{"../outside.txt", "/etc/passwd", ""} {
		if _, err := ReadDiff(dir, DiffRequest{Paths: []string{p}}); err == nil {
			t.Errorf("path %q: want error", p)
		}
	}
}

// A merge conflict must not misalign patches (one section per raw record).
func TestReadDiffDuringConflict(t *testing.T) {
	dir := newRepo(t, map[string]string{"c.txt": "base\n"})
	runGit(t, dir, "checkout", "-q", "-b", "other")
	writeFile(t, dir, "c.txt", "other\n")
	runGit(t, dir, "commit", "-q", "-am", "other")
	runGit(t, dir, "checkout", "-q", "main")
	writeFile(t, dir, "c.txt", "main\n")
	writeFile(t, dir, "z.txt", "unrelated\n")
	runGit(t, dir, "add", "-A")
	runGit(t, dir, "commit", "-q", "-m", "main")
	writeFile(t, dir, "z.txt", "unrelated edit\n")
	_ = runGitAllowFail(t, dir, "merge", "other")

	res, err := ReadDiff(dir, DiffRequest{})
	if err != nil {
		t.Fatalf("ReadDiff during conflict: %v", err)
	}
	z, ok := diffByPath(res.Files, "z.txt")
	if !ok || !strings.Contains(z.Patch, "+unrelated edit") {
		t.Errorf("z.txt patch misaligned: %+v", z)
	}
	// The conflicted file diffs as its marker-laden work-tree content.
	c, ok := diffByPath(res.Files, "c.txt")
	if !ok || !strings.Contains(c.Patch, "+<<<<<<<") || !strings.Contains(c.Patch, "a/c.txt") {
		t.Errorf("c.txt: %+v", c)
	}
}

// Long lines are read in fragments; caps apply per section and in total.
func TestSplitPatchStream(t *testing.T) {
	long := strings.Repeat("x", 200_000)
	patch := "diff --git a/a b/a\n+" + long + "\n diff --git inside content\n" +
		"diff --git a/b b/b\n+small\n" +
		"* Unmerged path c\n"
	secs, err := splitPatchStream(strings.NewReader(patch), 300_000, 1_000_000)
	if err != nil {
		t.Fatal(err)
	}
	if len(secs) != 3 {
		t.Fatalf("want 3 sections, got %d", len(secs))
	}
	if !strings.Contains(secs[0].text.String(), long) || !strings.Contains(secs[0].text.String(), " diff --git inside") {
		t.Errorf("section 0 lost content")
	}
	capped, _ := splitPatchStream(strings.NewReader(patch), 1000, 1_000_000)
	if !capped[0].tooLarge || capped[0].text.Len() != 0 || capped[1].tooLarge {
		t.Errorf("per-file cap: %+v %+v", capped[0].tooLarge, capped[1].tooLarge)
	}
}

func TestCleanRepoPath(t *testing.T) {
	root := t.TempDir()
	ok := map[string]string{"a.txt": "a.txt", "dir/b.txt": "dir/b.txt", "./c.txt": "c.txt", "..foo": "..foo"}
	for in, want := range ok {
		got, err := cleanRepoPath(root, in)
		if err != nil || got != want {
			t.Errorf("%q: got %q, %v", in, got, err)
		}
	}
	for _, bad := range []string{"", "..", "../x", "a/../../x", ".", "a\x00b"} {
		if _, err := cleanRepoPath(root, bad); err == nil {
			t.Errorf("%q: want error", bad)
		}
	}
}
