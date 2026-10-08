package gitops

import (
	"testing"
)

// A plain directory is not an error: the desktop hides git chrome instead.
func TestReadStatusOutsideRepo(t *testing.T) {
	isolateGitConfig(t)
	st, err := ReadStatus(t.TempDir())
	if err != nil {
		t.Fatalf("ReadStatus: %v", err)
	}
	if st.IsRepo || len(st.Files) != 0 {
		t.Fatalf("want isRepo=false, got %+v", st)
	}
}

func TestReadStatusRejectsRelativeCwd(t *testing.T) {
	if _, err := ReadStatus("relative/dir"); err == nil {
		t.Fatal("want error for relative cwd")
	}
}

// Fresh `git init`: no commits yet, untracked file listed, branch known.
func TestReadStatusInitialRepo(t *testing.T) {
	isolateGitConfig(t)
	dir := t.TempDir()
	runGit(t, dir, "init", "-q", "-b", "main", ".")
	writeFile(t, dir, "a.txt", "a\n")
	st, err := ReadStatus(dir)
	if err != nil {
		t.Fatal(err)
	}
	if !st.IsRepo || !st.Initial || st.Branch != "main" || st.Head != "" {
		t.Fatalf("unexpected header: %+v", st)
	}
	f, ok := fileByPath(st.Files, "a.txt")
	if !ok || f.Kind != "untracked" {
		t.Fatalf("want untracked a.txt, got %+v", st.Files)
	}
}

// Every change kind the panel badges: modified, added, deleted, renamed,
// untracked (including files inside new directories, thanks to -uall).
func TestReadStatusChangeKinds(t *testing.T) {
	dir := newRepo(t, map[string]string{"mod.txt": "1\n", "del.txt": "x\n", "old.txt": "rename me\n"})
	writeFile(t, dir, "mod.txt", "2\n")
	writeFile(t, dir, "staged.txt", "new\n")
	runGit(t, dir, "add", "staged.txt")
	runGit(t, dir, "rm", "-q", "del.txt")
	runGit(t, dir, "mv", "old.txt", "new.txt")
	writeFile(t, dir, "nested/dir/u.txt", "u\n")

	st, err := ReadStatus(dir)
	if err != nil {
		t.Fatal(err)
	}
	if st.Root != dir || st.Branch != "main" || st.Detached || st.Initial || st.Head == "" {
		t.Fatalf("unexpected header: %+v", st)
	}
	want := map[string]string{
		"mod.txt": "modified", "staged.txt": "added", "del.txt": "deleted",
		"new.txt": "renamed", "nested/dir/u.txt": "untracked",
	}
	for path, kind := range want {
		f, ok := fileByPath(st.Files, path)
		if !ok || f.Kind != kind {
			t.Errorf("%s: want %s, got %+v (ok=%v)", path, kind, f, ok)
		}
	}
	if f, _ := fileByPath(st.Files, "new.txt"); f.OrigPath != "old.txt" {
		t.Errorf("rename origPath: %+v", f)
	}
}

func TestReadStatusDetachedHead(t *testing.T) {
	dir := newRepo(t, map[string]string{"a.txt": "a\n"})
	runGit(t, dir, "checkout", "-q", "--detach")
	st, err := ReadStatus(dir)
	if err != nil {
		t.Fatal(err)
	}
	if !st.Detached || st.Branch != "" || st.Head == "" {
		t.Fatalf("want detached, got %+v", st)
	}
}

func TestReadStatusUpstreamAheadBehind(t *testing.T) {
	dir := newRepo(t, map[string]string{"a.txt": "a\n"})
	newBareRemote(t, dir)
	runGit(t, dir, "push", "-q", "-u", "origin", "main")
	writeFile(t, dir, "b.txt", "b\n")
	runGit(t, dir, "add", "b.txt")
	runGit(t, dir, "commit", "-q", "-m", "b")
	st, err := ReadStatus(dir)
	if err != nil {
		t.Fatal(err)
	}
	if st.Upstream != "origin/main" || st.Ahead != 1 || st.Behind != 0 {
		t.Fatalf("want origin/main +1 -0, got %+v", st)
	}
}

// Pure parser coverage for records the fixtures above do not produce.
func TestParsePorcelainV2Records(t *testing.T) {
	out := "# branch.oid abc\x00# branch.head feat\x00# branch.upstream origin/feat\x00# branch.ab +2 -3\x00" +
		"u UU N... 100644 100644 100644 100644 h1 h2 h3 conflict.txt\x00" +
		"1 .T N... 100644 120000 120000 h1 h2 link\x00" +
		"2 C. N... 100644 100644 100644 h1 h2 C75 copy.txt\x00src.txt\x00" +
		"? with space.txt\x00"
	st := parsePorcelainV2(out)
	if st.Head != "abc" || st.Branch != "feat" || st.Upstream != "origin/feat" || st.Ahead != 2 || st.Behind != 3 {
		t.Fatalf("header: %+v", st)
	}
	cases := map[string]string{"conflict.txt": "conflicted", "link": "typechange", "copy.txt": "copied", "with space.txt": "untracked"}
	for path, kind := range cases {
		f, ok := fileByPath(st.Files, path)
		if !ok || f.Kind != kind {
			t.Errorf("%s: want %s, got %+v", path, kind, f)
		}
	}
	if f, _ := fileByPath(st.Files, "copy.txt"); f.OrigPath != "src.txt" {
		t.Errorf("copy origPath: %+v", f)
	}
}
