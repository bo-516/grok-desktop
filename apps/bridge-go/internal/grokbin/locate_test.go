package grokbin

import (
	"errors"
	"path/filepath"
	"strings"
	"testing"
)

// fakeInputs builds locateInputs where only the listed paths are "runnable"
// and PATH resolves to pathHit ("" = not on PATH).
//
// @param runnable Paths validate accepts.
// @param pathHit What lookPath("grok") returns; "" fails the lookup.
// @returns Inputs with home=/home/u and goos=linux; callers set env/setting.
func fakeInputs(runnable []string, pathHit string) locateInputs {
	ok := map[string]bool{}
	for _, p := range runnable {
		ok[p] = true
	}
	return locateInputs{
		home: "/home/u",
		goos: "linux",
		lookPath: func(string) (string, error) {
			if pathHit == "" {
				return "", errors.New("not found")
			}
			return pathHit, nil
		},
		validate: func(p string) error {
			if ok[p] {
				return nil
			}
			return errors.New("no such file")
		},
	}
}

func TestLocateOrderEnvSettingDefaultPath(t *testing.T) {
	def := filepath.Join("/home/u", ".grok", "bin", "grok")
	in := fakeInputs([]string{"/env/grok", "/set/grok", def}, "/usr/bin/grok")
	in.envBin = "/env/grok"
	in.settingBin = "/set/grok"
	if loc, err := locate(in); err != nil || loc.Source != SourceEnv || loc.Path != "/env/grok" {
		t.Fatalf("env must win: %+v %v", loc, err)
	}
	in.envBin = ""
	if loc, err := locate(in); err != nil || loc.Source != SourceSetting {
		t.Fatalf("setting must win over default: %+v %v", loc, err)
	}
	in.settingBin = ""
	if loc, err := locate(in); err != nil || loc.Source != SourceDefault || loc.Path != def {
		t.Fatalf("default location next: %+v %v", loc, err)
	}
	in.validate = func(string) error { return errors.New("no such file") }
	if loc, err := locate(in); err != nil || loc.Source != SourcePath || loc.Path != "/usr/bin/grok" {
		t.Fatalf("PATH last: %+v %v", loc, err)
	}
}

func TestLocateNotInstalledNamesDefaultPath(t *testing.T) {
	_, err := locate(fakeInputs(nil, ""))
	var le *LocateError
	if !errors.As(err, &le) || le.Kind != KindNotInstalled {
		t.Fatalf("want not_installed, got %v", err)
	}
	if !strings.Contains(err.Error(), filepath.Join(".grok", "bin", "grok")) {
		t.Fatalf("message must name the default path: %q", err)
	}
}

// An explicit path that is broken must not fall through to another grok.
func TestLocateExplicitInvalidIsAnError(t *testing.T) {
	def := filepath.Join("/home/u", ".grok", "bin", "grok")
	in := fakeInputs([]string{def}, "/usr/bin/grok")
	in.settingBin = "/missing/grok"
	_, err := locate(in)
	var le *LocateError
	if !errors.As(err, &le) || le.Kind != KindBinInvalid || le.Source != SourceSetting || le.Path != "/missing/grok" {
		t.Fatalf("want bin_invalid from setting, got %#v", err)
	}
	if !strings.HasPrefix(err.Error(), "The custom grok path points to /missing/grok") {
		t.Fatalf("setting message: %q", err)
	}
	in.envBin = "/also/missing"
	_, err = locate(in)
	if !errors.As(err, &le) || le.Source != SourceEnv || !strings.HasPrefix(err.Error(), "GROK_BIN points to") {
		t.Fatalf("env message: %v", err)
	}
}

func TestLocateExpandsHomeInExplicitPath(t *testing.T) {
	want := filepath.Join("/home/u", "tools", "grok")
	in := fakeInputs([]string{want}, "")
	in.settingBin = "~/tools/grok"
	loc, err := locate(in)
	if err != nil || loc.Path != want {
		t.Fatalf("got %+v %v", loc, err)
	}
}

func TestDefaultInstallPathPerOS(t *testing.T) {
	if got := DefaultInstallPath("/h", "windows"); got != filepath.Join("/h", ".grok", "bin", "grok.exe") {
		t.Fatalf("windows: %q", got)
	}
	if got := DefaultInstallPath("/h", "darwin"); got != filepath.Join("/h", ".grok", "bin", "grok") {
		t.Fatalf("darwin: %q", got)
	}
	if DefaultInstallPath("", "linux") != "" {
		t.Fatal("no home → no default")
	}
}

func TestExpandHome(t *testing.T) {
	cases := map[string]string{
		"~":         "/h",
		"~/a/b":     filepath.Join("/h", "a", "b"),
		"/abs/grok": "/abs/grok",
		"~other/x":  "~other/x",
		"rel/grok":  "rel/grok",
	}
	for in, want := range cases {
		if got := ExpandHome(in, "/h"); got != want {
			t.Errorf("ExpandHome(%q) = %q, want %q", in, got, want)
		}
	}
	if ExpandHome("~/x", "") != "~/x" {
		t.Error("empty home must leave the path alone")
	}
}
