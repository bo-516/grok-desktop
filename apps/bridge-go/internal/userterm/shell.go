package userterm

import (
	"path/filepath"
	"strings"
)

// unixShellFallbacks are tried in order when neither $SHELL nor the passwd
// entry names a usable shell. zsh comes first only on darwin (its default
// login shell since 10.15); see resolveUnixShell.
var unixShellFallbacks = []string{"/bin/bash", "/bin/sh"}

// resolveUnixShell picks the interactive shell for a unix user terminal.
//
// Order: $SHELL (absolute and executable) → the user's passwd login shell →
// /bin/zsh on darwin → /bin/bash → /bin/sh. The shell runs as a login shell
// (`-l`) so profile files set PATH the way Terminal.app / iTerm do; GUI apps
// launched from Finder otherwise inherit launchd's minimal PATH.
//
// @param envShell Value of $SHELL ("" when unset).
// @param passwdShell Login shell from the passwd database ("" when unknown).
// @param goos runtime.GOOS of the bridge.
// @param executable Reports whether a path is an executable regular file;
// injected so tests never depend on the host's /bin.
// @returns Shell path and its arguments. Always returns something: /bin/sh is
// the last resort even if executable() rejected it (the spawn then fails with
// a clear error rather than this function guessing further).
func resolveUnixShell(envShell, passwdShell, goos string, executable func(string) bool) (string, []string) {
	login := []string{"-l"}
	candidates := []string{envShell, passwdShell}
	if goos == "darwin" {
		candidates = append(candidates, "/bin/zsh")
	}
	candidates = append(candidates, unixShellFallbacks...)
	for _, c := range candidates {
		if c != "" && strings.HasPrefix(c, "/") && executable(c) {
			return c, login
		}
	}
	return "/bin/sh", login
}

// passwdShellFor extracts the login shell of uid from /etc/passwd content.
//
// @param passwd Full text of /etc/passwd (name:pw:uid:gid:gecos:home:shell).
// @param uid Numeric user id as a decimal string.
// @returns The shell field, or "" when uid has no entry or the line is malformed.
func passwdShellFor(passwd, uid string) string {
	for _, line := range strings.Split(passwd, "\n") {
		fields := strings.Split(strings.TrimSpace(line), ":")
		if len(fields) >= 7 && fields[2] == uid {
			return fields[6]
		}
	}
	return ""
}

// resolveWindowsShell picks the interactive shell for a Windows user terminal.
//
// Order: pwsh.exe on PATH (PowerShell 7) → Windows PowerShell under
// %SystemRoot% → %COMSPEC% → cmd.exe. PowerShell gets -NoLogo so the banner
// does not push the first prompt down.
//
// @param lookPath exec.LookPath-like resolver for a bare program name.
// @param exists Reports whether an absolute path exists.
// @param systemRoot Value of %SystemRoot% ("" when unset).
// @param comspec Value of %COMSPEC% ("" when unset).
// @returns Shell path (or bare name for the last-resort cmd.exe) and args.
func resolveWindowsShell(
	lookPath func(string) (string, error),
	exists func(string) bool,
	systemRoot, comspec string,
) (string, []string) {
	noLogo := []string{"-NoLogo"}
	if p, err := lookPath("pwsh.exe"); err == nil && p != "" {
		return p, noLogo
	}
	if systemRoot != "" {
		ps := filepath.Join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
		if exists(ps) {
			return ps, noLogo
		}
	}
	if comspec != "" {
		return comspec, nil
	}
	return "cmd.exe", nil
}
