package grokbin

import (
	"reflect"
	"strings"
	"testing"
)

func TestInstallCommandMatchesOfficialDocs(t *testing.T) {
	unix := InstallCommand("darwin")
	if unix.Display != "curl -fsSL https://x.ai/cli/install.sh | bash" {
		t.Fatalf("unix display %q", unix.Display)
	}
	// pipefail: a failed download must fail the run, not exit 0.
	want := []string{"bash", "-o", "pipefail", "-c", unix.Display}
	if !reflect.DeepEqual(unix.Argv, want) {
		t.Fatalf("unix argv %q", unix.Argv)
	}
	win := InstallCommand("windows")
	if win.Display != "irm https://x.ai/cli/install.ps1 | iex" {
		t.Fatalf("windows display %q", win.Display)
	}
	if win.Argv[0] != "powershell.exe" || win.Argv[len(win.Argv)-1] != win.Display {
		t.Fatalf("windows argv %q", win.Argv)
	}
	if unix.Action != ActionInstall || win.Action != ActionInstall {
		t.Fatal("install action")
	}
}

func TestPlansForOffersUpdateOnlyWithABinary(t *testing.T) {
	if PlansFor("linux", "").Update != nil {
		t.Fatal("no binary → no update step")
	}
	p := PlansFor("linux", "/x/grok")
	if p.Update == nil || !reflect.DeepEqual(p.Update.Argv, []string{"/x/grok", "update"}) || p.Update.Display != "grok update" {
		t.Fatalf("update step %+v", p.Update)
	}
}

func TestCommandForMapsActionsOnly(t *testing.T) {
	found := func() (Location, error) { return Location{Path: "/x/grok", Source: SourcePath}, nil }
	missing := func() (Location, error) { return Location{}, &LocateError{Kind: KindNotInstalled} }
	if c, err := CommandFor("install", "linux", missing); err != nil || c.Action != ActionInstall {
		t.Fatalf("install: %+v %v", c, err)
	}
	if c, err := CommandFor("update", "linux", found); err != nil || c.Argv[0] != "/x/grok" {
		t.Fatalf("update: %+v %v", c, err)
	}
	_, err := CommandFor("update", "linux", missing)
	if err == nil || !strings.Contains(err.Error(), "run the installer") {
		t.Fatalf("update without grok: %v", err)
	}
	_, err = CommandFor("rm -rf /", "linux", found)
	if err == nil || !strings.Contains(err.Error(), "unknown setup action") {
		t.Fatalf("arbitrary action must be rejected: %v", err)
	}
}
