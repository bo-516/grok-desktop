package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// executablePath is the running shell binary. Tests override this to inject
// a sibling fake bridge-go without depending on os.Executable's cache dir.
var executablePath = os.Executable

// RepoRoot walks from start (or cwd) upward until it finds apps/bridge/src/server.ts
// or go.mod sibling markers that identify the monorepo root.
// Returns absolute path or error when not found within a reasonable depth.
// Callers that treat missing markers as packaged mode should use
// ResolveOptionalRepoRoot — an empty repo root is not a start failure.
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

// ResolveOptionalRepoRoot is the shell start-path lookup: cwd, then the
// executable. Empty string means packaged mode (no monorepo markers).
func ResolveOptionalRepoRoot() string {
	return ResolveOptionalRepoRootFrom("", "")
}

// ResolveOptionalRepoRootFrom looks for monorepo markers from start, then exe.
// Empty start uses the process cwd; empty exe uses executablePath.
// Missing markers return "" — not an error.
func ResolveOptionalRepoRootFrom(start, exe string) string {
	if r, err := RepoRoot(start); err == nil {
		return r
	}
	exePath := exe
	if strings.TrimSpace(exePath) == "" {
		var err error
		exePath, err = executablePath()
		if err != nil || strings.TrimSpace(exePath) == "" {
			return ""
		}
	}
	if r, err := RepoRoot(exePath); err == nil {
		return r
	}
	return ""
}

// NodeBridgeScript returns the absolute path to the Node bridge entry script.
func NodeBridgeScript(repoRoot string) string {
	return filepath.Join(repoRoot, "apps", "bridge", "src", "server.ts")
}

// packagedBridgeCandidates are sibling / bundle-adjacent Go bridge names.
// Used when repoRoot is empty (packaged install next to the shell).
func packagedBridgeCandidates(exeDir string) []string {
	if strings.TrimSpace(exeDir) == "" {
		return nil
	}
	return []string{
		filepath.Join(exeDir, "bridge-go"),
		filepath.Join(exeDir, "bridge"),
		// macOS app bundle: Contents/MacOS/shell → Contents/Resources/bridge-go
		filepath.Join(exeDir, "..", "Resources", "bridge-go"),
		filepath.Join(exeDir, "Contents", "Resources", "bridge-go"),
	}
}

// GoBridgeBinaryCandidates lists paths StartBridge will try, first existing wins.
// Non-empty repoRoot: checkout layout only (dev). Empty repoRoot: executable-
// adjacent candidates only — never relative apps/bridge-go/... from cwd.
func GoBridgeBinaryCandidates(repoRoot string) []string {
	if strings.TrimSpace(repoRoot) != "" {
		return []string{
			filepath.Join(repoRoot, "apps", "bridge-go", "bin", "bridge-go"),
			filepath.Join(repoRoot, "apps", "bridge-go", "bin", "bridge"),
			filepath.Join(repoRoot, "apps", "bridge-go", "bridge"),
			filepath.Join(repoRoot, "bin", "bridge-go"),
		}
	}
	exe, err := executablePath()
	if err != nil || strings.TrimSpace(exe) == "" {
		return nil
	}
	return packagedBridgeCandidates(filepath.Dir(exe))
}

// FindGoBridgeBinary returns the first existing Go bridge binary path, or "".
// Empty repoRoot only searches next to the executable (and macOS Resources).
func FindGoBridgeBinary(repoRoot string) string {
	for _, p := range GoBridgeBinaryCandidates(repoRoot) {
		if st, err := os.Stat(p); err == nil && !st.IsDir() {
			return p
		}
	}
	return ""
}

// ResolveBridgeLaunchCwd is the process cwd passed to StartBridge.
// BRIDGE_CWD wins with or without a repo; otherwise DefaultBridgeCWD.
func ResolveBridgeLaunchCwd(repoRoot string) string {
	if v := strings.TrimSpace(os.Getenv("BRIDGE_CWD")); v != "" {
		return v
	}
	return DefaultBridgeCWD(repoRoot)
}

// DefaultBridgeCWD is the agent workspace when BRIDGE_CWD is unset.
// Source-tree (repoRoot non-empty): monorepo root so no-project chats live
// next to the code. Packaged / empty repoRoot: <Documents>/Grok (created).
// Passing a non-existent repoRoot still returns that path — the caller owns
// discovery; this helper does not re-walk the disk.
func DefaultBridgeCWD(repoRoot string) string {
	if strings.TrimSpace(repoRoot) != "" {
		return repoRoot
	}
	return EnsureWorkspaceDir(ProductionWorkspaceDir(""))
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
