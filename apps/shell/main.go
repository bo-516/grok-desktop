// Package main is the thin Wails v3 desktop shell for grok-desktop.
//
// Responsibilities only:
//  1. Resolve bridge.impl (config file + GROK_DESKTOP_BRIDGE env, default node)
//  2. Pick free port + generate random token
//  3. Spawn selected bridge as a **separate child process** (never in-process)
//  4. Embed apps/desktop dist and inject window.__GROK_BRIDGE_URL__
//  5. On exit: kill bridge process group
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
func run() error {
	impl, _, err := LoadConfig()
	if err != nil {
		return fmt.Errorf("config: %w", err)
	}

	repoRoot, err := RepoRoot("")
	if err != nil {
		// Fall back to executable-relative walk when cwd is outside the monorepo.
		if exe, e2 := os.Executable(); e2 == nil {
			repoRoot, err = RepoRoot(exe)
		}
		if err != nil {
			return err
		}
	}

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
	cwd := DefaultBridgeCWD(repoRoot)
	if v := os.Getenv("BRIDGE_CWD"); v != "" {
		cwd = v
	}

	log.Printf("[shell] bridge.impl=%s port=%d repo=%s", impl, port, repoRoot)

	bridge, err := StartBridge(BridgeLaunchParams{
		Impl:           impl,
		Port:           port,
		Token:          token,
		Host:           host,
		AllowedOrigins: DefaultAllowedOrigins(),
		Cwd:            cwd,
		RepoRoot:       repoRoot,
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

	injectJS := bridgeInjectJS(wsURL)

	app := application.New(application.Options{
		Name:        "Grok Desktop",
		Description: "Desktop ACP client for grok-build",
		Assets: application.AssetOptions{
			Handler: FrontendAssets(),
			// Inject into <head> before Vite modules so defaultBridgeUrl() sees the global.
			// WebviewWindowOptions.JS alone is too late on darwin (post-navigation).
			Middleware: BridgeURLInjectMiddleware(wsURL),
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

	if err := app.Run(); err != nil {
		bridge.Stop()
		return err
	}
	return nil
}

// bridgeInjectJS builds the script that sets window.__GROK_BRIDGE_URL__ for the desktop UI.
// URL is JSON-encoded so token characters cannot break out of the string literal.
func bridgeInjectJS(wsURL string) string {
	encoded, err := json.Marshal(wsURL)
	if err != nil {
		// Fallback: URL is base64url + digits only in practice.
		encoded = []byte(`"` + wsURL + `"`)
	}
	return "window.__GROK_BRIDGE_URL__=" + string(encoded) + ";"
}
