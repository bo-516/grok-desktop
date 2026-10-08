package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// fakeWindow records title and focus calls for one named window.
type fakeWindow struct {
	name    string
	id      uint
	title   string
	shown   int
	focused int
}

// SetTitle stores the latest title.
func (w *fakeWindow) SetTitle(title string) { w.title = title }

// Show counts reveal calls.
func (w *fakeWindow) Show() { w.shown++ }

// Focus counts focus calls.
func (w *fakeWindow) Focus() { w.focused++ }

// fakeRegistry is an in-memory sessionWindowRegistry.
type fakeRegistry struct {
	byName map[string]*fakeWindow
	byID   map[uint]*fakeWindow
	nextID uint
	// created is the url of each New call, in order.
	created []string
	// failNew makes New return an error when true.
	failNew bool
}

// newFakeRegistry builds an empty registry. nextID starts at 1; 0 means none.
func newFakeRegistry() *fakeRegistry {
	return &fakeRegistry{
		byName: map[string]*fakeWindow{},
		byID:   map[uint]*fakeWindow{},
		nextID: 1,
	}
}

// ByName returns the window stored under name.
func (r *fakeRegistry) ByName(name string) (sessionWindow, bool) {
	win, ok := r.byName[name]
	if !ok {
		return nil, false
	}
	return win, true
}

// ByID returns the window stored under id.
func (r *fakeRegistry) ByID(id uint) (sessionWindow, bool) {
	win, ok := r.byID[id]
	if !ok {
		return nil, false
	}
	return win, true
}

// New records a window unless failNew is set.
func (r *fakeRegistry) New(name, title, pageURL string) (sessionWindow, error) {
	if r.failNew {
		return nil, errFakeNew
	}
	win := &fakeWindow{name: name, id: r.nextID, title: title}
	r.nextID++
	r.byName[name] = win
	r.byID[win.id] = win
	r.created = append(r.created, pageURL)
	return win, nil
}

// errFakeNew is the error fakeRegistry returns when failNew is set.
var errFakeNew = errorString("new failed")

// errorString is a tiny error type so tests can match text without fmt.
type errorString string

// Error returns the string.
func (e errorString) Error() string { return string(e) }

func TestSessionWindowURLAndName(t *testing.T) {
	pageURL, err := SessionWindowURL("019ff5e1-f8e1-7970-bee3-4b3a2e04eec2")
	if err != nil {
		t.Fatal(err)
	}
	if pageURL != "/?session=019ff5e1-f8e1-7970-bee3-4b3a2e04eec2" {
		t.Fatalf("url: %s", pageURL)
	}
	if SessionWindowName("fixture-session-0001") != "session:fixture-session-0001" {
		t.Fatal("name")
	}
	if _, err := SessionWindowURL("../etc/passwd"); err == nil {
		t.Fatal("path traversal id should fail")
	}
	if _, err := SessionWindowURL(""); err == nil {
		t.Fatal("empty id should fail")
	}
	if SessionWindowName("has space") != "" {
		t.Fatal("invalid id should not get a name")
	}
}

func TestSanitizeWindowTitle(t *testing.T) {
	if got := SanitizeWindowTitle("  Hello\n\tworld  ", "Grok Desktop"); got != "Hello world" {
		t.Fatalf("collapse: %q", got)
	}
	if got := SanitizeWindowTitle("", "Grok Desktop"); got != "Grok Desktop" {
		t.Fatalf("fallback: %q", got)
	}
	long := strings.Repeat("a", sessionWindowTitleMax+10)
	if got := SanitizeWindowTitle(long, ""); len([]rune(got)) != sessionWindowTitleMax {
		t.Fatalf("clip len %d", len([]rune(got)))
	}
}

func TestOpenOrFocusSessionReusesWindow(t *testing.T) {
	reg := newFakeRegistry()
	created, pageURL, err := openOrFocusSession(reg, "abc-1", "First title")
	if err != nil || !created || pageURL != "/?session=abc-1" {
		t.Fatalf("create: created=%v url=%s err=%v", created, pageURL, err)
	}
	again, _, err := openOrFocusSession(reg, "abc-1", "Renamed")
	if err != nil || again {
		t.Fatalf("second open should focus: created=%v err=%v", again, err)
	}
	if len(reg.created) != 1 {
		t.Fatalf("New calls: %d", len(reg.created))
	}
	win := reg.byName["session:abc-1"]
	if win.title != "Renamed" || win.focused != 1 || win.shown != 1 {
		t.Fatalf("focus state: %+v", win)
	}
}

func TestSessionWindowHTTP(t *testing.T) {
	reg := newFakeRegistry()
	handler := WithSessionWindowHandler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusTeapot)
	}), reg)

	openReq := httptest.NewRequest(http.MethodPost, SessionWindowPath, strings.NewReader(
		`{"op":"open","sessionId":"sess-1","title":"Alpha"}`,
	))
	openRec := httptest.NewRecorder()
	handler.ServeHTTP(openRec, openReq)
	if openRec.Code != http.StatusOK {
		t.Fatalf("open status %d body %s", openRec.Code, openRec.Body.String())
	}
	var opened sessionWindowResponse
	if err := json.Unmarshal(openRec.Body.Bytes(), &opened); err != nil {
		t.Fatal(err)
	}
	if !opened.OK || !opened.Created || opened.URL != "/?session=sess-1" {
		t.Fatalf("open body: %+v", opened)
	}

	// Second open focuses. The JSON Created flag is omitted when false.
	againReq := httptest.NewRequest(http.MethodPost, SessionWindowPath, strings.NewReader(
		`{"op":"open","sessionId":"sess-1","title":"Alpha 2"}`,
	))
	againRec := httptest.NewRecorder()
	handler.ServeHTTP(againRec, againReq)
	var again sessionWindowResponse
	if err := json.Unmarshal(againRec.Body.Bytes(), &again); err != nil {
		t.Fatal(err)
	}
	if !again.OK || again.Created {
		t.Fatalf("second open: %+v", again)
	}

	titleReq := httptest.NewRequest(http.MethodPost, SessionWindowPath, strings.NewReader(
		`{"op":"set_title","title":"Beta"}`,
	))
	titleReq.Header.Set(wailsWindowIDHeader, "1")
	titleRec := httptest.NewRecorder()
	handler.ServeHTTP(titleRec, titleReq)
	if titleRec.Code != http.StatusOK {
		t.Fatalf("title status %d %s", titleRec.Code, titleRec.Body.String())
	}
	if reg.byID[1].title != "Beta" {
		t.Fatalf("title: %q", reg.byID[1].title)
	}

	badReq := httptest.NewRequest(http.MethodPost, SessionWindowPath, strings.NewReader(
		`{"op":"open","sessionId":"../x"}`,
	))
	badRec := httptest.NewRecorder()
	handler.ServeHTTP(badRec, badReq)
	if badRec.Code != http.StatusBadRequest {
		t.Fatalf("bad id status %d", badRec.Code)
	}

	getReq := httptest.NewRequest(http.MethodGet, SessionWindowPath, nil)
	getRec := httptest.NewRecorder()
	handler.ServeHTTP(getRec, getReq)
	if getRec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("get status %d", getRec.Code)
	}

	passReq := httptest.NewRequest(http.MethodGet, "/index.html", nil)
	passRec := httptest.NewRecorder()
	handler.ServeHTTP(passRec, passReq)
	if passRec.Code != http.StatusTeapot {
		t.Fatalf("passthrough %d", passRec.Code)
	}

	nilHandler := WithSessionWindowHandler(nil, nil)
	nilRec := httptest.NewRecorder()
	nilHandler.ServeHTTP(nilRec, httptest.NewRequest(http.MethodPost, SessionWindowPath, strings.NewReader(`{"op":"open","sessionId":"a"}`)))
	if nilRec.Code != http.StatusServiceUnavailable {
		t.Fatalf("nil reg %d", nilRec.Code)
	}
}

func TestSessionWindowHTTPLargeBody(t *testing.T) {
	reg := newFakeRegistry()
	handler := WithSessionWindowHandler(http.NotFoundHandler(), reg)
	payload := `{"op":"open","sessionId":"a","title":"` + strings.Repeat("x", sessionWindowMaxBody) + `"}`
	req := httptest.NewRequest(http.MethodPost, SessionWindowPath, strings.NewReader(payload))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusRequestEntityTooLarge {
		body, _ := io.ReadAll(rec.Body)
		t.Fatalf("status %d %s", rec.Code, body)
	}
}
