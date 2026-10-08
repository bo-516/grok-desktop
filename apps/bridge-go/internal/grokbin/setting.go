package grokbin

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

// appConfigDirName is the per-user folder the shell's config.json also lives
// in (os.UserConfigDir()/grok-desktop on every platform).
const appConfigDirName = "grok-desktop"

// settingsFileName is the bridge-owned file holding the custom grok path. It
// is separate from the shell's config.json so neither process rewrites the
// other's keys.
const settingsFileName = "grok-cli.json"

// fileSettings is the on-disk JSON shape of settingsFileName.
type fileSettings struct {
	// GrokBin is the absolute custom grok path; empty means "auto-detect".
	GrokBin string `json:"grokBin,omitempty"`
}

// settingsMu serializes reads and writes of the settings file inside this
// process (Locate runs on many goroutines; Save is rare).
var settingsMu sync.Mutex

// settingsPath resolves the settings file. A package var only so tests can
// point it at a temp dir; production never reassigns it.
var settingsPath = defaultSettingsPath

// defaultSettingsPath is os.UserConfigDir()/grok-desktop/grok-cli.json:
// ~/Library/Application Support on macOS, %AppData% on Windows, and
// $XDG_CONFIG_HOME or ~/.config on Linux.
//
// @returns The absolute file path, or an error when no config dir is known
// (no HOME / AppData) — the setting is then simply unavailable.
func defaultSettingsPath() (string, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, appConfigDirName, settingsFileName), nil
}

// LoadCustomBin returns the saved custom grok path, or "" when none is saved.
// A missing, unreadable or malformed file reads as "" (auto-detect) rather
// than an error: the setting is optional and must never block a spawn.
//
// @returns The stored absolute path, or "".
func LoadCustomBin() string {
	settingsMu.Lock()
	defer settingsMu.Unlock()
	return loadLocked().GrokBin
}

// loadLocked reads the settings file; the caller holds settingsMu.
//
// @returns The parsed settings, or the zero value on any failure.
func loadLocked() fileSettings {
	path, err := settingsPath()
	if err != nil {
		return fileSettings{}
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return fileSettings{}
	}
	var s fileSettings
	if json.Unmarshal(data, &s) != nil {
		return fileSettings{}
	}
	s.GrokBin = strings.TrimSpace(s.GrokBin)
	return s
}

// SaveCustomBin validates and persists the custom grok path, or clears it.
// Nothing is written when validation fails, so a typo cannot replace a
// working setting. The write is atomic (temp file + rename).
//
// @param raw User input. Trimmed; "" clears the setting; a leading "~" is
// expanded against the home directory; the result must be an absolute path to
// an existing executable file (see ValidateExecutable).
// @returns The stored path ("" after a clear), or an error describing why the
// path was rejected or the file could not be written.
func SaveCustomBin(raw string) (string, error) {
	home, _ := os.UserHomeDir()
	path := ExpandHome(strings.TrimSpace(raw), home)
	if path != "" {
		path = filepath.Clean(path)
		if err := ValidateExecutable(path); err != nil {
			return "", errors.New(path + " " + err.Error())
		}
	}
	settingsMu.Lock()
	defer settingsMu.Unlock()
	file, err := settingsPath()
	if err != nil {
		return "", errors.New("no user config directory to save the setting in: " + err.Error())
	}
	s := loadLocked()
	s.GrokBin = path
	if err := writeSettingsAtomic(file, s); err != nil {
		return "", err
	}
	return path, nil
}

// writeSettingsAtomic writes s as JSON to file via a sibling temp file and a
// rename, creating the parent directory (0700) if needed.
//
// @param file Destination path.
// @param s Settings to store.
// @returns An error when the directory or file cannot be written.
func writeSettingsAtomic(file string, s fileSettings) error {
	if err := os.MkdirAll(filepath.Dir(file), 0o700); err != nil {
		return err
	}
	data, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(file), settingsFileName+".*.tmp")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	_, writeErr := tmp.Write(append(data, '\n'))
	closeErr := tmp.Close()
	if writeErr != nil || closeErr != nil {
		_ = os.Remove(tmpName)
		return errors.Join(writeErr, closeErr)
	}
	if err := os.Rename(tmpName, file); err != nil {
		_ = os.Remove(tmpName)
		return err
	}
	return nil
}
