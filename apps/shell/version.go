package main

// devAppVersion is the placeholder when the linker did not stamp a release.
// Local `go build` without -X leaves this value; scripts/build-release.sh
// and apps/shell/build/build.sh replace it from the repo root package.json.
const devAppVersion = "0.0.0-dev"

// appVersion is the product semver stamped at link time:
//
//	-X main.appVersion=<semver>
//
// The single source of truth is the repo root package.json "version" field
// (override with the VERSION env var). The desktop UI reads the same number
// through the Vite define. An empty stamp falls back to devAppVersion so
// logs stay readable. A wrong value only mislabels the shell log; it does
// not change bridge or ACP behavior.
var appVersion = devAppVersion

// AppVersion returns the stamped product semver.
// An empty linker value (someone set -X main.appVersion= with nothing after
// the equals sign) returns devAppVersion instead of a blank string.
func AppVersion() string {
	if appVersion == "" {
		return devAppVersion
	}
	return appVersion
}
