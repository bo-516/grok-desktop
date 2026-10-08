package main

import (
	"fmt"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// sessionWindowCascadePx is how far each new session window steps from the
// previous one so two chats are not piled on the same origin.
const sessionWindowCascadePx = 28

// sessionWindowCascadeSlots bounds the cascade so a long-lived app does not
// walk the window off the screen.
const sessionWindowCascadeSlots = 8

// sessionWindowWidth matches the primary window width.
const sessionWindowWidth = 1280

// sessionWindowHeight matches the primary window height.
const sessionWindowHeight = 840

// wailsWindow adapts a Wails window to sessionWindow.
type wailsWindow struct {
	// inner is the live Wails window. Nil methods are not called.
	inner application.Window
}

// SetTitle updates the native title. A nil inner is a no-op.
func (w wailsWindow) SetTitle(title string) {
	if w.inner == nil {
		return
	}
	w.inner.SetTitle(title)
}

// Show reveals the window. A nil inner is a no-op.
func (w wailsWindow) Show() {
	if w.inner == nil {
		return
	}
	w.inner.Show()
}

// Focus brings the window forward. A nil inner is a no-op.
func (w wailsWindow) Focus() {
	if w.inner == nil {
		return
	}
	w.inner.Focus()
}

// wailsWindowRegistry creates and looks up windows on one Wails app.
// bind must run after application.New and before the asset server accepts
// traffic (Run). injectJS is the same boot script as the primary window so
// a new webview still sees __GROK_BRIDGE_URL__ if head injection is skipped.
type wailsWindowRegistry struct {
	// app is nil until bind. Open calls before bind fail.
	app *application.App
	// injectJS is copied onto every session window's WebviewWindowOptions.JS.
	injectJS string
	// cascade counts windows created here, for the origin offset.
	cascade int
}

// newWailsWindowRegistry builds a registry that bind attaches to the app.
// injectJS may be empty in tests that never create a real window.
func newWailsWindowRegistry(injectJS string) *wailsWindowRegistry {
	return &wailsWindowRegistry{injectJS: injectJS}
}

// bind attaches the running app. Calling it twice replaces the pointer.
// A nil app makes later New calls fail instead of panicking.
func (r *wailsWindowRegistry) bind(app *application.App) {
	if r == nil {
		return
	}
	r.app = app
}

// ByName finds a window by its Wails name. A missing app reports not found.
func (r *wailsWindowRegistry) ByName(name string) (sessionWindow, bool) {
	if r == nil || r.app == nil || name == "" {
		return nil, false
	}
	win, ok := r.app.Window.GetByName(name)
	if !ok || win == nil {
		return nil, false
	}
	return wailsWindow{inner: win}, true
}

// ByID finds a window by its Wails id. Id 0 never matches.
func (r *wailsWindowRegistry) ByID(id uint) (sessionWindow, bool) {
	if r == nil || r.app == nil || id == 0 {
		return nil, false
	}
	win, ok := r.app.Window.GetByID(id)
	if !ok || win == nil {
		return nil, false
	}
	return wailsWindow{inner: win}, true
}

// New opens a session window on the UI thread via Wails (NewWithOptions
// calls Run, which InvokeSyncs the native create). url is an asset path
// such as "/?session=<id>" so the shared bridge-inject middleware still runs.
// The window is offset from 80,60 by the cascade counter.
func (r *wailsWindowRegistry) New(name, title, pageURL string) (sessionWindow, error) {
	if r == nil || r.app == nil {
		return nil, fmt.Errorf("shell app is not ready")
	}
	shift := sessionWindowCascadePx * (r.cascade % sessionWindowCascadeSlots)
	r.cascade++
	win := r.app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:            name,
		Title:           title,
		Width:           sessionWindowWidth,
		Height:          sessionWindowHeight,
		URL:             pageURL,
		JS:              r.injectJS,
		InitialPosition: application.WindowXY,
		X:               80 + shift,
		Y:               60 + shift,
	})
	return wailsWindow{inner: win}, nil
}
