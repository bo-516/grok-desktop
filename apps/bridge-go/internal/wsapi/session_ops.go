package wsapi

import (
	"fmt"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/gorilla/websocket"
	"github.com/xai-org/grok-desktop/apps/bridge-go/internal/session"
)

// methodNotFoundRE matches ACP -32601 / "method not found" style agent errors.
// Used by set_model / set_mode to emit restart_required (SPAWN fallback, J-06).
var methodNotFoundRE = regexp.MustCompile(`(?i)method not|not found|-32601`)

// handleSetModel runs session/set_model with restart_required fallback when the
// agent lacks the method (mirrors Node wsSessionOps.handleSetModel).
//
// @param ws Reply socket for info / restart_required frames.
// @param msg Client frame with optional sessionId and required modelId.
// @returns nil on success; error when runtime missing or RPC fails after any hint.
func (h *Handlers) handleSetModel(ws *websocket.Conn, msg map[string]any) error {
	sessionID, _ := msg["sessionId"].(string)
	modelID, _ := msg["modelId"].(string)
	rt, err := session.RequireSessionRuntime(h.Pool, h.State.FocusedSessionID, sessionID)
	if err != nil {
		return err
	}
	h.Pool.Touch(rt.SessionID)
	if rt.SetModel == nil {
		return fmt.Errorf("set_model not available on runtime")
	}
	if err := rt.SetModel(modelID); err != nil {
		errMsg := err.Error()
		if methodNotFoundRE.MatchString(errMsg) {
			h.Send(ws, map[string]any{
				"type":      "restart_required",
				"sessionId": rt.SessionID,
				"reason":    "session/set_model is not supported by this agent; restart with --model to apply",
				"setting":   "model",
			})
		}
		return err
	}
	h.Send(ws, map[string]any{
		"type":      "info",
		"message":   fmt.Sprintf("model set to %s", modelID),
		"sessionId": rt.SessionID,
	})
	return nil
}

// handleSetMode runs session/set_mode with restart_required fallback when the
// agent lacks the method (mirrors Node wsSessionOps.handleSetMode).
//
// @param ws Reply socket for info / restart_required frames.
// @param msg Client frame with optional sessionId and required modeId.
// @returns nil on success; error when runtime missing or RPC fails after any hint.
func (h *Handlers) handleSetMode(ws *websocket.Conn, msg map[string]any) error {
	sessionID, _ := msg["sessionId"].(string)
	modeID, _ := msg["modeId"].(string)
	rt, err := session.RequireSessionRuntime(h.Pool, h.State.FocusedSessionID, sessionID)
	if err != nil {
		return err
	}
	h.Pool.Touch(rt.SessionID)
	if rt.SetMode == nil {
		return fmt.Errorf("set_mode not available on runtime")
	}
	if err := rt.SetMode(modeID); err != nil {
		errMsg := err.Error()
		if methodNotFoundRE.MatchString(errMsg) {
			h.Send(ws, map[string]any{
				"type":      "restart_required",
				"sessionId": rt.SessionID,
				"reason":    "session/set_mode is not supported; restart with --permission-mode to apply",
				"setting":   "mode",
			})
		}
		return err
	}
	h.Send(ws, map[string]any{
		"type":      "info",
		"message":   fmt.Sprintf("mode set to %s", modeID),
		"sessionId": rt.SessionID,
	})
	return nil
}

// handleCompact runs session/compact on the target runtime.
//
// @param msg Client frame with optional sessionId and instruction.
// @returns nil on success; error when compact is unavailable or RPC fails.
func (h *Handlers) handleCompact(msg map[string]any) error {
	sessionID, _ := msg["sessionId"].(string)
	instruction, _ := msg["instruction"].(string)
	rt, err := session.RequireSessionRuntime(h.Pool, h.State.FocusedSessionID, sessionID)
	if err != nil {
		return err
	}
	h.Pool.Touch(rt.SessionID)
	if rt.Compact == nil {
		return fmt.Errorf("compact not available")
	}
	return rt.Compact(instruction)
}

// handleTokenUsage runs session/token_usage and replies on cli_result
// (same envelope as Node so the desktop pendingCli promise settles).
//
// @param ws Reply socket (unicast cli_result).
// @param msg Client frame with requestId and optional sessionId.
// @returns Always nil; failures ride inside the cli_result envelope.
func (h *Handlers) handleTokenUsage(ws *websocket.Conn, msg map[string]any) error {
	sessionID, _ := msg["sessionId"].(string)
	requestID, _ := msg["requestId"].(string)
	rt, err := session.RequireSessionRuntime(h.Pool, h.State.FocusedSessionID, sessionID)
	if err != nil {
		h.Send(ws, map[string]any{
			"type": "cli_result",
			"result": map[string]any{
				"requestId": requestID, "ok": false, "error": err.Error(),
			},
		})
		return nil
	}
	h.Pool.Touch(rt.SessionID)
	if rt.TokenUsage == nil {
		h.Send(ws, map[string]any{
			"type": "cli_result",
			"result": map[string]any{
				"requestId": requestID, "ok": false, "error": "token_usage not available",
			},
		})
		return nil
	}
	data, err := rt.TokenUsage()
	if err != nil {
		h.Send(ws, map[string]any{
			"type": "cli_result",
			"result": map[string]any{
				"requestId": requestID, "ok": false, "error": err.Error(),
			},
		})
		return nil
	}
	h.Send(ws, map[string]any{
		"type": "cli_result",
		"result": map[string]any{
			"requestId": requestID, "ok": true, "data": data,
		},
	})
	return nil
}

// handleBilling runs _x.ai/billing and replies on cli_result
// (same envelope as Node so the desktop pendingCli promise settles).
//
// @param ws Reply socket (unicast cli_result).
// @param msg Client frame with requestId and optional sessionId.
// @returns Always nil; failures ride inside the cli_result envelope.
func (h *Handlers) handleBilling(ws *websocket.Conn, msg map[string]any) error {
	sessionID, _ := msg["sessionId"].(string)
	requestID, _ := msg["requestId"].(string)
	rt, err := session.RequireSessionRuntime(h.Pool, h.State.FocusedSessionID, sessionID)
	if err != nil {
		h.Send(ws, map[string]any{
			"type": "cli_result",
			"result": map[string]any{
				"requestId": requestID, "ok": false, "error": err.Error(),
			},
		})
		return nil
	}
	h.Pool.Touch(rt.SessionID)
	if rt.Billing == nil {
		h.Send(ws, map[string]any{
			"type": "cli_result",
			"result": map[string]any{
				"requestId": requestID, "ok": false, "error": "billing not available",
			},
		})
		return nil
	}
	data, err := rt.Billing()
	if err != nil {
		h.Send(ws, map[string]any{
			"type": "cli_result",
			"result": map[string]any{
				"requestId": requestID, "ok": false, "error": err.Error(),
			},
		})
		return nil
	}
	h.Send(ws, map[string]any{
		"type": "cli_result",
		"result": map[string]any{
			"requestId": requestID, "ok": true, "data": data,
		},
	})
	return nil
}

// handleForkSession runs _x.ai/session/fork and replies on cli_result with the
// agent bag (newSessionId, …). Source/new cwd default to the runtime cwd.
//
// @param ws Reply socket (unicast cli_result).
// @param msg Client frame with requestId and optional sessionId / sourceCwd / newCwd.
// @returns Always nil; failures ride inside the cli_result envelope.
func (h *Handlers) handleForkSession(ws *websocket.Conn, msg map[string]any) error {
	sessionID, _ := msg["sessionId"].(string)
	requestID, _ := msg["requestId"].(string)
	sourceCwd, _ := msg["sourceCwd"].(string)
	newCwd, _ := msg["newCwd"].(string)
	rt, err := session.RequireSessionRuntime(h.Pool, h.State.FocusedSessionID, sessionID)
	if err != nil {
		h.Send(ws, map[string]any{
			"type": "cli_result",
			"result": map[string]any{
				"requestId": requestID, "ok": false, "error": err.Error(),
			},
		})
		return nil
	}
	h.Pool.Touch(rt.SessionID)
	if rt.ForkSession == nil {
		h.Send(ws, map[string]any{
			"type": "cli_result",
			"result": map[string]any{
				"requestId": requestID, "ok": false, "error": "fork_session not available",
			},
		})
		return nil
	}
	src := strings.TrimSpace(sourceCwd)
	if src == "" {
		src = rt.Cwd
	} else if abs, err := filepath.Abs(src); err == nil {
		src = abs
	}
	dst := strings.TrimSpace(newCwd)
	if dst == "" {
		dst = src
	} else if abs, err := filepath.Abs(dst); err == nil {
		dst = abs
	}
	data, err := rt.ForkSession(src, dst)
	if err != nil {
		h.Send(ws, map[string]any{
			"type": "cli_result",
			"result": map[string]any{
				"requestId": requestID, "ok": false, "error": err.Error(),
			},
		})
		return nil
	}
	h.Send(ws, map[string]any{
		"type": "cli_result",
		"result": map[string]any{
			"requestId": requestID, "ok": true, "data": data,
		},
	})
	return nil
}
