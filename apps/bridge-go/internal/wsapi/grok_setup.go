package wsapi

import (
	"context"
	"os"
	"runtime"
	"strings"
	"sync"

	"github.com/gorilla/websocket"
	"github.com/xai-org/grok-desktop/apps/bridge-go/internal/grokbin"
	"github.com/xai-org/grok-desktop/apps/bridge-go/internal/spawn"
)

// resolveSetupCommand maps a client action to the command to run. A package
// var only so tests can substitute a harmless fake for the real installer;
// production never reassigns it.
var resolveSetupCommand = func(action string) (grokbin.Command, error) {
	return grokbin.CommandFor(action, runtime.GOOS, grokbin.Locate)
}

// setupRunTimeout is the cap handed to spawn.RunSetupCommand; a var so tests
// can exercise the timeout path quickly.
var setupRunTimeout = spawn.SetupRunTimeout

// setupRunRegistry allows one install / update run at a time per bridge (two
// installers racing on ~/.grok/bin would corrupt each other) and remembers its
// cancel func for grok_setup_cancel.
type setupRunRegistry struct {
	// mu guards runID and cancel.
	mu sync.Mutex
	// runID is the active run's client id; "" when idle.
	runID string
	// cancel stops the active run; nil when idle.
	cancel context.CancelFunc
}

// grokSetupRuns is the bridge-wide registry (one bridge per desktop).
var grokSetupRuns = &setupRunRegistry{}

// begin claims the single run slot.
//
// @param runID Client-chosen id for the new run.
// @param cancel Stops the run's context.
// @returns The id of the run already in progress, or "" when the slot was
// free and is now held by runID.
func (r *setupRunRegistry) begin(runID string, cancel context.CancelFunc) string {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.runID != "" {
		return r.runID
	}
	r.runID = runID
	r.cancel = cancel
	return ""
}

// end releases the slot if runID still holds it (idempotent).
//
// @param runID The finishing run.
func (r *setupRunRegistry) end(runID string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.runID == runID {
		r.runID = ""
		r.cancel = nil
	}
}

// stop cancels runID when it is the active run.
//
// @param runID Run to cancel; a stale or unknown id is ignored.
// @returns True when a cancel was issued.
func (r *setupRunRegistry) stop(runID string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	if runID == "" || r.runID != runID || r.cancel == nil {
		return false
	}
	r.cancel()
	return true
}

// handleGrokSetupRun answers `grok_setup_run` {runId, action}: it runs the
// official installer ("install") or `grok update` ("update") and streams the
// result to the requesting socket only:
//
//	grok_setup_started {runId, command}   exact argv about to run
//	grok_setup_output  {runId, text}      combined stdout/stderr chunks
//	grok_setup_exit    {runId, ok, code, timedOut, canceled, error}
//
// The client never supplies a command line — only an action the bridge maps to
// a fixed argv — and the desktop sends it only from an explicit user click.
// A missing runId, an unknown action, or a run already in progress yields a
// grok_setup_exit with ok=false and nothing is started. Blocks until the run
// ends (dispatch already runs each frame on its own goroutine).
//
// @param ws Requesting socket (output is unicast; other windows re-probe on
// their own).
// @param msg Raw client frame.
// @returns Always nil; failures ride inside grok_setup_exit.
func (h *Handlers) handleGrokSetupRun(ws *websocket.Conn, msg map[string]any) error {
	runID, _ := msg["runId"].(string)
	action, _ := msg["action"].(string)
	exit := func(fields map[string]any) {
		frame := map[string]any{"type": "grok_setup_exit", "runId": runID, "ok": false}
		for k, v := range fields {
			frame[k] = v
		}
		h.Send(ws, frame)
	}
	if strings.TrimSpace(runID) == "" {
		exit(map[string]any{"error": "grok_setup_run needs a runId"})
		return nil
	}
	command, err := resolveSetupCommand(action)
	if err != nil {
		exit(map[string]any{"error": err.Error()})
		return nil
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if busy := grokSetupRuns.begin(runID, cancel); busy != "" {
		exit(map[string]any{"error": "another install or update is already running"})
		return nil
	}
	defer grokSetupRuns.end(runID)
	h.Send(ws, map[string]any{"type": "grok_setup_started", "runId": runID, "command": command})
	result, err := spawn.RunSetupCommand(ctx, command.Argv, os.Environ(), setupRunTimeout, func(chunk string) {
		h.Send(ws, map[string]any{"type": "grok_setup_output", "runId": runID, "text": chunk})
	})
	if err != nil {
		exit(map[string]any{"error": "could not start " + command.Argv[0] + ": " + err.Error()})
		return nil
	}
	ok := result.Code != nil && *result.Code == 0
	exit(map[string]any{
		"ok": ok, "code": result.Code, "timedOut": result.TimedOut, "canceled": result.Canceled,
	})
	return nil
}

// handleGrokSetupCancel answers `grok_setup_cancel` {runId} by stopping that
// run; its grok_setup_exit (canceled=true) follows from handleGrokSetupRun.
// Unknown or finished ids are ignored silently.
//
// @param msg Raw client frame.
// @returns Always nil.
func (h *Handlers) handleGrokSetupCancel(msg map[string]any) error {
	runID, _ := msg["runId"].(string)
	grokSetupRuns.stop(runID)
	return nil
}
