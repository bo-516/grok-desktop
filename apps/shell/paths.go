package main

import (
	"fmt"
	"os"
	"path/filepath"
)

// RepoRoot walks from start (or cwd) upward until it finds apps/bridge/src/server.ts
// or go.mod sibling markers that identify the monorepo root.
// Returns absolute path or error when not found within a reasonable depth.
func RepoRoot(start string) (string, error) {
	if start == "" {
		cwd, err := os.Getwd()
		if err != nil {
			return "", err
		}
		start = cwd
	}
	dir, err := filepath.Abs(start)
	if err != nil {
		return "", err
	}
	for i := 0; i < 12; i++ {
		marker := filepath.Join(dir, "apps", "bridge", "src", "server.ts")
		if st, err := os.Stat(marker); err == nil && !st.IsDir() {
			return dir, nil
		}
		// Also accept packaged layout: sibling apps/ next to executable's parent tree.
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	return "", fmt.Errorf("could not locate monorepo root (apps/bridge/src/server.ts) from %s", start)
}

// NodeBridgeScript returns the absolute path to the Node bridge entry script.
func NodeBridgeScript(repoRoot string) string {
	return filepath.Join(repoRoot, "apps", "bridge", "src", "server.ts")
}

// GoBridgeBinary candidates for the Go bridge (optional; first existing wins).
func GoBridgeBinaryCandidates(repoRoot string) []string {
	return []string{
		filepath.Join(repoRoot, "apps", "bridge-go", "bin", "bridge-go"),
		filepath.Join(repoRoot, "apps", "bridge-go", "bin", "bridge"),
		filepath.Join(repoRoot, "apps", "bridge-go", "bridge"),
		filepath.Join(repoRoot, "bin", "bridge-go"),
	}
}

// FindGoBridgeBinary returns the first existing Go bridge binary path, or "".
func FindGoBridgeBinary(repoRoot string) string {
	for _, p := range GoBridgeBinaryCandidates(repoRoot) {
		if st, err := os.Stat(p); err == nil && !st.IsDir() {
			return p
		}
	}
	return ""
}

// DefaultBridgeCWD is the demo workspace used when BRIDGE_CWD is unset.
func DefaultBridgeCWD(repoRoot string) string {
	return filepath.Join(repoRoot, "demo")
}

// ResolveTsx returns a command+args prefix to run TypeScript bridge entry.
// Prefers monorepo node_modules/.bin/tsx, then PATH tsx, then npx tsx.
func ResolveTsx(repoRoot string) (cmd string, argsPrefix []string, err error) {
	candidates := []string{
		filepath.Join(repoRoot, "node_modules", ".bin", "tsx"),
		filepath.Join(repoRoot, "apps", "bridge", "node_modules", ".bin", "tsx"),
	}
	for _, p := range candidates {
		if st, e := os.Stat(p); e == nil && !st.IsDir() {
			return p, nil, nil
		}
	}
	if path, e := lookPath("tsx"); e == nil {
		return path, nil, nil
	}
	if path, e := lookPath("npx"); e == nil {
		return path, []string{"tsx"}, nil
	}
	return "", nil, fmt.Errorf("tsx not found (install deps or put tsx on PATH)")
}

// lookPath is a thin wrapper so tests can stub if needed.
var lookPath = func(file string) (string, error) {
	return execLookPath(file)
}
