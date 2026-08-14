package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// TestBridgeEnv_Overrides sets BRIDGE_* and preserves unrelated parent vars.
func TestBridgeEnv_Overrides(t *testing.T) {
	parent := []string{"PATH=/usr/bin", "BRIDGE_PORT=1", "FOO=bar"}
	out := bridgeEnv(parent, BridgeLaunchParams{
		Port:           9999,
		Token:          "tok",
		Host:           "127.0.0.1",
		AllowedOrigins: "null,file://",
		Cwd:            "/tmp/ws",
	})
	m := map[string]string{}
	for _, e := range out {
		parts := strings.SplitN(e, "=", 2)
		if len(parts) == 2 {
			m[parts[0]] = parts[1]
		}
	}
	if m["BRIDGE_PORT"] != "9999" {
		t.Fatalf("port: %q", m["BRIDGE_PORT"])
	}
	if m["BRIDGE_TOKEN"] != "tok" {
		t.Fatalf("token: %q", m["BRIDGE_TOKEN"])
	}
	if m["BRIDGE_HOST"] != "127.0.0.1" {
		t.Fatalf("host: %q", m["BRIDGE_HOST"])
	}
	if m["BRIDGE_CWD"] != "/tmp/ws" {
		t.Fatalf("cwd: %q", m["BRIDGE_CWD"])
	}
	if m["FOO"] != "bar" {
		t.Fatalf("parent FOO lost: %v", m)
	}
	if m["PATH"] != "/usr/bin" {
		t.Fatalf("PATH lost: %v", m)
	}
}

// TestDefaultAllowedOrigins_IncludesWailsAndNull covers shell packaging origins.
func TestDefaultAllowedOrigins_IncludesWailsAndNull(t *testing.T) {
	s := DefaultAllowedOrigins()
	for _, need := range []string{
		"null",
		"file://",
		"wails://localhost",
		"wails://wails.localhost",
		"https://wails.localhost",
	} {
		if !strings.Contains(s, need) {
			t.Fatalf("missing %q in %q", need, s)
		}
	}
}

func TestStartBridge_PackagedEmptyRepoUsesDocumentsGrok(t *testing.T) {
	t.Setenv("BRIDGE_CWD", "")
	dir := t.TempDir()
	restoreExe(t, filepath.Join(dir, "grok-desktop"))
	buildFakeListeningBridge(t, filepath.Join(dir, "bridge-go"))

	port, err := PickFreePort()
	if err != nil {
		t.Fatal(err)
	}
	bp, err := StartBridge(BridgeLaunchParams{
		Impl:     BridgeImplGo,
		Port:     port,
		Token:    "packaged-token",
		Host:     "127.0.0.1",
		RepoRoot: "",
	})
	if err != nil {
		t.Fatalf("StartBridge packaged: %v", err)
	}
	defer bp.Stop()

	want := DefaultBridgeCWD("")
	if bp.Dir() != want {
		t.Fatalf("cmd.Dir=%q want production workspace %q", bp.Dir(), want)
	}
	if st, err := os.Stat(want); err != nil || !st.IsDir() {
		t.Fatalf("production workspace must exist: %s err=%v", want, err)
	}
}

func TestStartBridge_NodeEmptyRepoIsSourceCheckoutError(t *testing.T) {
	_, err := StartBridge(BridgeLaunchParams{
		Impl:     BridgeImplNode,
		Port:     1,
		Token:    "tok",
		RepoRoot: "",
	})
	if err == nil {
		t.Fatal("expected source-checkout error")
	}
	msg := err.Error()
	if !strings.Contains(msg, "source checkout") {
		t.Fatalf("want source checkout, got %q", msg)
	}
	if strings.Contains(strings.ToLower(msg), "tsx") {
		t.Fatalf("must not mention tsx: %q", msg)
	}
}

func TestStartBridge_CheckoutUsesRepoRootAsCwd(t *testing.T) {
	t.Setenv("BRIDGE_CWD", "")
	repo := writeRepoMarker(t)
	binDir := filepath.Join(repo, "apps", "bridge-go", "bin")
	if err := os.MkdirAll(binDir, 0o755); err != nil {
		t.Fatal(err)
	}
	buildFakeListeningBridge(t, filepath.Join(binDir, "bridge-go"))

	port, err := PickFreePort()
	if err != nil {
		t.Fatal(err)
	}
	bp, err := StartBridge(BridgeLaunchParams{
		Impl:     BridgeImplGo,
		Port:     port,
		Token:    "dev-token",
		Host:     "127.0.0.1",
		RepoRoot: repo,
	})
	if err != nil {
		t.Fatalf("StartBridge checkout: %v", err)
	}
	defer bp.Stop()
	if bp.Dir() != repo {
		t.Fatalf("cmd.Dir=%q want repo %q", bp.Dir(), repo)
	}
}

func TestStartBridge_BridgeCwdWinsWithAndWithoutRepo(t *testing.T) {
	custom := t.TempDir()
	t.Setenv("BRIDGE_CWD", custom)

	dir := t.TempDir()
	restoreExe(t, filepath.Join(dir, "grok-desktop"))
	buildFakeListeningBridge(t, filepath.Join(dir, "bridge-go"))
	port, err := PickFreePort()
	if err != nil {
		t.Fatal(err)
	}
	bp, err := StartBridge(BridgeLaunchParams{
		Impl:     BridgeImplGo,
		Port:     port,
		Token:    "cwd-empty-repo",
		Host:     "127.0.0.1",
		RepoRoot: "",
	})
	if err != nil {
		t.Fatalf("empty repo: %v", err)
	}
	if bp.Dir() != custom {
		t.Fatalf("empty repo cmd.Dir=%q want %q", bp.Dir(), custom)
	}
	bp.Stop()

	repo := writeRepoMarker(t)
	binDir := filepath.Join(repo, "apps", "bridge-go", "bin")
	if err := os.MkdirAll(binDir, 0o755); err != nil {
		t.Fatal(err)
	}
	buildFakeListeningBridge(t, filepath.Join(binDir, "bridge-go"))
	port2, err := PickFreePort()
	if err != nil {
		t.Fatal(err)
	}
	bp2, err := StartBridge(BridgeLaunchParams{
		Impl:     BridgeImplGo,
		Port:     port2,
		Token:    "cwd-with-repo",
		Host:     "127.0.0.1",
		RepoRoot: repo,
	})
	if err != nil {
		t.Fatalf("with repo: %v", err)
	}
	defer bp2.Stop()
	if bp2.Dir() != custom {
		t.Fatalf("with repo cmd.Dir=%q want %q", bp2.Dir(), custom)
	}
}

// buildFakeListeningBridge compiles a tiny TCP listener that binds BRIDGE_PORT
// so StartBridge.WaitUntilListening can succeed without grok-build.
func buildFakeListeningBridge(t *testing.T, outPath string) {
	t.Helper()
	src := filepath.Join(t.TempDir(), "fake_bridge.go")
	const body = `package main
import (
	"net"
	"os"
	"time"
)
func main() {
	ln, err := net.Listen("tcp", "127.0.0.1:"+os.Getenv("BRIDGE_PORT"))
	if err != nil {
		os.Exit(1)
	}
	defer ln.Close()
	time.Sleep(60 * time.Second)
}
`
	if err := os.WriteFile(src, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command("go", "build", "-o", outPath, src)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("go build fake bridge: %v\n%s", err, out)
	}
}
