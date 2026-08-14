package session

import (
	"os"
	"path/filepath"
	"strings"
)

// ProductWorkspaceFolder is the leaf under the user's Documents directory
// used as the default agent workspace in production.
const ProductWorkspaceFolder = "Grok"

// repoMarker is the monorepo file that identifies a grok-desktop checkout.
// Same relative path the Node bridge and the Wails shell walk for.
const repoMarker = "apps/bridge/src/server.ts"

// FindRepoRoot walks upward from start looking for the grok-desktop monorepo.
// start empty uses the process working directory. Returns "" when no checkout
// is nearby (packaged / production). Depth is capped so a walk from / cannot
// hang.
func FindRepoRoot(start string) string {
	dir := strings.TrimSpace(start)
	if dir == "" {
		wd, err := os.Getwd()
		if err != nil {
			return ""
		}
		dir = wd
	}
	abs, err := filepath.Abs(dir)
	if err != nil {
		return ""
	}
	dir = abs
	for i := 0; i < 12; i++ {
		if st, err := os.Stat(filepath.Join(dir, filepath.FromSlash(repoMarker))); err == nil && !st.IsDir() {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	return ""
}

// UserDocumentsDir is the OS user Documents folder.
// macOS / Windows / Linux all use the Documents leaf so the product path is
// the same shape. XDG_DOCUMENTS_DIR wins when set. homeDir empty falls back
// to $HOME / %USERPROFILE%; missing both yields "Documents" under an empty
// prefix rather than panicking.
func UserDocumentsDir(homeDir string) string {
	if xdg := strings.TrimSpace(os.Getenv("XDG_DOCUMENTS_DIR")); xdg != "" {
		if abs, err := filepath.Abs(xdg); err == nil {
			return abs
		}
		return xdg
	}
	home := strings.TrimSpace(homeDir)
	if home == "" {
		if h, err := os.UserHomeDir(); err == nil {
			home = h
		}
	}
	if home == "" {
		home = strings.TrimSpace(os.Getenv("USERPROFILE"))
	}
	return filepath.Join(home, "Documents")
}

// ProductionWorkspaceDir is <Documents>/Grok — the packaged-app default cwd.
// homeDir is forwarded to UserDocumentsDir (tests inject a temp home).
func ProductionWorkspaceDir(homeDir string) string {
	return filepath.Join(UserDocumentsDir(homeDir), ProductWorkspaceFolder)
}

// EnsureWorkspaceDir creates dir (and parents) so grok has a real cwd.
// Empty dir is returned unchanged. Mkdir errors are ignored; spawn reports them.
func EnsureWorkspaceDir(dir string) string {
	trimmed := strings.TrimSpace(dir)
	if trimmed == "" {
		return dir
	}
	_ = os.MkdirAll(trimmed, 0o755)
	return trimmed
}

// ResolveDefaultWorkspaceCwd picks the agent workspace when none is selected.
// Order: BRIDGE_CWD → monorepo root walked from start (dev) → <Documents>/Grok
// (prod). start is the only walk origin — empty uses the process working
// directory. Callers that already tried the executable must pass cwd themselves
// so tests can isolate with a bare temp dir. Never returns empty when a home
// directory exists.
func ResolveDefaultWorkspaceCwd(start string) string {
	if v := strings.TrimSpace(os.Getenv("BRIDGE_CWD")); v != "" {
		if abs, err := filepath.Abs(v); err == nil {
			return abs
		}
		return v
	}
	if repo := FindRepoRoot(start); repo != "" {
		return repo
	}
	return EnsureWorkspaceDir(ProductionWorkspaceDir(""))
}
