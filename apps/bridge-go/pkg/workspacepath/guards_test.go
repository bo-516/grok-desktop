package workspacepath

import "testing"

func TestIsSensitiveWorkspacePath(t *testing.T) {
	cases := []struct {
		path string
		want bool
	}{
		{".env", true},
		{".env.local", true},
		{"id_rsa", true},
		{"secrets.json", true},
		{"readme.md", false},
		{"src/main.go", false},
	}
	for _, c := range cases {
		if got := IsSensitiveWorkspacePath(c.path); got != c.want {
			t.Errorf("%s: got %v want %v", c.path, got, c.want)
		}
	}
}

func TestIsBinaryBuffer(t *testing.T) {
	if IsBinaryBuffer([]byte("hello\nworld")) {
		t.Fatal("text should not be binary")
	}
	if !IsBinaryBuffer([]byte{0, 1, 2, 3}) {
		t.Fatal("NUL should be binary")
	}
}

func TestGuessTextMimeType(t *testing.T) {
	if GuessTextMimeType("a.md") != "text/markdown" {
		t.Fatal("md")
	}
	if GuessTextMimeType("a.json") != "application/json" {
		t.Fatal("json")
	}
	if GuessTextMimeType("a.go") != "text/plain" {
		t.Fatal("default")
	}
}
