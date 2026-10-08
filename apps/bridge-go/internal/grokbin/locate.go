// Package grokbin finds the grok CLI the bridge runs, owns the user's custom
// binary-path setting, and describes the official install / update commands
// the onboarding screen may run. It imports nothing else from the bridge, so
// spawn (agent + one-shot CLI) and session (environment probe) can both use it.
package grokbin

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

// Source names where a located grok binary came from. The desktop shows it
// next to the path so the user knows which knob to turn.
type Source string

const (
	// SourceEnv is the GROK_BIN environment variable (dev, tests, power users).
	// It wins over every other source.
	SourceEnv Source = "env"
	// SourceSetting is the custom path saved from Settings (see setting.go).
	SourceSetting Source = "setting"
	// SourceDefault is the official installer's location (~/.grok/bin/grok,
	// %USERPROFILE%\.grok\bin\grok.exe on Windows).
	SourceDefault Source = "default"
	// SourcePath is the first `grok` found on the bridge's PATH.
	SourcePath Source = "path"
)

// Locate failure kinds, echoed verbatim as EnvironmentInfo.failureKind.
const (
	// KindNotInstalled means no source produced a binary: grok is not installed
	// where the bridge can see it.
	KindNotInstalled = "not_installed"
	// KindBinInvalid means an explicit path (GROK_BIN or the saved setting)
	// points at something that is missing or not executable. The explicit path
	// is never silently skipped: the user asked for that binary.
	KindBinInvalid = "bin_invalid"
)

// Location is one resolved grok executable.
type Location struct {
	// Path is the executable to run: absolute for every source except a PATH
	// hit, which is whatever exec.LookPath returned (absolute on all platforms
	// unless PATH itself holds relative entries).
	Path string
	// Source says which rule produced Path.
	Source Source
}

// LocateError explains why no usable grok binary was found.
type LocateError struct {
	// Kind is KindNotInstalled or KindBinInvalid.
	Kind string
	// Source is the explicit source that failed (env / setting); empty for
	// KindNotInstalled.
	Source Source
	// Path is the offending explicit path; empty for KindNotInstalled.
	Path string
	// Reason is the validation failure for KindBinInvalid ("no such file", …).
	Reason string
	// DefaultPath is the official install location that was checked, so the
	// not-installed message can name it.
	DefaultPath string
}

// Error renders a one-line, user-facing explanation (shown in the banner and
// the onboarding screen). Never empty.
func (e *LocateError) Error() string {
	if e.Kind == KindBinInvalid {
		origin := "The custom grok path"
		if e.Source == SourceEnv {
			origin = "GROK_BIN"
		}
		return fmt.Sprintf("%s points to %s, which cannot be used: %s", origin, e.Path, e.Reason)
	}
	return fmt.Sprintf("grok CLI not found (checked %s and PATH). Install it or set a custom path.", e.DefaultPath)
}

// locateInputs is everything locate reads from the outside world, injected so
// the resolution order can be tested without touching the real machine.
type locateInputs struct {
	// envBin is GROK_BIN (may be empty).
	envBin string
	// settingBin is the saved custom path (may be empty).
	settingBin string
	// home is the user's home directory; empty skips the default location.
	home string
	// goos selects the default file name (grok vs grok.exe).
	goos string
	// lookPath resolves a bare command on PATH (exec.LookPath in production).
	lookPath func(file string) (string, error)
	// validate reports why a path is not a runnable executable (nil when it is).
	validate func(path string) error
}

// DefaultInstallPath is where the official installer puts grok.
//
// @param home User home directory; empty returns "" (no default to check).
// @param goos Target OS; "windows" appends .exe.
// @returns ~/.grok/bin/grok (or grok.exe), or "" without a home.
func DefaultInstallPath(home, goos string) string {
	if home == "" {
		return ""
	}
	name := "grok"
	if goos == "windows" {
		name = "grok.exe"
	}
	return filepath.Join(home, ".grok", "bin", name)
}

// locate applies the resolution order: GROK_BIN, saved setting, official
// install location, PATH. An explicit source (env / setting) that is set but
// unusable is an error rather than a fall-through, so a typo never quietly
// runs a different grok than the one the user picked.
//
// @param in Injected environment (see locateInputs).
// @returns The first usable Location, or a *LocateError.
func locate(in locateInputs) (Location, error) {
	explicit := []struct {
		raw    string
		source Source
	}{{in.envBin, SourceEnv}, {in.settingBin, SourceSetting}}
	for _, c := range explicit {
		raw := strings.TrimSpace(c.raw)
		if raw == "" {
			continue
		}
		path := ExpandHome(raw, in.home)
		if err := in.validate(path); err != nil {
			return Location{}, &LocateError{Kind: KindBinInvalid, Source: c.source, Path: path, Reason: err.Error()}
		}
		return Location{Path: path, Source: c.source}, nil
	}
	def := DefaultInstallPath(in.home, in.goos)
	if def != "" && in.validate(def) == nil {
		return Location{Path: def, Source: SourceDefault}, nil
	}
	if p, err := in.lookPath("grok"); err == nil && p != "" {
		return Location{Path: p, Source: SourcePath}, nil
	}
	return Location{}, &LocateError{Kind: KindNotInstalled, DefaultPath: def}
}

// Locate finds the grok binary for this process: GROK_BIN, the saved custom
// path, ~/.grok/bin/grok, then PATH. It reads the settings file on every call
// (a few hundred bytes), so a path saved from Settings applies to the next
// spawn without restarting the bridge.
//
// @returns The resolved Location, or a *LocateError (use errors.As for Kind).
func Locate() (Location, error) {
	home, _ := os.UserHomeDir()
	return locate(locateInputs{
		envBin:     os.Getenv("GROK_BIN"),
		settingBin: LoadCustomBin(),
		home:       home,
		goos:       runtime.GOOS,
		lookPath:   exec.LookPath,
		validate:   ValidateExecutable,
	})
}

// ExpandHome replaces a leading "~" or "~/" (also "~\" on Windows) with home.
//
// @param path User-entered path, already trimmed.
// @param home Home directory; empty leaves path unchanged.
// @returns The expanded path; other paths are returned as-is.
func ExpandHome(path, home string) string {
	if home == "" || !strings.HasPrefix(path, "~") {
		return path
	}
	if path == "~" {
		return home
	}
	rest := path[1:]
	if strings.HasPrefix(rest, "/") || strings.HasPrefix(rest, `\`) {
		return filepath.Join(home, rest[1:])
	}
	// "~user/…" is not supported; leave it for validation to reject.
	return path
}
