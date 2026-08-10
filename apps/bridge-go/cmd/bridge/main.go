// Command bridge is the Go desktop bridge: RuntimePool of real `grok agent stdio`
// + WebSocket API matching the frozen relay protocol (docs/protocol-freeze-relay-2026-08-10.md).
//
// Product path always spawns real grok — no mock agent.
package main

import (
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"

	"github.com/xai-org/grok-desktop/apps/bridge-go/internal/wsapi"
)

func main() {
	defaultCwd := defaultWorkspaceCwd()
	cfg := wsapi.ConfigFromEnv(defaultCwd)
	srv := wsapi.NewServer(cfg)

	// Graceful shutdown: dispose agent trees then exit.
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-sigCh
		_ = srv.Close()
		os.Exit(0)
	}()

	if err := srv.ListenAndServe(); err != nil {
		// http.ErrServerClosed is expected on Close.
		if err.Error() != "http: Server closed" {
			fmt.Fprintf(os.Stderr, "[bridge] fatal: %v\n", err)
			os.Exit(1)
		}
	}
}

// defaultWorkspaceCwd mirrors Node: repo demo/ when running from source tree,
// otherwise the process working directory.
func defaultWorkspaceCwd() string {
	// apps/bridge-go/cmd/bridge → repo root is ../../../..
	exe, err := os.Executable()
	_ = exe
	wd, err := os.Getwd()
	if err != nil {
		return "."
	}
	// Prefer BRIDGE_CWD via ConfigFromEnv; this is only the fallback default.
	// Walk up looking for demo/ next to apps/.
	dir := wd
	for i := 0; i < 6; i++ {
		demo := filepath.Join(dir, "demo")
		apps := filepath.Join(dir, "apps")
		if st, err := os.Stat(demo); err == nil && st.IsDir() {
			if _, err := os.Stat(apps); err == nil {
				return demo
			}
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	return wd
}
