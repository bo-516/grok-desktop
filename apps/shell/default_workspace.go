package main

import (
	"os"
	"path/filepath"
	"strings"
)

// ProductWorkspaceFolder is the leaf under the user's Documents directory
// used as the default agent workspace in production. Keep in sync with
// apps/bridge/src/defaultWorkspace.ts and bridge-go session.ProductWorkspaceFolder.
const ProductWorkspaceFolder = "Grok"

// UserDocumentsDir is the OS user Documents folder.
// macOS / Windows / Linux all use the Documents leaf so the product path is
// the same shape. XDG_DOCUMENTS_DIR wins when set. homeDir empty falls back
// to os.UserHomeDir / %USERPROFILE%; missing both yields "Documents" under
// an empty prefix rather than panicking.
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

// ProductionWorkspaceDir is <Documents>/Grok — packaged-app default cwd.
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
