package userprompts

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// Managed file names (prefix order matters — see T-ORD-02).
const (
	GlobalFile       = "00-grok-desktop.md"
	ProjectLocalFile = "01-grok-desktop.local.md"
	LocalExcludeLine = ".grok/rules/*.local.md"
)

// PromptScopeState is one scope's on-disk state as read back by the bridge.
type PromptScopeState struct {
	Scope   PromptScope   `json:"scope"`
	Path    string        `json:"path"`
	Exists  bool          `json:"exists"`
	Foreign bool          `json:"foreign"`
	Entries []PromptEntry `json:"entries"`
	Bytes   int           `json:"bytes"`
}

// PromptsSnapshot is the reply of prompts_get.
type PromptsSnapshot struct {
	ProjectRoot   *string          `json:"projectRoot"`
	GitRepo       bool             `json:"gitRepo"`
	LocalExcluded bool             `json:"localExcluded"`
	Global        PromptScopeState `json:"global"`
	Project       PromptScopeState `json:"project"`
	ProjectLocal  PromptScopeState `json:"projectLocal"`
}

// PromptWriteResult is the success payload for set / clear / move sides.
type PromptWriteResult struct {
	Scope   PromptScope `json:"scope"`
	Path    string      `json:"path"`
	Bytes   int         `json:"bytes"`
	Removed bool        `json:"removed"`
}

// ResolveGrokHome returns GROK_HOME when set, else <userHome>/.grok.
func ResolveGrokHome() string {
	if v := strings.TrimSpace(os.Getenv("GROK_HOME")); v != "" {
		return filepath.Clean(v)
	}
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		return filepath.Join(".", ".grok")
	}
	return filepath.Join(home, ".grok")
}

// ResolveProjectRoot runs git rev-parse --show-toplevel in cwd.
// On failure returns cleaned cwd and gitRepo=false.
func ResolveProjectRoot(cwd string) (projectRoot string, gitRepo bool) {
	abs, err := filepath.Abs(cwd)
	if err != nil || abs == "" {
		abs = cwd
	}
	cmd := exec.Command("git", "-C", abs, "rev-parse", "--show-toplevel")
	out, err := cmd.Output()
	if err == nil {
		top := strings.TrimSpace(string(out))
		if top != "" {
			return filepath.Clean(top), true
		}
	}
	return abs, false
}

// ScopePath returns the absolute path for a managed scope file.
func ScopePath(scope PromptScope, grokHome, projectRoot string) string {
	switch scope {
	case ScopeGlobal:
		return filepath.Join(grokHome, "rules", GlobalFile)
	case ScopeProject:
		return filepath.Join(projectRoot, ".grok", "rules", GlobalFile)
	case ScopeProjectLocal:
		return filepath.Join(projectRoot, ".grok", "rules", ProjectLocalFile)
	default:
		return filepath.Join(grokHome, "rules", GlobalFile)
	}
}

// IsLocalExcluded reports whether .git/info/exclude hides *.local.md.
func IsLocalExcluded(projectRoot string) bool {
	excludePath := filepath.Join(projectRoot, ".git", "info", "exclude")
	raw, err := os.ReadFile(excludePath)
	if err != nil {
		return false
	}
	for _, line := range splitLines(string(raw)) {
		if strings.TrimSpace(line) == LocalExcludeLine {
			return true
		}
	}
	return false
}

// EnsureLocalExclude idempotently appends LocalExcludeLine; never touches .gitignore.
func EnsureLocalExclude(projectRoot string) bool {
	excludePath := filepath.Join(projectRoot, ".git", "info", "exclude")
	raw, err := os.ReadFile(excludePath)
	if err != nil {
		return false
	}
	body := string(raw)
	for _, line := range splitLines(body) {
		if strings.TrimSpace(line) == LocalExcludeLine {
			return true
		}
	}
	next := body
	if len(body) > 0 && !strings.HasSuffix(body, "\n") {
		next += "\n"
	}
	next += LocalExcludeLine + "\n"
	if err := os.WriteFile(excludePath, []byte(next), 0o644); err != nil {
		return false
	}
	return true
}
