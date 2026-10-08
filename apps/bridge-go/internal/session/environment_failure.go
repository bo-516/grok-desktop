package session

import (
	"errors"

	"github.com/xai-org/grok-desktop/apps/bridge-go/internal/grokbin"
)

// Failure kinds carried as EnvironmentInfo.FailureKind. The desktop branches
// its onboarding screen and banner action on these, never on Message text.
const (
	// FailureNone means the environment is ready (ok=true).
	FailureNone = ""
	// FailureNotInstalled: no grok binary found anywhere the bridge looks.
	FailureNotInstalled = grokbin.KindNotInstalled
	// FailureBinInvalid: GROK_BIN or the saved custom path is unusable.
	FailureBinInvalid = grokbin.KindBinInvalid
	// FailureProbeTimeout: `grok --version` did not answer within the budget.
	FailureProbeTimeout = "probe_timeout"
	// FailureVersionUnreadable: the CLI ran but printed no parseable version
	// (crash, wrong binary, empty output).
	FailureVersionUnreadable = "version_unreadable"
	// FailureTooOld: the CLI answered with a version below minGrokVersion.
	FailureTooOld = "too_old"
	// FailureSignedOut: the CLI is fine but no credential was found.
	FailureSignedOut = "signed_out"
)

// locateFailureKind maps a grokbin.Locate error to a failure kind.
//
// @param err Error from grokbin.Locate (non-nil).
// @returns FailureBinInvalid or FailureNotInstalled; an unexpected error type
// reads as not installed, the safe default (the screen offers the installer
// and the custom-path field).
func locateFailureKind(err error) string {
	var le *grokbin.LocateError
	if errors.As(err, &le) && le.Kind == grokbin.KindBinInvalid {
		return FailureBinInvalid
	}
	return FailureNotInstalled
}

// versionFailureKind classifies a failed version check.
//
// @param timedOut ReadGrokVersion hit its deadline.
// @param support Verdict from grokVersionSupported (OK must be false).
// @returns FailureProbeTimeout, FailureTooOld (parsed but below the floor), or
// FailureVersionUnreadable (nothing parseable).
func versionFailureKind(timedOut bool, support versionSupport) string {
	if timedOut {
		return FailureProbeTimeout
	}
	if support.Parsed != "" {
		return FailureTooOld
	}
	return FailureVersionUnreadable
}
