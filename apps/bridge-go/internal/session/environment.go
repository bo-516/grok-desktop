// Package session owns runtime lifecycle, disk session list, workspace entries,
// and local environment probes for the Go bridge.
package session

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/xai-org/grok-desktop/apps/bridge-go/internal/grokbin"
	"github.com/xai-org/grok-desktop/apps/bridge-go/internal/spawn"
)

// minGrokVersion is the lowest grok CLI CheckEnvironment will mark ok.
// Floor matches the removed Node bridge: major.minor.patch 0.9.0.
const minGrokVersion = "0.9.0"

// defaultVersionProbeTimeout bounds one `grok --version` run when the caller
// passes no timeout. It is deliberately generous: the first exec of a newly
// installed or updated binary on macOS stalls while the system assesses it
// (measured 0.25-0.8s for a tiny script at idle and up to 5.7s under load),
// and a slow disk adds more. Too short and a healthy CLI is reported as
// broken; too long only delays the error for a CLI that truly hangs.
const defaultVersionProbeTimeout = 15 * time.Second

// versionProbeTimeout is the budget CheckEnvironment gives `grok --version`.
// A package var, not a const, only so tests can swap in a generous value for
// the happy path and a tiny one for the timeout path. Production never writes
// it; tests that do must not run in parallel (they already use t.Setenv).
var versionProbeTimeout = defaultVersionProbeTimeout

// versionProbeWaitDelay caps how long ReadGrokVersion keeps waiting for the
// output pipes after the CLI was killed (or exited). Without it a grandchild
// that inherited stdout would hold the pipe open and block past the timeout.
const versionProbeWaitDelay = time.Second

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
	// FailureKind is the structured reason OK is false (Failure* constants in
	// environment_failure.go); empty when OK.
	FailureKind string `json:"failureKind"`
	// MinVersion is the CLI floor this bridge enforces (minGrokVersion).
	MinVersion string `json:"minVersion"`
	// GrokPathSource says which rule found GrokPath (env / setting / default /
	// path); empty when no binary was located.
	GrokPathSource string `json:"grokPathSource"`
	// Setup lists the install / update commands offered on this host. The
	// desktop shows them verbatim and runs them only through grok_setup_run.
	Setup grokbin.Plans `json:"setup"`
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

// ReadGrokVersion runs `bin --version` and returns its first non-empty output
// line (stdout and stderr combined, trimmed). A non-zero exit still yields the
// line when the CLI printed one, so the version check can judge it.
//
// @param bin Path of the grok CLI, normally from spawn.ResolveGrokBin. A path
// that cannot be executed is not an error here: it reads as "no output".
// @param timeout Budget for the whole run; <= 0 uses defaultVersionProbeTimeout.
// On expiry the process is killed and its pipes are abandoned after
// versionProbeWaitDelay, so the call returns within about timeout + 1s even if
// a grandchild keeps stdout open.
// @returns line is the first non-empty line, or nil when the CLI printed
// nothing (failed exec, or exit without output). timedOut is true only when
// the deadline cut the run short; line is then nil, and callers should say the
// CLI was slow rather than call its output unparseable.
func ReadGrokVersion(bin string, timeout time.Duration) (line *string, timedOut bool) {
	if timeout <= 0 {
		timeout = defaultVersionProbeTimeout
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, bin, "--version")
	cmd.Env = os.Environ()
	cmd.WaitDelay = versionProbeWaitDelay
	spawn.HideConsoleWindow(cmd)
	out, err := cmd.CombinedOutput()
	// A clean exit wins even if the deadline passed meanwhile; only a run the
	// context killed (err set by the kill) counts as a timeout.
	if err != nil && ctx.Err() != nil {
		return nil, true
	}
	for _, raw := range strings.Split(string(out), "\n") {
		if t := strings.TrimSpace(raw); t != "" {
			return &t, false
		}
	}
	return nil, false
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

// grokVersionTimedOut is the verdict for a `grok --version` run that
// ReadGrokVersion killed at its deadline. Nothing is parsed: the CLI never
// answered, so the message names the wait instead of blaming the output
// (which is what the "Unable to parse … (null)" text would wrongly imply).
//
// @param timeout The budget that expired, printed as a Go duration ("15s").
// @param min Version floor, echoed so the text reads like the other failures.
// @returns OK false with empty Parsed and a message pointing at the CLI.
func grokVersionTimedOut(timeout time.Duration, min string) versionSupport {
	return versionSupport{
		OK: false,
		Message: fmt.Sprintf(
			"Timed out after %s waiting for `grok --version`; need ≥ %s. Run `grok --version` in a terminal to check the CLI.",
			timeout, min,
		),
	}
}

// CheckEnvironment aggregates CLI, version floor, and login probe results.
// Order matches the removed Node checker: missing binary, then version floor,
// then login. A logged-in user with grok < 0.9.0, an unparseable version, or a
// `grok --version` that outlives versionProbeTimeout still gets ok=false; the
// timeout has its own message so a slow CLI is not reported as unparseable.
// Every failure also carries a FailureKind so the UI never parses Message.
// The version probe can block for up to versionProbeTimeout (+ ~1s pipe
// drain), so run it off any path that must answer quickly.
//
// @param poolCapacity Echoed in the result; < 1 reads BRIDGE_POOL_CAPACITY.
// @returns The probe snapshot for the `environment` message; never carries secrets.
func CheckEnvironment(poolCapacity int) EnvironmentInfo {
	if poolCapacity < 1 {
		poolCapacity = PoolCapacityFromEnv()
	}
	authed, authSource, authPath := ProbeAuthSource()
	info := EnvironmentInfo{
		Authed: authed, AuthSource: authSource, AuthPathChecked: authPath,
		PoolCapacity: poolCapacity, MinVersion: minGrokVersion,
	}
	loc, err := grokbin.Locate()
	if err != nil {
		info.Message = err.Error()
		info.FailureKind = locateFailureKind(err)
		info.Setup = grokbin.PlansFor(runtime.GOOS, "")
		return info
	}
	grokPath := loc.Path
	info.GrokPath = &grokPath
	info.GrokPathSource = string(loc.Source)
	info.Setup = grokbin.PlansFor(runtime.GOOS, loc.Path)
	version, timedOut := ReadGrokVersion(loc.Path, versionProbeTimeout)
	info.Version = version
	support := grokVersionSupported(version, minGrokVersion)
	if timedOut {
		support = grokVersionTimedOut(versionProbeTimeout, minGrokVersion)
	}
	if !support.OK {
		info.Message = support.Message
		info.FailureKind = versionFailureKind(timedOut, support)
		return info
	}
	if !authed {
		info.AuthSource = "none"
		info.Message = "No grok login detected: run `grok login` or set the XAI_API_KEY environment variable"
		info.FailureKind = FailureSignedOut
		return info
	}
	info.OK = true
	info.Message = "grok ready · auth=" + authSource
	if version != nil {
		info.Message = "grok ready · " + *version + " · auth=" + authSource
	}
	return info
}
