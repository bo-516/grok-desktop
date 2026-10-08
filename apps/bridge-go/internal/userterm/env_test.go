package userterm

import (
	"errors"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

// envMap turns KEY=value pairs into a map (last one wins) for assertions.
func envMap(env []string) map[string]string {
	out := map[string]string{}
	for _, kv := range env {
		k, v, _ := strings.Cut(kv, "=")
		out[k] = v
	}
	return out
}

// TestBuildEnvStripsBridgeSecretsAndForcesTerm: BRIDGE_* (auth token) never
// reaches the shell; TERM/COLORTERM are forced; LANG and PWD get unix defaults.
func TestBuildEnvStripsBridgeSecretsAndForcesTerm(t *testing.T) {
	parent := []string{
		"PATH=/usr/bin", "BRIDGE_TOKEN=secret", "bridge_port=1", "TERM=dumb",
		"PWD=/elsewhere", "OLDPWD=/old", "XAI_API_KEY=k", "garbage",
	}
	got := envMap(BuildEnv(parent, "darwin", "/work"))
	for _, k := range []string{"BRIDGE_TOKEN", "bridge_port", "OLDPWD", "garbage"} {
		if _, ok := got[k]; ok {
			t.Errorf("%s leaked into the terminal env", k)
		}
	}
	want := map[string]string{
		"PATH": "/usr/bin", "TERM": "xterm-256color", "COLORTERM": "truecolor",
		"TERM_PROGRAM": "grok-desktop", "LANG": "en_US.UTF-8", "PWD": "/work",
		"XAI_API_KEY": "k",
	}
	for k, v := range want {
		if got[k] != v {
			t.Errorf("%s = %q, want %q", k, got[k], v)
		}
	}
}

// TestBuildEnvKeepsUserLocaleAndSkipsUnixDefaultsOnWindows.
func TestBuildEnvKeepsUserLocaleAndSkipsUnixDefaultsOnWindows(t *testing.T) {
	got := envMap(BuildEnv([]string{"LC_ALL=de_DE.UTF-8"}, "linux", "/w"))
	if _, ok := got["LANG"]; ok {
		t.Error("LANG default must not override an existing LC_ALL")
	}
	win := BuildEnv([]string{"Path=C:\\bin"}, "windows", `C:\w`)
	if slices.ContainsFunc(win, func(kv string) bool {
		return strings.HasPrefix(kv, "LANG=") || strings.HasPrefix(kv, "PWD=")
	}) {
		t.Errorf("windows env got unix defaults: %v", win)
	}
}

// TestResolveCwd covers the accepted root, a subdir, and every rejection.
func TestResolveCwd(t *testing.T) {
	root := t.TempDir()
	realRoot, _ := filepath.EvalSymlinks(root)
	if err := os.Mkdir(filepath.Join(root, "sub"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "file.txt"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if got, err := ResolveCwd(root, ""); err != nil || got != realRoot {
		t.Fatalf("root: %q, %v (want %q)", got, err, realRoot)
	}
	if got, err := ResolveCwd(root, "sub"); err != nil || got != filepath.Join(realRoot, "sub") {
		t.Fatalf("sub: %q, %v", got, err)
	}
	bad := map[string][2]string{
		"empty root":    {"", ""},
		"relative root": {"rel/dir", ""},
		"missing root":  {filepath.Join(root, "nope"), ""},
		"file root":     {filepath.Join(root, "file.txt"), ""},
		"escape":        {root, "../.."},
		"file subdir":   {root, "file.txt"},
	}
	for name, args := range bad {
		if _, err := ResolveCwd(args[0], args[1]); err == nil {
			t.Errorf("%s: expected an error", name)
		}
	}
}

// TestResolveUnixShellOrder: $SHELL wins, then passwd, then platform fallbacks.
func TestResolveUnixShellOrder(t *testing.T) {
	all := func(string) bool { return true }
	only := func(ok ...string) func(string) bool {
		return func(p string) bool { return slices.Contains(ok, p) }
	}
	cases := []struct {
		name, env, passwd, goos string
		exec                    func(string) bool
		want                    string
	}{
		{"env shell", "/usr/local/bin/fish", "/bin/bash", "linux", all, "/usr/local/bin/fish"},
		{"relative env ignored", "zsh", "/bin/bash", "linux", all, "/bin/bash"},
		{"missing env falls to passwd", "/nope", "/bin/dash", "linux", only("/bin/dash"), "/bin/dash"},
		{"darwin zsh fallback", "", "", "darwin", only("/bin/zsh", "/bin/bash"), "/bin/zsh"},
		{"linux bash fallback", "", "", "linux", only("/bin/zsh", "/bin/bash"), "/bin/bash"},
		{"last resort", "", "", "linux", only(), "/bin/sh"},
	}
	for _, c := range cases {
		got, args := resolveUnixShell(c.env, c.passwd, c.goos, c.exec)
		if got != c.want || !slices.Equal(args, []string{"-l"}) {
			t.Errorf("%s: got %q %v, want %q [-l]", c.name, got, args, c.want)
		}
	}
}

// TestPasswdShellFor parses the shell field for the matching uid only.
func TestPasswdShellFor(t *testing.T) {
	passwd := "root:x:0:0:root:/root:/bin/bash\n# comment\nbad:line\nme:x:501:20::/home/me:/usr/bin/zsh\n"
	if got := passwdShellFor(passwd, "501"); got != "/usr/bin/zsh" {
		t.Errorf("uid 501 = %q", got)
	}
	if got := passwdShellFor(passwd, "777"); got != "" {
		t.Errorf("unknown uid = %q", got)
	}
}

// TestResolveWindowsShellOrder: pwsh → Windows PowerShell → COMSPEC → cmd.exe.
func TestResolveWindowsShellOrder(t *testing.T) {
	notFound := func(string) (string, error) { return "", errors.New("not found") }
	pwsh := func(string) (string, error) { return `C:\pwsh\pwsh.exe`, nil }
	yes := func(string) bool { return true }
	no := func(string) bool { return false }
	if got, args := resolveWindowsShell(pwsh, yes, `C:\Windows`, "cmd"); got != `C:\pwsh\pwsh.exe` || len(args) != 1 {
		t.Errorf("pwsh: %q %v", got, args)
	}
	if got, _ := resolveWindowsShell(notFound, yes, `C:\Windows`, "cmd"); !strings.HasSuffix(got, "powershell.exe") {
		t.Errorf("windows powershell: %q", got)
	}
	if got, args := resolveWindowsShell(notFound, no, `C:\Windows`, `C:\Windows\cmd.exe`); got != `C:\Windows\cmd.exe` || args != nil {
		t.Errorf("comspec: %q %v", got, args)
	}
	if got, _ := resolveWindowsShell(notFound, no, "", ""); got != "cmd.exe" {
		t.Errorf("last resort: %q", got)
	}
}

// TestClampSize normalizes unknown and extreme sizes.
func TestClampSize(t *testing.T) {
	cases := [][4]int{{0, 0, 80, 24}, {-5, 3, 80, 3}, {1, 0, 2, 24}, {5000, 9000, 1000, 500}, {120, 40, 120, 40}}
	for _, c := range cases {
		if cols, rows := ClampSize(c[0], c[1]); cols != c[2] || rows != c[3] {
			t.Errorf("ClampSize(%d,%d) = %d,%d; want %d,%d", c[0], c[1], cols, rows, c[2], c[3])
		}
	}
}
