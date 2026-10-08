package session

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/xai-org/grok-desktop/apps/bridge-go/internal/grokbin"
)

// isolateHome points HOME and the user config dir at a temp dir and clears
// GROK_BIN / XAI_API_KEY / PATH, so neither a real grok install, a saved
// custom path, nor a real credential on this machine leaks into the probe.
func isolateHome(t *testing.T) {
	t.Helper()
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(home, ".config"))
	t.Setenv("APPDATA", filepath.Join(home, "AppData"))
	t.Setenv("GROK_BIN", "")
	t.Setenv("XAI_API_KEY", "")
	t.Setenv("PATH", "")
}

func TestLocateFailureKindMapping(t *testing.T) {
	invalid := &grokbin.LocateError{Kind: grokbin.KindBinInvalid}
	missing := &grokbin.LocateError{Kind: grokbin.KindNotInstalled}
	if got := locateFailureKind(invalid); got != FailureBinInvalid {
		t.Fatalf("bin_invalid → %q", got)
	}
	if got := locateFailureKind(missing); got != FailureNotInstalled {
		t.Fatalf("not_installed → %q", got)
	}
	if got := locateFailureKind(errors.New("other")); got != FailureNotInstalled {
		t.Fatalf("unknown error → %q", got)
	}
}

func TestVersionFailureKindMapping(t *testing.T) {
	if got := versionFailureKind(true, versionSupport{}); got != FailureProbeTimeout {
		t.Fatalf("timeout → %q", got)
	}
	if got := versionFailureKind(false, versionSupport{Parsed: "0.8.9"}); got != FailureTooOld {
		t.Fatalf("parsed below floor → %q", got)
	}
	if got := versionFailureKind(false, versionSupport{}); got != FailureVersionUnreadable {
		t.Fatalf("nothing parsed → %q", got)
	}
}

func TestCheckEnvironmentNotInstalledOffersInstallerOnly(t *testing.T) {
	isolateHome(t)
	info := CheckEnvironment(8)
	if info.OK || info.FailureKind != FailureNotInstalled {
		t.Fatalf("want not_installed, got ok=%v kind=%q msg=%q", info.OK, info.FailureKind, info.Message)
	}
	if info.GrokPath != nil || info.GrokPathSource != "" {
		t.Fatalf("no path expected: %v %q", info.GrokPath, info.GrokPathSource)
	}
	if info.Setup.Install.Display == "" || info.Setup.Update != nil {
		t.Fatalf("setup plans %+v", info.Setup)
	}
	if info.MinVersion != minGrokVersion {
		t.Fatalf("minVersion %q", info.MinVersion)
	}
}

func TestCheckEnvironmentBinInvalidForMissingGrokBin(t *testing.T) {
	isolateHome(t)
	t.Setenv("GROK_BIN", filepath.Join(t.TempDir(), "missing-grok"))
	info := CheckEnvironment(8)
	if info.FailureKind != FailureBinInvalid {
		t.Fatalf("want bin_invalid, got %q (%s)", info.FailureKind, info.Message)
	}
}

// Each version verdict maps to its own kind, and a bad version outranks a
// missing login (the CLI has to work before signing in can).
func TestCheckEnvironmentVersionAndAuthKinds(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("fake grok is a shell script")
	}
	cases := []struct {
		name   string
		script string
		key    string
		want   string
	}{
		{"too old", "#!/bin/sh\necho 'grok 0.8.9'\n", "", FailureTooOld},
		{"unreadable", "#!/bin/sh\nexit 1\n", "sk-test", FailureVersionUnreadable},
		{"signed out", "#!/bin/sh\necho 'grok 1.0.46'\n", "", FailureSignedOut},
		{"ready", "#!/bin/sh\necho 'grok 1.0.46'\n", "sk-test", FailureNone},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			isolateHome(t)
			t.Setenv("GROK_BIN", writeFakeGrok(t, c.script))
			t.Setenv("XAI_API_KEY", c.key)
			setVersionProbeTimeout(t, generousProbeTimeout)
			info := CheckEnvironment(8)
			if info.FailureKind != c.want {
				t.Fatalf("want %q, got %q (%s)", c.want, info.FailureKind, info.Message)
			}
			if info.OK != (c.want == FailureNone) {
				t.Fatalf("ok=%v for kind %q", info.OK, info.FailureKind)
			}
			if info.GrokPathSource != string(grokbin.SourceEnv) || info.Setup.Update == nil {
				t.Fatalf("source %q update %+v", info.GrokPathSource, info.Setup.Update)
			}
		})
	}
}

func TestCheckEnvironmentTimeoutKind(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("fake grok is a shell script")
	}
	// The fake needs PATH to find sleep; GROK_BIN already bypasses lookup.
	path := os.Getenv("PATH")
	isolateHome(t)
	t.Setenv("PATH", path)
	t.Setenv("GROK_BIN", writeFakeGrok(t, "#!/bin/sh\nexec sleep 60\n"))
	setVersionProbeTimeout(t, 50*time.Millisecond)
	if info := CheckEnvironment(8); info.FailureKind != FailureProbeTimeout {
		t.Fatalf("want probe_timeout, got %q", info.FailureKind)
	}
}
