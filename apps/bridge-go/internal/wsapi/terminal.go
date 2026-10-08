package wsapi

import (
	"encoding/base64"
	"fmt"
	"math"

	"github.com/gorilla/websocket"
	"github.com/xai-org/grok-desktop/apps/bridge-go/internal/userterm"
)

// maxTerminalInputBytes caps one terminal_input payload (a very large paste).
// Bigger frames are rejected with terminal_error instead of being written.
const maxTerminalInputBytes = 4 << 20

// newTerminalManager builds the user-terminal registry for h and routes its
// output to the owning socket through h.Send (which holds the per-connection
// write lock).
//
// @param h Handlers whose Send is used; read lazily so tests may replace it.
// @returns A manager whose owner keys are *websocket.Conn values.
func newTerminalManager(h *Handlers) *userterm.Manager {
	return userterm.NewManager(func(owner any, msg map[string]any) {
		ws, ok := owner.(*websocket.Conn)
		if !ok {
			return
		}
		h.Send(ws, msg)
	})
}

// handleTerminal dispatches the terminal_* protocol (integrated terminal panel).
//
// Protocol (UI → bridge): terminal_create {requestId, sessionId?, cwd?, subdir?,
// cols, rows}; terminal_input {terminalId, seq, data | dataBase64};
// terminal_resize {terminalId, seq, cols, rows}; terminal_ack {terminalId,
// bytes}; terminal_kill {terminalId}; terminal_list {requestId}.
// Replies (bridge → UI, owner only): terminal_created, terminal_list_result,
// terminal_output {terminalId, data(base64)}, terminal_exit {terminalId,
// exitCode, killed}, terminal_error {terminalId?, requestId?, message}.
//
// Failures are answered with terminal_error / ok:false and never returned as
// handler errors: those are broadcast to every client as a bridge-level error,
// which is wrong for a single tab's problem.
//
// @param ws Requesting socket; it owns the terminals it creates.
// @param typ Message type (one of the terminal_* cases above).
// @param msg Decoded JSON frame.
// @returns Always nil.
func (h *Handlers) handleTerminal(ws *websocket.Conn, typ string, msg map[string]any) error {
	switch typ {
	case "terminal_create":
		h.terminalCreate(ws, msg)
	case "terminal_list":
		requestID, _ := msg["requestId"].(string)
		h.Send(ws, map[string]any{
			"type": "terminal_list_result", "requestId": requestID,
			"terminals": h.Terminals.List(ws),
		})
	default:
		h.terminalOp(ws, typ, msg)
	}
	return nil
}

// terminalCreate resolves the start directory and launches a shell.
//
// cwd defaults to the pooled session's workspace (sessionId) and then to the
// bridge default workspace; subdir, when given, must stay inside it.
//
// @param ws Owning socket.
// @param msg terminal_create frame.
func (h *Handlers) terminalCreate(ws *websocket.Conn, msg map[string]any) {
	requestID, _ := msg["requestId"].(string)
	sessionID, _ := msg["sessionId"].(string)
	root, _ := msg["cwd"].(string)
	subdir, _ := msg["subdir"].(string)
	if root == "" && sessionID != "" {
		if rt := h.Pool.Get(sessionID); rt != nil {
			root = rt.Cwd
		}
	}
	if root == "" {
		root = h.State.DefaultListCwd
	}
	reply := map[string]any{"type": "terminal_created", "requestId": requestID, "ok": false}
	dir, err := userterm.ResolveCwd(root, subdir)
	if err != nil {
		reply["error"] = err.Error()
		h.Send(ws, reply)
		return
	}
	info, err := h.Terminals.Create(ws, userterm.CreateOptions{
		SessionID: sessionID,
		Cwd:       dir,
		Cols:      intField(msg, "cols"),
		Rows:      intField(msg, "rows"),
	})
	if err != nil {
		reply["error"] = err.Error()
		h.Send(ws, reply)
		return
	}
	reply["ok"] = true
	reply["terminal"] = info
	h.Send(ws, reply)
}

// terminalOp applies input / resize / ack / kill to one of ws's terminals.
//
// @param ws Owning socket; foreign or finished ids get terminal_error.
// @param typ terminal_input | terminal_resize | terminal_ack | terminal_kill.
// @param msg Decoded frame carrying terminalId (+ op fields).
func (h *Handlers) terminalOp(ws *websocket.Conn, typ string, msg map[string]any) {
	id, _ := msg["terminalId"].(string)
	t, err := h.Terminals.Get(ws, id)
	if err != nil {
		h.sendTerminalError(ws, id, err.Error())
		return
	}
	switch typ {
	case "terminal_input":
		data, err := terminalInputBytes(msg)
		if err != nil {
			h.sendTerminalError(ws, id, err.Error())
			return
		}
		t.Write(uintField(msg, "seq"), data)
	case "terminal_resize":
		t.Resize(uintField(msg, "seq"), intField(msg, "cols"), intField(msg, "rows"))
	case "terminal_ack":
		t.Ack(intField(msg, "bytes"))
	case "terminal_kill":
		t.Kill()
	}
}

// sendTerminalError reports a per-terminal failure to ws only.
//
// @param ws Target socket.
// @param terminalID Terminal the error belongs to ("" when unknown).
// @param message Human-readable reason.
func (h *Handlers) sendTerminalError(ws *websocket.Conn, terminalID, message string) {
	h.Send(ws, map[string]any{"type": "terminal_error", "terminalId": terminalID, "message": message})
}

// terminalInputBytes extracts the input payload of a terminal_input frame.
//
// @param msg Frame with `data` (UTF-8 text from xterm onData) or `dataBase64`
// (raw bytes from xterm onBinary, e.g. legacy mouse reports > 127).
// @returns The bytes to write; an error for bad base64 or oversized input.
func terminalInputBytes(msg map[string]any) ([]byte, error) {
	var data []byte
	if b64, ok := msg["dataBase64"].(string); ok && b64 != "" {
		raw, err := base64.StdEncoding.DecodeString(b64)
		if err != nil {
			return nil, fmt.Errorf("invalid dataBase64: %w", err)
		}
		data = raw
	} else {
		text, _ := msg["data"].(string)
		data = []byte(text)
	}
	if len(data) > maxTerminalInputBytes {
		return nil, fmt.Errorf("terminal input too large (%d bytes, max %d)", len(data), maxTerminalInputBytes)
	}
	return data, nil
}

// intField reads a JSON number as an int.
//
// @param msg Decoded frame.
// @param key Field name.
// @returns The truncated value; 0 when missing, not a number, or out of int32 range.
func intField(msg map[string]any, key string) int {
	v, ok := msg[key].(float64)
	if !ok || math.IsNaN(v) || v > math.MaxInt32 || v < math.MinInt32 {
		return 0
	}
	return int(v)
}

// uintField reads a JSON number as a non-negative sequence number.
//
// @param msg Decoded frame.
// @param key Field name.
// @returns The truncated value; 0 (= unordered) when missing, negative or not
// an exactly representable integer.
func uintField(msg map[string]any, key string) uint64 {
	v, ok := msg[key].(float64)
	if !ok || math.IsNaN(v) || v < 0 || v > 1<<53 {
		return 0
	}
	return uint64(v)
}
