package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"
)

// SessionWindowPath is the asset-server POST the UI uses to open a session
// window or retitle the window that sent the request. Same origin as the
// embedded UI, like UILogPath. Wails v3 beta.6 has no frontend method that
// creates a window (Application is only Hide/Show/Quit), so this endpoint
// calls Window.NewWithOptions on the shell side.
const SessionWindowPath = "/__grok_desktop_window"

// MainWindowName is the Wails name of the first window. Session windows use
// SessionWindowName so a second open focuses the existing one instead of
// stacking a duplicate.
const MainWindowName = "main"

// sessionQueryParam is the URL query that names the session a window shows.
// The desktop boot reader uses the same key.
const sessionQueryParam = "session"

// sessionWindowIDMax is the longest accepted session id, in bytes.
// Real ids are UUIDs; the cap rejects a body that tries to use the query
// as a second path.
const sessionWindowIDMax = 200

// sessionWindowTitleMax is the longest native title, in runes.
const sessionWindowTitleMax = 120

// sessionWindowMaxBody is the largest accepted JSON body.
const sessionWindowMaxBody = 8 << 10

// defaultWindowTitle is used when an open request has no usable title.
const defaultWindowTitle = "Grok Desktop"

// wailsWindowIDHeader is injected by the Wails asset server
// (webViewRequestHeaderWindowId) before this handler runs. The page does
// not have to send it. Missing on a set_title call means we cannot tell
// which window asked.
const wailsWindowIDHeader = "x-wails-window-id"

// wailsWindowNameHeader is the companion name header. Used when the id
// header is absent.
const wailsWindowNameHeader = "x-wails-window-name"

// sessionWindow is the slice of a desktop window the opener touches.
type sessionWindow interface {
	// SetTitle replaces the native title bar text. Empty is ignored by callers.
	SetTitle(title string)
	// Show makes a hidden or miniaturized window visible again.
	Show()
	// Focus brings the window forward. A no-op when the window is gone.
	Focus()
}

// sessionWindowRegistry looks up windows and creates session windows.
// The Wails adapter is the product implementation; tests pass a fake.
type sessionWindowRegistry interface {
	// ByName returns the window with that Wails name.
	ByName(name string) (sessionWindow, bool)
	// ByID returns the window with that Wails id. Id 0 never matches.
	ByID(id uint) (sessionWindow, bool)
	// New creates a window loading url (path plus query) under name.
	New(name, title, url string) (sessionWindow, error)
}

// sessionWindowRequest is the JSON body for SessionWindowPath.
type sessionWindowRequest struct {
	// Op is "open" or "set_title".
	Op string `json:"op"`
	// SessionID is required for open. Ignored for set_title.
	SessionID string `json:"sessionId,omitempty"`
	// Title is the native title. Open falls back when it is empty.
	Title string `json:"title,omitempty"`
}

// sessionWindowResponse is the JSON body of a successful call.
type sessionWindowResponse struct {
	// OK is true when the opener accepted the call.
	OK bool `json:"ok"`
	// Created is true when open made a new window. False when an existing
	// session window was focused instead.
	Created bool `json:"created,omitempty"`
	// URL is the asset path the new window loads, including the session query.
	URL string `json:"url,omitempty"`
}

// ValidSessionID reports whether id is safe to put in a window name and query.
// Allows the UUID alphabet plus "._:" so fixture ids like fixture-session-0001
// pass. Rejects empty, over-long, and any character that could change the path.
func ValidSessionID(id string) bool {
	if id == "" || len(id) > sessionWindowIDMax {
		return false
	}
	for _, r := range id {
		switch {
		case r >= 'a' && r <= 'z':
		case r >= 'A' && r <= 'Z':
		case r >= '0' && r <= '9':
		case r == '-' || r == '_' || r == '.' || r == ':':
		default:
			return false
		}
	}
	return true
}

// SessionWindowName is the stable Wails name for one session's window.
// The same id always maps to the same name so a second open can focus it.
// An invalid id returns "" — callers must reject that before New.
func SessionWindowName(sessionID string) string {
	if !ValidSessionID(sessionID) {
		return ""
	}
	return "session:" + sessionID
}

// SessionWindowURL is the asset path a session window loads.
// The path stays "/" so BridgeURLInjectMiddleware still injects the bridge
// URL; the session id is only a query value. Invalid ids return an error
// and an empty path — do not navigate with the empty path.
func SessionWindowURL(sessionID string) (string, error) {
	if !ValidSessionID(sessionID) {
		return "", fmt.Errorf("invalid session id")
	}
	query := url.Values{}
	query.Set(sessionQueryParam, sessionID)
	return "/?" + query.Encode(), nil
}

// SanitizeWindowTitle makes a title safe for a native title bar.
// Control characters and extra whitespace are removed. Longer titles are
// cut on a rune boundary. An empty result uses fallback (also sanitized);
// if both are empty the result is "".
func SanitizeWindowTitle(title, fallback string) string {
	clean := clipWindowTitle(collapseWindowTitle(title))
	if clean != "" {
		return clean
	}
	return clipWindowTitle(collapseWindowTitle(fallback))
}

// collapseWindowTitle drops control runes and folds whitespace to single spaces.
func collapseWindowTitle(title string) string {
	var b strings.Builder
	b.Grow(len(title))
	prevSpace := false
	for _, r := range title {
		// Fold newlines and tabs into a single space before dropping other
		// control characters, so a title copied from a log stays readable.
		if unicode.IsSpace(r) {
			if prevSpace || b.Len() == 0 {
				continue
			}
			b.WriteByte(' ')
			prevSpace = true
			continue
		}
		if r < 0x20 || r == 0x7f || unicode.Is(unicode.Cc, r) {
			continue
		}
		b.WriteRune(r)
		prevSpace = false
	}
	return strings.TrimSpace(b.String())
}

// clipWindowTitle shortens title to sessionWindowTitleMax runes.
func clipWindowTitle(title string) string {
	if title == "" || utf8.RuneCountInString(title) <= sessionWindowTitleMax {
		return title
	}
	runes := []rune(title)
	return string(runes[:sessionWindowTitleMax])
}

// openOrFocusSession opens a window for sessionID, or focuses one that
// already uses that session's name. title is sanitized. created is false
// when an existing window was focused. The returned URL is what a new
// window loads. An invalid id returns an error and does not touch reg.
func openOrFocusSession(reg sessionWindowRegistry, sessionID, title string) (bool, string, error) {
	pageURL, err := SessionWindowURL(sessionID)
	if err != nil {
		return false, "", err
	}
	if reg == nil {
		return false, "", fmt.Errorf("window registry is not ready")
	}
	name := SessionWindowName(sessionID)
	safeTitle := SanitizeWindowTitle(title, defaultWindowTitle)
	if existing, ok := reg.ByName(name); ok && existing != nil {
		existing.SetTitle(safeTitle)
		existing.Show()
		existing.Focus()
		return false, pageURL, nil
	}
	if _, err := reg.New(name, safeTitle, pageURL); err != nil {
		return false, pageURL, err
	}
	return true, pageURL, nil
}

// retitleWindow sets the title of the window identified by windowID, or by
// windowName when the id is 0. A blank title and an unknown window are errors.
func retitleWindow(reg sessionWindowRegistry, windowID uint, windowName, title string) error {
	if reg == nil {
		return fmt.Errorf("window registry is not ready")
	}
	safeTitle := SanitizeWindowTitle(title, "")
	if safeTitle == "" {
		return fmt.Errorf("title required")
	}
	var win sessionWindow
	var ok bool
	if windowID != 0 {
		win, ok = reg.ByID(windowID)
	} else if windowName != "" {
		win, ok = reg.ByName(windowName)
	}
	if !ok || win == nil {
		return fmt.Errorf("window not found")
	}
	win.SetTitle(safeTitle)
	return nil
}

// WithSessionWindowHandler serves POST SessionWindowPath and forwards every
// other request to next. reg may be nil only before the shell app exists;
// calls then return 503. GET on the path returns 405.
func WithSessionWindowHandler(next http.Handler, reg sessionWindowRegistry) http.Handler {
	if next == nil {
		next = http.NotFoundHandler()
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != SessionWindowPath {
			next.ServeHTTP(w, r)
			return
		}
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			http.Error(w, "POST only", http.StatusMethodNotAllowed)
			return
		}
		if reg == nil {
			http.Error(w, "windows not ready", http.StatusServiceUnavailable)
			return
		}
		body, err := io.ReadAll(io.LimitReader(r.Body, sessionWindowMaxBody+1))
		if err != nil {
			http.Error(w, "read body", http.StatusBadRequest)
			return
		}
		if len(body) > sessionWindowMaxBody {
			http.Error(w, "body too large", http.StatusRequestEntityTooLarge)
			return
		}
		var req sessionWindowRequest
		if err := json.Unmarshal(body, &req); err != nil {
			http.Error(w, "invalid JSON", http.StatusBadRequest)
			return
		}
		req.Op = strings.TrimSpace(req.Op)
		switch req.Op {
		case "open":
			created, pageURL, openErr := openOrFocusSession(reg, strings.TrimSpace(req.SessionID), req.Title)
			if openErr != nil {
				status := http.StatusBadRequest
				if openErr.Error() != "invalid session id" {
					status = http.StatusInternalServerError
				}
				http.Error(w, openErr.Error(), status)
				return
			}
			writeSessionWindowJSON(w, sessionWindowResponse{OK: true, Created: created, URL: pageURL})
		case "set_title":
			windowID := windowIDFromHeader(r.Header.Get(wailsWindowIDHeader))
			windowName := strings.TrimSpace(r.Header.Get(wailsWindowNameHeader))
			if err := retitleWindow(reg, windowID, windowName, req.Title); err != nil {
				status := http.StatusBadRequest
				if err.Error() == "window not found" {
					status = http.StatusNotFound
				}
				http.Error(w, err.Error(), status)
				return
			}
			writeSessionWindowJSON(w, sessionWindowResponse{OK: true})
		default:
			http.Error(w, "unknown op", http.StatusBadRequest)
		}
	})
}

// windowIDFromHeader parses the Wails window id header. Blank or non-numeric
// values return 0, which retitleWindow treats as "use the name instead".
func windowIDFromHeader(raw string) uint {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 0
	}
	n, err := strconv.ParseUint(raw, 10, 64)
	if err != nil || n == 0 {
		return 0
	}
	return uint(n)
}

// writeSessionWindowJSON writes a 200 JSON body. Encode errors still sent
// the status; the client treats a non-JSON 200 as failure.
func writeSessionWindowJSON(w http.ResponseWriter, body sessionWindowResponse) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(body)
}
