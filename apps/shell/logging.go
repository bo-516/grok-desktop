package main

import (
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"
)

// LogRetention is how long session log files are kept before purge-on-start.
// Files whose mtime is older than this are deleted when a new session starts.
const LogRetention = 12 * time.Hour

// SessionLogger holds open log files for one shell process lifetime.
// Close flushes and closes shell/bridge/ui writers; safe to call multiple times.
type SessionLogger struct {
	// Dir is the absolute log directory for this platform.
	Dir string
	// ShellPath is the primary shell log (also used by the std log package).
	ShellPath string
	// BridgePath receives bridge child stdout/stderr.
	BridgePath string
	// UIPath receives frontend crash/boot reports posted to /__grok_desktop_log.
	UIPath string

	shellFile  *os.File
	bridgeFile *os.File
	uiFile     *os.File
	// uiMu serializes AppendUI writes (HTTP handler is concurrent).
	uiMu sync.Mutex
	// multi is the std log output (file + stderr) so terminal still sees lines.
	multi io.Writer
	closed bool
}

// LogDir returns the platform log directory for grok-desktop (not the config dir).
// macOS: ~/Library/Logs/grok-desktop
// Linux: $XDG_STATE_HOME/grok-desktop/logs or ~/.local/state/grok-desktop/logs
// Windows: %LOCALAPPDATA%/grok-desktop/logs
// homeDir empty uses os.UserHomeDir; used for tests.
func LogDir(homeDir string) (string, error) {
	if homeDir == "" {
		h, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		homeDir = h
	}
	switch runtime.GOOS {
	case "darwin":
		return filepath.Join(homeDir, "Library", "Logs", "grok-desktop"), nil
	case "windows":
		base := os.Getenv("LOCALAPPDATA")
		if base == "" {
			base = filepath.Join(homeDir, "AppData", "Local")
		}
		return filepath.Join(base, "grok-desktop", "logs"), nil
	default:
		base := os.Getenv("XDG_STATE_HOME")
		if base == "" {
			base = filepath.Join(homeDir, ".local", "state")
		}
		return filepath.Join(base, "grok-desktop", "logs"), nil
	}
}

// PurgeOldLogs deletes regular files under dir whose mod time is older than maxAge.
// Non-existent dir is a no-op. Returns count deleted and the first walk/remove error
// (still continues best-effort after individual remove failures).
// maxAge <= 0 defaults to LogRetention.
func PurgeOldLogs(dir string, maxAge time.Duration) (deleted int, err error) {
	if maxAge <= 0 {
		maxAge = LogRetention
	}
	st, statErr := os.Stat(dir)
	if statErr != nil {
		if os.IsNotExist(statErr) {
			return 0, nil
		}
		return 0, statErr
	}
	if !st.IsDir() {
		return 0, fmt.Errorf("PurgeOldLogs: %s is not a directory", dir)
	}
	cutoff := time.Now().Add(-maxAge)
	entries, readErr := os.ReadDir(dir)
	if readErr != nil {
		return 0, readErr
	}
	var firstErr error
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		info, infoErr := e.Info()
		if infoErr != nil {
			if firstErr == nil {
				firstErr = infoErr
			}
			continue
		}
		if info.ModTime().After(cutoff) {
			continue
		}
		path := filepath.Join(dir, e.Name())
		if rmErr := os.Remove(path); rmErr != nil {
			if firstErr == nil {
				firstErr = rmErr
			}
			continue
		}
		deleted++
	}
	return deleted, firstErr
}

// SetupSessionLogging creates the log dir, purges files older than LogRetention,
// opens shell/bridge/ui files for this process, and redirects the standard logger
// to shell file + stderr.
//
// File names: shell-YYYYMMDD-HHMMSS.log, bridge-…, ui-… (same session stamp).
// On open failure returns a partial SessionLogger and error — caller should still
// try to run but may have stdout-only logs.
func SetupSessionLogging() (*SessionLogger, error) {
	dir, err := LogDir("")
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, fmt.Errorf("create log dir: %w", err)
	}
	if n, pErr := PurgeOldLogs(dir, LogRetention); pErr != nil {
		// Non-fatal: still open new session logs.
		log.Printf("[shell] purge old logs: %v (deleted %d)", pErr, n)
	} else if n > 0 {
		log.Printf("[shell] purged %d log file(s) older than %s", n, LogRetention)
	}

	stamp := time.Now().Format("20060102-150405")
	sl := &SessionLogger{
		Dir:        dir,
		ShellPath:  filepath.Join(dir, "shell-"+stamp+".log"),
		BridgePath: filepath.Join(dir, "bridge-"+stamp+".log"),
		UIPath:     filepath.Join(dir, "ui-"+stamp+".log"),
	}

	shellFile, err := os.OpenFile(sl.ShellPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return sl, fmt.Errorf("open shell log: %w", err)
	}
	sl.shellFile = shellFile

	bridgeFile, err := os.OpenFile(sl.BridgePath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		_ = shellFile.Close()
		return sl, fmt.Errorf("open bridge log: %w", err)
	}
	sl.bridgeFile = bridgeFile

	uiFile, err := os.OpenFile(sl.UIPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		_ = shellFile.Close()
		_ = bridgeFile.Close()
		return sl, fmt.Errorf("open ui log: %w", err)
	}
	sl.uiFile = uiFile

	sl.multi = io.MultiWriter(shellFile, os.Stderr)
	log.SetOutput(sl.multi)
	log.SetFlags(log.LstdFlags | log.Lmicroseconds)
	log.Printf("[shell] logging to %s (bridge=%s ui=%s retention=%s)",
		sl.ShellPath, sl.BridgePath, sl.UIPath, LogRetention)
	return sl, nil
}

// BridgeWriters returns stdout/stderr sinks for the bridge child: file + process stderr.
// Safe when SetupSessionLogging failed partially (nil files → stderr only).
func (s *SessionLogger) BridgeWriters() (stdout, stderr io.Writer) {
	if s == nil || s.bridgeFile == nil {
		return os.Stdout, os.Stderr
	}
	// Tee bridge noise to both the dedicated file and the shared shell multi-writer
	// so one `tail -f shell-*.log` still shows bridge readiness lines.
	out := io.MultiWriter(s.bridgeFile, s.multi)
	return out, out
}

// AppendUI writes one UI crash/boot line (timestamped) to the ui log and shell multi.
// message should be a single logical event; newlines inside are replaced with spaces.
// Empty message is ignored. Concurrent-safe.
func (s *SessionLogger) AppendUI(level, message string) error {
	if s == nil {
		return fmt.Errorf("AppendUI: nil SessionLogger")
	}
	msg := strings.TrimSpace(strings.ReplaceAll(message, "\n", " | "))
	if msg == "" {
		return nil
	}
	if level == "" {
		level = "info"
	}
	line := fmt.Sprintf("%s [ui/%s] %s\n", time.Now().Format("2006-01-02 15:04:05.000"), level, msg)

	s.uiMu.Lock()
	defer s.uiMu.Unlock()
	if s.closed {
		return fmt.Errorf("AppendUI: logger closed")
	}
	if s.uiFile != nil {
		if _, err := s.uiFile.WriteString(line); err != nil {
			return err
		}
	}
	// Also mirror into the primary shell log for a single-file timeline.
	if s.multi != nil {
		_, _ = io.WriteString(s.multi, line)
	}
	return nil
}

// Close closes open files and restores log output to stderr. Idempotent.
func (s *SessionLogger) Close() {
	if s == nil {
		return
	}
	s.uiMu.Lock()
	defer s.uiMu.Unlock()
	if s.closed {
		return
	}
	s.closed = true
	log.SetOutput(os.Stderr)
	if s.shellFile != nil {
		_ = s.shellFile.Close()
		s.shellFile = nil
	}
	if s.bridgeFile != nil {
		_ = s.bridgeFile.Close()
		s.bridgeFile = nil
	}
	if s.uiFile != nil {
		_ = s.uiFile.Close()
		s.uiFile = nil
	}
}
