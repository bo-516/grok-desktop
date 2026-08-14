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

	"github.com/xai-org/grok-desktop/apps/bridge-go/internal/session"
	"github.com/xai-org/grok-desktop/apps/bridge-go/internal/wsapi"
)

func main() {
	// Prefer the executable dir (installed binary next to a checkout), then
	// cwd so `go run ./cmd/bridge` from the repo still resolves as dev.
	start := ""
	if exe, err := os.Executable(); err == nil {
		exeDir := filepath.Dir(exe)
		if session.FindRepoRoot(exeDir) != "" {
			start = exeDir
		}
	}
	if start == "" {
		if wd, err := os.Getwd(); err == nil {
			start = wd
		}
	}
	defaultCwd := session.ResolveDefaultWorkspaceCwd(start)
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
