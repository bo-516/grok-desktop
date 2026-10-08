package grokbin

import "errors"

// Official installer one-liners, verbatim from https://docs.x.ai/build/overview
// (checked 2026-10-08). Both scripts install to ~/.grok/bin (Windows:
// %USERPROFILE%\.grok\bin), which DefaultInstallPath checks, so a fresh
// install is found without a PATH change or an app restart.
const (
	// unixInstallCommand is the macOS / Linux installer pipeline.
	unixInstallCommand = "curl -fsSL https://x.ai/cli/install.sh | bash"
	// windowsInstallCommand is the PowerShell installer pipeline.
	windowsInstallCommand = "irm https://x.ai/cli/install.ps1 | iex"
)

// Action names one runnable setup step. The desktop sends only the action;
// the bridge maps it to a fixed argv, so no client can make it run anything
// else.
type Action string

const (
	// ActionInstall runs the official installer (also the reinstall path when
	// an old CLI has no working `grok update`).
	ActionInstall Action = "install"
	// ActionUpdate runs `<located grok> update` (`grok update --help`: "Check
	// for updates or install a specific version").
	ActionUpdate Action = "update"
)

// Command is one setup step as the user sees it and as the bridge runs it.
type Command struct {
	// Action identifies the step.
	Action Action `json:"action"`
	// Display is the line a user would paste into a terminal (Copy button).
	Display string `json:"display"`
	// Argv is exactly what "Run" executes; the UI shows it before running.
	Argv []string `json:"argv"`
}

// Plans is the set of setup steps offered for the current machine.
type Plans struct {
	// Install is always present.
	Install Command `json:"install"`
	// Update is nil when no grok binary was located (nothing to update).
	Update *Command `json:"update"`
}

// InstallCommand builds the official installer step for goos.
//
// On unix the pipeline runs under `bash -o pipefail` so a failed download
// (curl exit 22) fails the step instead of piping nothing into bash, which
// would exit 0 and look like success. On Windows PowerShell runs the same
// one-liner the docs give, without a profile and without prompts.
//
// @param goos Target OS ("windows" or anything else for unix).
// @returns The step with its copyable display line and exact argv.
func InstallCommand(goos string) Command {
	if goos == "windows" {
		return Command{
			Action:  ActionInstall,
			Display: windowsInstallCommand,
			Argv:    []string{"powershell.exe", "-NoProfile", "-NonInteractive", "-Command", windowsInstallCommand},
		}
	}
	return Command{
		Action:  ActionInstall,
		Display: unixInstallCommand,
		Argv:    []string{"bash", "-o", "pipefail", "-c", unixInstallCommand},
	}
}

// UpdateCommand builds the `grok update` step for an already located binary.
//
// @param bin Path of the grok to update (Location.Path).
// @returns The step; Display is the terminal spelling, Argv uses bin itself so
// the binary the app actually runs is the one updated.
func UpdateCommand(bin string) Command {
	return Command{Action: ActionUpdate, Display: "grok update", Argv: []string{bin, "update"}}
}

// PlansFor lists the steps offered on goos.
//
// @param goos Target OS for the installer flavor.
// @param bin Located grok path, or "" when none was found (no update step).
// @returns Install always; Update only with a bin.
func PlansFor(goos, bin string) Plans {
	p := Plans{Install: InstallCommand(goos)}
	if bin != "" {
		u := UpdateCommand(bin)
		p.Update = &u
	}
	return p
}

// CommandFor resolves a setup action to the command the bridge will run now.
//
// @param action Action from the client ("install" / "update").
// @param goos Target OS for the installer flavor.
// @param locate Binary lookup for the update step (Locate in production).
// @returns The command, or an error for an unknown action or an update with
// no grok to update (the message points the user at the installer).
func CommandFor(action string, goos string, locate func() (Location, error)) (Command, error) {
	switch Action(action) {
	case ActionInstall:
		return InstallCommand(goos), nil
	case ActionUpdate:
		loc, err := locate()
		if err != nil {
			return Command{}, errors.New("no grok CLI to update (" + err.Error() + "); run the installer instead")
		}
		return UpdateCommand(loc.Path), nil
	default:
		return Command{}, errors.New("unknown setup action: " + action)
	}
}
