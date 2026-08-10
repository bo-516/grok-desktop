// Package reverse implements agent→client reverse services (fs + terminal)
// and workspace path sandbox helpers matching Node workspacePath.ts.
package reverse

import (
	"fmt"
	"path/filepath"
	"strings"
)

// ResolveWorkspacePath resolves a client-supplied path under workspace and rejects escapes.
// workspaceAbs: absolute workspace root (already resolved).
// requested: relative or absolute path from the agent reverse request; empty means ".".
// Returns absolute path inside workspace, or error when the resolved path leaves the workspace
// (including `..`, prefix-neighbor, and absolute paths outside root).
func ResolveWorkspacePath(workspaceAbs, requested string) (string, error) {
	root, err := filepath.Abs(workspaceAbs)
	if err != nil {
		return "", err
	}
	root = filepath.Clean(root)
	raw := requested
	if raw == "" {
		raw = "."
	}
	abs := raw
	if !filepath.IsAbs(raw) {
		abs = filepath.Join(root, raw)
	}
	abs, err = filepath.Abs(abs)
	if err != nil {
		return "", err
	}
	abs = filepath.Clean(abs)
	if !IsPathInsideWorkspace(root, abs) {
		return "", fmt.Errorf("path outside workspace: %s", requested)
	}
	return abs, nil
}

// IsPathInsideWorkspace reports whether candidateAbs is root or a descendant.
// Uses filepath.Rel (not string prefix) so neighbor dirs like demo-evil cannot slip past.
func IsPathInsideWorkspace(workspaceAbs, candidateAbs string) bool {
	root, err := filepath.Abs(workspaceAbs)
	if err != nil {
		return false
	}
	root = filepath.Clean(root)
	abs, err := filepath.Abs(candidateAbs)
	if err != nil {
		return false
	}
	abs = filepath.Clean(abs)
	if root == abs {
		return true
	}
	rel, err := filepath.Rel(root, abs)
	if err != nil {
		return false
	}
	// Outside or different volume: relative starts with .. or is absolute
	if rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return false
	}
	if filepath.IsAbs(rel) {
		return false
	}
	return true
}
