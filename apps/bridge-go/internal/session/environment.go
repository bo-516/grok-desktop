// Package session owns runtime lifecycle, disk session list, workspace entries,
// and local environment probes for the Go bridge.
package session

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/xai-org/grok-desktop/apps/bridge-go/internal/spawn"
)

// EnvironmentInfo is the CLI / login probe result (secrets never included).
type EnvironmentInfo struct {
	GrokPath        *string `json:"grokPath"`
	Version         *string `json:"version"`
	Authed          bool    `json:"authed"`
	AuthSource      string  `json:"authSource"` // xai_api_key | cached_token | none
	AuthPathChecked string  `json:"authPathChecked"`
	OK              bool    `json:"ok"`
	Message         string  `json:"message"`
	PoolCapacity    int     `json:"poolCapacity"`
}

// PoolCapacityFromEnv reads BRIDGE_POOL_CAPACITY (default 8, max 16).
// @returns Effective capacity in [1, 16]; invalid/empty env falls back to 8.
func PoolCapacityFromEnv() int {
	raw := os.Getenv("BRIDGE_POOL_CAPACITY")
	if raw == "" {
		return 8
	}
	n := 0
	for _, c := range raw {
		if c < '0' || c > '9' {
			return 8
		}
		n = n*10 + int(c-'0')
	}
	if n < 1 {
		return 8
	}
	if n > 16 {
		return 16
	}
	return n
}

// DefaultAuthJSONPath resolves ~/.grok/auth.json.
func DefaultAuthJSONPath() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".grok", "auth.json")
}

// ProbeAuthSource checks XAI_API_KEY then local cached_token file.
func ProbeAuthSource() (authed bool, authSource, authPathChecked string) {
	authPathChecked = DefaultAuthJSONPath()
	if key := strings.TrimSpace(os.Getenv("XAI_API_KEY")); key != "" {
		return true, "xai_api_key", authPathChecked
	}
	if st, err := os.Stat(authPathChecked); err == nil && !st.IsDir() {
		return true, "cached_token", authPathChecked
	}
	return false, "none", authPathChecked
}

// ReadGrokVersion runs `grok --version` with a soft timeout.
func ReadGrokVersion(bin string, timeoutMs int) *string {
	if timeoutMs <= 0 {
		timeoutMs = 3000
	}
	cmd := exec.Command(bin, "--version")
	cmd.Env = os.Environ()
	spawn.HideConsoleWindow(cmd)
	done := make(chan string, 1)
	go func() {
		out, err := cmd.CombinedOutput()
		if err != nil && len(out) == 0 {
			done <- ""
			return
		}
		lines := strings.Split(string(out), "\n")
		for _, line := range lines {
			if t := strings.TrimSpace(line); t != "" {
				done <- t
				return
			}
		}
		done <- ""
	}()
	select {
	case v := <-done:
		if v == "" {
			return nil
		}
		return &v
	case <-time.After(time.Duration(timeoutMs) * time.Millisecond):
		_ = cmd.Process.Kill()
		return nil
	}
}

// CheckEnvironment aggregates CLI + login probe results.
// Version support check is T3 on Go bridge — we skip hard version gates and
// only require binary found + auth present for ok=true.
func CheckEnvironment(poolCapacity int) EnvironmentInfo {
	if poolCapacity < 1 {
		poolCapacity = PoolCapacityFromEnv()
	}
	authed, authSource, authPath := ProbeAuthSource()
	bin, err := spawn.ResolveGrokBin()
	if err != nil {
		return EnvironmentInfo{
			GrokPath: nil, Version: nil, Authed: authed, AuthSource: authSource,
			AuthPathChecked: authPath, OK: false,
			Message: err.Error(), PoolCapacity: poolCapacity,
		}
	}
	grokPath := bin
	version := ReadGrokVersion(bin, 3000)
	if !authed {
		return EnvironmentInfo{
			GrokPath: &grokPath, Version: version, Authed: false, AuthSource: "none",
			AuthPathChecked: authPath, OK: false,
			Message:      "No grok login detected: run `grok login` or set the XAI_API_KEY environment variable",
			PoolCapacity: poolCapacity,
		}
	}
	msg := "grok ready · auth=" + authSource
	if version != nil {
		msg = "grok ready · " + *version + " · auth=" + authSource
	}
	return EnvironmentInfo{
		GrokPath: &grokPath, Version: version, Authed: true, AuthSource: authSource,
		AuthPathChecked: authPath, OK: true, Message: msg, PoolCapacity: poolCapacity,
	}
}
