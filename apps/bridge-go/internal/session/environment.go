// Package session owns runtime lifecycle, disk session list, workspace entries,
// and local environment probes for the Go bridge.
package session

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/xai-org/grok-desktop/apps/bridge-go/internal/spawn"
)

// minGrokVersion is the lowest grok CLI CheckEnvironment will mark ok.
// Floor matches the removed Node bridge: major.minor.patch 0.9.0.
const minGrokVersion = "0.9.0"

// semverPattern finds the first major.minor.patch in a version line.
// Extra text such as "grok 1.0.0 (abc)" is ignored after the triple.
var semverPattern = regexp.MustCompile(`(\d+)\.(\d+)\.(\d+)`)

// versionSupport is the outcome of comparing one grok --version line to a floor.
type versionSupport struct {
	// OK is true only when both sides parsed and the CLI is at or above the floor.
	OK bool
	// Message is the UI string. Failure text matches the old Node checker byte for byte.
	Message string
	// Parsed is "major.minor.patch" when parsing succeeded, otherwise empty.
	Parsed string
}

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

// AuthProbe is the cheap auth-only subset of EnvironmentInfo, sent as the
// `auth_state` answer to `check_auth`. Field names mirror EnvironmentInfo so
// the desktop can read either message with the same accessor.
type AuthProbe struct {
	Authed          bool   `json:"authed"`
	AuthSource      string `json:"authSource"` // xai_api_key | cached_token | none
	AuthPathChecked string `json:"authPathChecked"`
}

// ProbeAuth wraps ProbeAuthSource in the wire struct for `auth_state`.
// No subprocess is involved (env read + one stat), which is what makes this
// safe on the desktop's 3s login poll; CheckEnvironment is not.
//
// @returns Login state, winning credential source, and the path stat-ed.
func ProbeAuth() AuthProbe {
	authed, source, path := ProbeAuthSource()
	return AuthProbe{Authed: authed, AuthSource: source, AuthPathChecked: path}
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

// parseSemver returns the first major.minor.patch in raw.
// Empty raw or no triple returns nil. Non-digit captures cannot occur
// because the pattern is `\d+`.
func parseSemver(raw string) *[3]int {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	m := semverPattern.FindStringSubmatch(raw)
	if m == nil {
		return nil
	}
	var out [3]int
	for i := 0; i < 3; i++ {
		n, err := strconv.Atoi(m[i+1])
		if err != nil {
			return nil
		}
		out[i] = n
	}
	return &out
}

// compareSemver returns -1 when a<b, 0 when equal, 1 when a>b.
// Comparison is numeric per component, not lexical. a and b must be non-nil;
// a nil argument is a caller bug and panics.
func compareSemver(a, b *[3]int) int {
	for i := 0; i < 3; i++ {
		if a[i] < b[i] {
			return -1
		}
		if a[i] > b[i] {
			return 1
		}
	}
	return 0
}

func formatSemver(v *[3]int) string {
	return fmt.Sprintf("%d.%d.%d", v[0], v[1], v[2])
}

// grokVersionSupported reports whether versionRaw meets min.
// versionRaw nil is shown as "null". A non-nil empty string is shown empty.
// min that itself has no major.minor.patch yields the unable-to-parse message.
// Returns OK false with the upgrade sentence when the CLI is below min.
func grokVersionSupported(versionRaw *string, min string) versionSupport {
	raw := ""
	display := "null"
	if versionRaw != nil {
		raw = *versionRaw
		display = *versionRaw
	}
	parsed := parseSemver(raw)
	minParsed := parseSemver(min)
	if parsed == nil || minParsed == nil {
		return versionSupport{
			OK:      false,
			Message: fmt.Sprintf("Unable to parse grok version (%s); need ≥ %s", display, min),
		}
	}
	pretty := formatSemver(parsed)
	if compareSemver(parsed, minParsed) < 0 {
		return versionSupport{
			OK:      false,
			Message: fmt.Sprintf("grok %s is below the minimum supported version %s. Please upgrade the CLI.", pretty, min),
			Parsed:  pretty,
		}
	}
	return versionSupport{OK: true, Message: "grok " + pretty + " ok", Parsed: pretty}
}

// CheckEnvironment aggregates CLI, version floor, and login probe results.
// Order matches the removed Node checker: missing binary, then version floor,
// then login. A logged-in user with grok < 0.9.0 or an unparseable version
// still gets ok=false. poolCapacity < 1 reads BRIDGE_POOL_CAPACITY.
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
	support := grokVersionSupported(version, minGrokVersion)
	if !support.OK {
		return EnvironmentInfo{
			GrokPath: &grokPath, Version: version, Authed: authed, AuthSource: authSource,
			AuthPathChecked: authPath, OK: false,
			Message: support.Message, PoolCapacity: poolCapacity,
		}
	}
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
