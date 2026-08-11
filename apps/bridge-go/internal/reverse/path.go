// Package reverse implements agent→client reverse services (fs + terminal)
// and workspace path sandbox helpers matching Node workspacePath.ts.
package reverse

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// IsRelativeOutsideWorkspace reports whether a filepath.Rel result leaves the root.
// Only ".." and ".."+sep count as parent escapes (not names like "..foo").
func IsRelativeOutsideWorkspace(rel string) bool {
	if rel == "" {
		return false
	}
	if filepath.IsAbs(rel) {
		return true
	}
	if rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return true
	}
	return false
}

// ResolveWorkspacePath resolves a client-supplied path under workspace and rejects escapes.
// workspaceAbs: absolute workspace root (already resolved).
// requested: relative or absolute path from the agent reverse request; empty means ".".
// Existing paths are EvalSymlinks'd so in-workspace symlinks cannot escape (QA-REV-14).
// Returns absolute path inside workspace, or error when the resolved path leaves the workspace
// (including `..`, prefix-neighbor, absolute paths outside root, and symlink escape).
func ResolveWorkspacePath(workspaceAbs, requested string) (string, error) {
	rootLexical, err := filepath.Abs(workspaceAbs)
	if err != nil {
		return "", err
	}
	rootLexical = filepath.Clean(rootLexical)
	realRoot := rootLexical
	if r, err := filepath.EvalSymlinks(rootLexical); err == nil {
		realRoot = r
	}
	raw := requested
	if raw == "" {
		raw = "."
	}
	if strings.Contains(raw, "\x00") {
		return "", fmt.Errorf("path outside workspace: %s", requested)
	}
	var abs string
	if filepath.IsAbs(raw) {
		// Remap absolute paths through realRoot so /var vs /private/var aliases work.
		absReq, errAbs := filepath.Abs(raw)
		if errAbs != nil {
			return "", errAbs
		}
		absReq = filepath.Clean(absReq)
		if IsPathInsideWorkspace(rootLexical, absReq) {
			rel, errRel := filepath.Rel(rootLexical, absReq)
			if errRel != nil {
				return "", fmt.Errorf("path outside workspace: %s", requested)
			}
			abs = filepath.Join(realRoot, rel)
		} else if IsPathInsideWorkspace(realRoot, absReq) {
			abs = absReq
		} else if realReq, errEv := filepath.EvalSymlinks(absReq); errEv == nil && IsPathInsideWorkspace(realRoot, realReq) {
			return realReq, nil
		} else {
			return "", fmt.Errorf("path outside workspace: %s", requested)
		}
	} else {
		abs = filepath.Join(realRoot, raw)
	}
	abs, err = filepath.Abs(abs)
	if err != nil {
		return "", err
	}
	abs = filepath.Clean(abs)
	if !IsPathInsideWorkspace(realRoot, abs) {
		return "", fmt.Errorf("path outside workspace: %s", requested)
	}
	return enforceRealpathInside(realRoot, abs, requested)
}

// enforceRealpathInside realpaths existing targets / parents so symlink escapes fail.
// Parents outside the workspace root are never evaluated (missing workspace paths stay lexical).
func enforceRealpathInside(realRoot, absLexical, raw string) (string, error) {
	if _, err := os.Lstat(absLexical); err == nil {
		real, err := filepath.EvalSymlinks(absLexical)
		if err != nil {
			// Dangling symlink or unreadable — treat as outside for safety.
			return "", fmt.Errorf("path outside workspace: %s", raw)
		}
		if !IsPathInsideWorkspace(realRoot, real) {
			return "", fmt.Errorf("path outside workspace: %s", raw)
		}
		return real, nil
	}

	parent := filepath.Dir(absLexical)
	cur := absLexical
	for parent != cur && IsPathInsideWorkspace(realRoot, parent) {
		if _, err := os.Lstat(parent); err == nil {
			realParent, err := filepath.EvalSymlinks(parent)
			if err != nil {
				return "", fmt.Errorf("path outside workspace: %s", raw)
			}
			if !IsPathInsideWorkspace(realRoot, realParent) {
				return "", fmt.Errorf("path outside workspace: %s", raw)
			}
			relFromParent, err := filepath.Rel(parent, absLexical)
			if err != nil {
				return "", fmt.Errorf("path outside workspace: %s", raw)
			}
			finalAbs := filepath.Clean(filepath.Join(realParent, relFromParent))
			if !IsPathInsideWorkspace(realRoot, finalAbs) {
				return "", fmt.Errorf("path outside workspace: %s", raw)
			}
			return finalAbs, nil
		}
		cur = parent
		parent = filepath.Dir(parent)
	}

	if !IsPathInsideWorkspace(realRoot, absLexical) {
		return "", fmt.Errorf("path outside workspace: %s", raw)
	}
	return absLexical, nil
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
	return !IsRelativeOutsideWorkspace(rel)
}
