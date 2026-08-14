// Package main is the thin Wails v3 desktop shell for grok-desktop.
//
// Responsibilities only:
//  1. Resolve bridge.impl (config file + GROK_DESKTOP_BRIDGE env, default go)
//  2. Pick free port + generate random token
//  3. Spawn selected bridge as a **separate child process** (never in-process)
//  4. Embed apps/desktop dist and inject window.__GROK_BRIDGE_URL__
//  5. Session file logs under ~/Library/Logs/grok-desktop (purge >12h on start)
//  6. On exit: kill bridge process group
//
// No business reduce / ACP logic lives here. Protocol: docs/protocol-freeze-relay-2026-08-10.md
// Design: docs/plan-wails3-dual-bridge-2026-08-10.md §4
//
// Wails pin: v3.0.0-beta.6 (see go.mod).
package main

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/wailsapp/wails/v3/pkg/application"
)

func main() {
	if err := run(); err != nil {
		log.Fatalf("[shell] fatal: %v", err)
	}
}

// run wires config → bridge spawn → Wails window → cleanup.
// Missing monorepo markers is packaged mode: empty repoRoot, workspace
// cwd from ResolveBridgeLaunchCwd (Documents/Grok unless BRIDGE_CWD is set).
func run() error {
	// File logs first so even config/bridge failures leave a trail.
	sessionLog, logErr := SetupSessionLogging()
	if logErr != nil {
		// Fall back to stderr-only; still attempt to start the app.
		log.Printf("[shell] session logging unavailable: %v", logErr)
	}
	if sessionLog != nil {
		defer sessionLog.Close()
	}

	impl, _, err := LoadConfig()
	if err != nil {
		return fmt.Errorf("config: %w", err)
	}

	// Missing monorepo markers is packaged mode (empty repoRoot), not fatal.
	repoRoot := ResolveOptionalRepoRoot()

	port, err := PickFreePort()
	if err != nil {
		return err
	}
	token, err := GenerateToken()
	if err != nil {
		return err
	}
	host := "127.0.0.1"
	wsURL := BridgeWSURL(host, port, token)
	cwd := ResolveBridgeLaunchCwd(repoRoot)

	log.Printf("[shell] bridge.impl=%s port=%d repo=%s", impl, port, repoRoot)

	bridgeStdout, bridgeStderr := sessionLog.BridgeWriters()

	bridge, err := StartBridge(BridgeLaunchParams{
		Impl:           impl,
		Port:           port,
		Token:          token,
		Host:           host,
		AllowedOrigins: DefaultAllowedOrigins(),
		Cwd:            cwd,
		RepoRoot:       repoRoot,
		Stdout:         bridgeStdout,
		Stderr:         bridgeStderr,
	})
	if err != nil {
		return err
	}
	defer bridge.Stop()

	// Also handle SIGINT/SIGTERM outside Wails default path.
	sigCh := make(chan os.Signal, 2)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		sig := <-sigCh
		log.Printf("[shell] signal %v — stopping bridge", sig)
		bridge.Stop()
		os.Exit(0)
	}()

	injectJS := bridgeInjectJS(wsURL, sessionLog)

	app := application.New(application.Options{
		Name:        "Grok Desktop",
		Description: "Desktop ACP client for grok-build",
		Assets: application.AssetOptions{
			// UI log POST lands on the same origin as embedded assets.
			Handler: WithUILogHandler(FrontendAssets(), sessionLog),
			// Inject into <head> before Vite modules so defaultBridgeUrl() sees the global.
			// WebviewWindowOptions.JS alone is too late on darwin (post-navigation).
			Middleware: BridgeURLInjectMiddleware(injectJS),
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
		OnShutdown: func() {
			log.Printf("[shell] OnShutdown — stopping bridge")
			bridge.Stop()
		},
		Flags: map[string]any{
			"bridgeUrl":  wsURL,
			"bridgeImpl": string(impl),
			"logDir":     sessionLogDir(sessionLog),
		},
	})

	app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:  "Grok Desktop",
		Width:  1280,
		Height: 840,
		URL:    "/",
		// Belt-and-suspenders: also set after navigation if middleware path is skipped.
		JS: injectJS,
	})

	log.Printf("[shell] window ready — if the UI goes black, check ui-*.log + shell-*.log under %s",
		sessionLogDir(sessionLog))
	if err := app.Run(); err != nil {
		bridge.Stop()
		return err
	}
	return nil
}

// bridgeInjectJS builds the boot script that sets window.__GROK_BRIDGE_URL__ and
// optional log metadata for the desktop UI.
// URL / paths are JSON-encoded so token characters cannot break out of the literal.
func bridgeInjectJS(wsURL string, sessionLog *SessionLogger) string {
	encoded, err := json.Marshal(wsURL)
	if err != nil {
		// Fallback: URL is base64url + digits only in practice.
		encoded = []byte(`"` + wsURL + `"`)
	}
	script := "window.__GROK_BRIDGE_URL__=" + string(encoded) + ";"
	if sessionLog != nil && sessionLog.Dir != "" {
		dirJSON, jErr := json.Marshal(sessionLog.Dir)
		if jErr == nil {
			script += "window.__GROK_LOG_DIR__=" + string(dirJSON) + ";"
		}
		// Asset-server path the UI may POST crash reports to (same origin).
		script += "window.__GROK_UI_LOG_PATH__=" + string(mustJSONString(UILogPath)) + ";"
	}
	return script
}

// mustJSONString JSON-encodes s; on failure returns quoted empty string.
func mustJSONString(s string) []byte {
	b, err := json.Marshal(s)
	if err != nil {
		return []byte(`""`)
	}
	return b
}

// sessionLogDir returns the log directory or a placeholder when logging failed.
func sessionLogDir(sessionLog *SessionLogger) string {
	if sessionLog != nil && sessionLog.Dir != "" {
		return sessionLog.Dir
	}
	return "(no log dir)"
}
