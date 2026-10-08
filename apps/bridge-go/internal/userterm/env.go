package userterm

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/xai-org/grok-desktop/apps/bridge-go/pkg/workspacepath"
)

// termProgram is exported to shells as TERM_PROGRAM so dotfiles can detect the app.
const termProgram = "grok-desktop"

// defaultLocale is exported as LANG on unix when the bridge inherited no locale
// at all (apps launched from Finder get none), so zsh/bash do not fall back to
// the C locale and mangle UTF-8 input.
const defaultLocale = "en_US.UTF-8"

// BuildEnv derives the environment for an interactive user terminal.
//
// Unlike agent children (F-CFG-05 whitelist), a user terminal is the user's own
// shell and inherits the bridge environment — except BRIDGE_* variables, which
// carry the WebSocket auth token and must never leak into commands the user
// (or a script they run) executes. Terminal identity variables are forced so
// colors and key handling match xterm.js.
//
// @param parent os.Environ()-style KEY=value pairs; malformed entries (no '=')
// are dropped.
// @param goos Target OS (runtime.GOOS); "windows" skips the unix locale default
// and PWD (cmd / PowerShell do not read it).
// @param cwd Absolute start directory, exported as PWD on unix so the shell's
// logical path matches where it starts; parent PWD / OLDPWD are dropped.
// @returns A new KEY=value slice; parent is not modified.
func BuildEnv(parent []string, goos, cwd string) []string {
	forced := map[string]string{
		"TERM":         "xterm-256color",
		"COLORTERM":    "truecolor",
		"TERM_PROGRAM": termProgram,
	}
	out := make([]string, 0, len(parent)+len(forced)+1)
	hasLocale := false
	for _, kv := range parent {
		eq := strings.IndexByte(kv, '=')
		if eq <= 0 {
			continue
		}
		key := kv[:eq]
		if strings.HasPrefix(strings.ToUpper(key), "BRIDGE_") {
			continue
		}
		if _, ok := forced[key]; ok || key == "PWD" || key == "OLDPWD" {
			continue
		}
		if (key == "LANG" || key == "LC_ALL" || key == "LC_CTYPE") && kv[eq+1:] != "" {
			hasLocale = true
		}
		out = append(out, kv)
	}
	for _, key := range []string{"TERM", "COLORTERM", "TERM_PROGRAM"} {
		out = append(out, key+"="+forced[key])
	}
	if goos != "windows" {
		if !hasLocale {
			out = append(out, "LANG="+defaultLocale)
		}
		if cwd != "" {
			out = append(out, "PWD="+cwd)
		}
	}
	return out
}

// ResolveCwd validates the working directory for a new terminal.
//
// @param root Absolute workspace root (the session workspace or the bridge
// default). Must exist and be a directory.
// @param sub Optional path under root (relative, or absolute inside root).
// Empty means root itself. Escapes (.., symlinks out of root) are rejected by
// workspacepath.ResolveWorkspacePath.
// @returns The absolute directory to start the shell in, or an error naming
// the reason (relative root, missing directory, escape, not a directory).
func ResolveCwd(root, sub string) (string, error) {
	if root == "" {
		return "", fmt.Errorf("terminal cwd is required")
	}
	if !filepath.IsAbs(root) {
		return "", fmt.Errorf("terminal cwd must be absolute: %s", root)
	}
	info, err := os.Stat(root)
	if err != nil {
		return "", fmt.Errorf("terminal cwd not found: %s", root)
	}
	if !info.IsDir() {
		return "", fmt.Errorf("terminal cwd is not a directory: %s", root)
	}
	dir, err := workspacepath.ResolveWorkspacePath(root, sub)
	if err != nil {
		return "", err
	}
	info, err = os.Stat(dir)
	if err != nil || !info.IsDir() {
		return "", fmt.Errorf("terminal cwd is not a directory: %s", dir)
	}
	return dir, nil
}
