package grokbin

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// windowsExecExts are the extensions Windows will run directly; it has no
// execute bit, so the extension is the only cheap "is this runnable" signal.
var windowsExecExts = map[string]bool{".exe": true, ".com": true, ".bat": true, ".cmd": true}

// ValidateExecutable reports why path cannot be run as the grok CLI, or nil.
// It only inspects the file system (no exec): the environment probe runs
// `grok --version` afterwards and reports a broken binary on its own terms.
//
// @param path Absolute path (callers expand "~" first). Symlinks are followed,
// so the installer's ~/.grok/bin/grok → ../downloads/… link validates.
// @returns nil for a runnable regular file; otherwise an error whose text is
// shown to the user ("no such file", "is a directory", "is not executable",
// "must be an absolute path").
func ValidateExecutable(path string) error {
	return validateExecutableFor(path, runtime.GOOS)
}

// validateExecutableFor is ValidateExecutable with the OS rules injected so
// both platforms' checks are testable on either host.
//
// @param path Candidate path.
// @param goos "windows" checks the extension; anything else checks mode bits.
// @returns nil when runnable, else a user-facing reason.
func validateExecutableFor(path, goos string) error {
	if strings.TrimSpace(path) == "" {
		return errors.New("path is empty")
	}
	if !filepath.IsAbs(path) {
		return errors.New("must be an absolute path")
	}
	st, err := os.Stat(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return errors.New("no such file")
		}
		return errors.New("cannot be read: " + err.Error())
	}
	if st.IsDir() {
		return errors.New("is a directory, not the grok executable")
	}
	if !st.Mode().IsRegular() {
		return errors.New("is not a regular file")
	}
	if goos == "windows" {
		if !windowsExecExts[strings.ToLower(filepath.Ext(path))] {
			return errors.New("is not an executable (.exe, .cmd, .bat or .com)")
		}
		return nil
	}
	if st.Mode().Perm()&0o111 == 0 {
		return errors.New("is not executable (chmod +x it)")
	}
	return nil
}
