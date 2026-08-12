package acp

import (
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"github.com/xai-org/grok-desktop/apps/bridge-go/pkg/jsonrpc"
)

// Transport is the bidirectional line transport for ACP stdio.
// Write must send a full NDJSON line including the trailing newline.
type Transport interface {
	Write(line string)
	OnLine(handler func(line string))
	OnClose(handler func(code *int))
	OnStderr(handler func(chunk string))
	Dispose()
}

// Replay buffer caps — flush a partial replay_end when either is exceeded.
const (
	// ReplayMaxUpdates is the max number of buffered updates before a mid-window flush.
	ReplayMaxUpdates = 5000
	// ReplayMaxBytes is the approximate max JSON byte size of the buffer.
	ReplayMaxBytes = 32 << 20 // 32 MiB
)

// ReplayBufferedUpdate is one raw ACP update held during session/load replay.
type ReplayBufferedUpdate struct {
	Update  map[string]any
	EventID string
}

// ClientOptions configures the thin ACP client (no timeline reduce).
type ClientOptions struct {
	Transport            Transport
	SettleQuietMs        int
	AutoPermissionOption string // e.g. "allow_once"; empty = manual
	OnStateChange        func(SessionState)
	// OnSessionUpdate relays raw ACP updates for UI reduce (live path only;
	// during load replay updates are buffered and delivered via OnReplayEnd).
	OnSessionUpdate func(update map[string]any, sessionID string, eventID string)
	// OnReplayBegin fires when session/load replay opens (emit replay_begin).
	OnReplayBegin func(sessionID string)
	// OnReplayEnd fires when the window closes or hits a buffer cap (emit replay_end).
	// updates is the ordered raw batch for this chunk; status/model/mode are authoritative.
	OnReplayEnd    func(sessionID string, updates []ReplayBufferedUpdate, status SessionStatus, model, mode string, count, bytes int, elapsedMs int64)
	OnStderr       func(line string)
	OnAgentRequest AgentRequestHandler
}

// pendingWaiter pairs a JSON-RPC request with its response channel.
type pendingWaiter struct {
	ch chan pendingResult
}

type pendingResult struct {
	result any
	err    error
}

// Client is a production ACP client used by the Go bridge.
// It handshakes, prompts, cancels, and replies to permission/fs/terminal reverse RPCs.
// Timeline growth is never applied — only status / model / mode / pendingPermission
// are tracked locally for pool + session_lifecycle. During session/load replay,
// raw updates are buffered and flushed via OnReplayEnd (no per-update WS fan-out).
type Client struct {
	mu                   sync.Mutex
	transport            Transport
	settleQuietMs        int
	autoPermissionOption string
	onStateChange        func(SessionState)
	onSessionUpdate      func(update map[string]any, sessionID string, eventID string)
	onReplayBegin        func(sessionID string)
	onReplayEnd          func(sessionID string, updates []ReplayBufferedUpdate, status SessionStatus, model, mode string, count, bytes int, elapsedMs int64)
	onStderr             func(line string)
	onAgentRequest       AgentRequestHandler

	nextID         int
	pending        map[any]pendingWaiter
	state          SessionState
	settleTimer    *time.Timer
	promptInFlight bool
	disposed       bool
	replaying      bool
	// Buffer of raw updates absorbed while replaying (not yet flushed).
	replayBuf []ReplayBufferedUpdate
	// Approximate UTF-8 byte size of JSON-serialized updates in replayBuf.
	replayBytes int
	// Wall time when the current replay window opened.
	replayStart time.Time
}

// NewClient constructs an ACP client bound to transport and starts line handling.
func NewClient(opts ClientOptions) *Client {
	ms := opts.SettleQuietMs
	if ms <= 0 {
		ms = 300
	}
	c := &Client{
		transport:            opts.Transport,
		settleQuietMs:        ms,
		autoPermissionOption: opts.AutoPermissionOption,
		onStateChange:        opts.OnStateChange,
		onSessionUpdate:      opts.OnSessionUpdate,
		onReplayBegin:        opts.OnReplayBegin,
		onReplayEnd:          opts.OnReplayEnd,
		onStderr:             opts.OnStderr,
		onAgentRequest:       opts.OnAgentRequest,
		nextID:               1,
		pending:              make(map[any]pendingWaiter),
		state:                EmptySession("", "", "", "build"),
	}
	opts.Transport.OnLine(func(line string) { c.handleLine(line) })
	opts.Transport.OnClose(func(code *int) {
		c.mu.Lock()
		wasReplaying := c.replaying
		c.replaying = false
		buf, bytes, elapsed := c.takeReplayBufferLocked()
		c.state.Status = StatusDisconnected
		c.state.PendingPermission = nil
		st := c.state
		// Reject all pending RPC waiters.
		for id, w := range c.pending {
			w.ch <- pendingResult{err: fmt.Errorf("ACP transport closed")}
			delete(c.pending, id)
		}
		c.mu.Unlock()
		if wasReplaying {
			c.emitReplayEnd(st.ID, buf, st, bytes, elapsed)
		}
		c.emitState(st)
	})
	opts.Transport.OnStderr(func(chunk string) {
		if c.onStderr != nil {
			c.onStderr(chunk)
		}
	})
	return c
}

// GetSessionState returns a copy of the minimal session snapshot.
func (c *Client) GetSessionState() SessionState {
	c.mu.Lock()
	defer c.mu.Unlock()
	return cloneState(c.state)
}

// ReplaceSessionState replaces the snapshot (seed before session/load, etc.).
func (c *Client) ReplaceSessionState(state SessionState) {
	c.mu.Lock()
	c.state = normalizeState(state)
	st := c.state
	replaying := c.replaying
	c.mu.Unlock()
	if !replaying {
		c.emitState(st)
	}
}

// SetReplaying opens/closes the session/load replay window.
// While open, state listeners are suppressed and raw updates are buffered;
// closing emits OnReplayEnd (with buffered updates) then one state flush.
// Callers must always close the window they opened (including on RPC failure).
func (c *Client) SetReplaying(on bool) {
	c.mu.Lock()
	if c.replaying == on {
		c.mu.Unlock()
		return
	}
	c.replaying = on
	st := c.state
	if on {
		c.replayBuf = nil
		c.replayBytes = 0
		c.replayStart = time.Now()
		sid := st.ID
		c.mu.Unlock()
		if c.onReplayBegin != nil {
			c.onReplayBegin(sid)
		}
		return
	}
	if c.settleTimer != nil {
		c.settleTimer.Stop()
		c.settleTimer = nil
	}
	buf, bytes, elapsed := c.takeReplayBufferLocked()
	c.mu.Unlock()
	c.emitReplayEnd(st.ID, buf, st, bytes, elapsed)
	c.emitState(st)
}

// IsReplaying reports whether a session/load replay window is open.
func (c *Client) IsReplaying() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.replaying
}

// takeReplayBufferLocked drains the replay buffer. Caller must hold c.mu.
func (c *Client) takeReplayBufferLocked() (buf []ReplayBufferedUpdate, bytes int, elapsedMs int64) {
	buf = c.replayBuf
	bytes = c.replayBytes
	if !c.replayStart.IsZero() {
		elapsedMs = time.Since(c.replayStart).Milliseconds()
	}
	c.replayBuf = nil
	c.replayBytes = 0
	if len(buf) == 0 {
		buf = []ReplayBufferedUpdate{}
	}
	return buf, bytes, elapsedMs
}

// emitReplayEnd invokes OnReplayEnd when configured.
func (c *Client) emitReplayEnd(sessionID string, buf []ReplayBufferedUpdate, st SessionState, bytes int, elapsedMs int64) {
	if c.onReplayEnd == nil {
		return
	}
	c.onReplayEnd(sessionID, buf, st.Status, st.Model, st.Mode, len(buf), bytes, elapsedMs)
}

// appendReplayUpdateLocked buffers one update and flushes mid-window if caps hit.
// Caller must hold c.mu. Returns true when a mid-window cap flush was performed
// (caller should re-open begin after unlock).
func (c *Client) appendReplayUpdateLocked(update map[string]any, eventID string) (
	capFlush bool,
	flushBuf []ReplayBufferedUpdate,
	flushBytes int,
	flushElapsed int64,
	flushSessionID string,
	flushStatus SessionStatus,
	flushModel string,
	flushMode string,
) {
	approx := 64
	if b, err := json.Marshal(update); err == nil {
		approx = len(b)
	}
	c.replayBuf = append(c.replayBuf, ReplayBufferedUpdate{Update: update, EventID: eventID})
	c.replayBytes += approx
	if len(c.replayBuf) < ReplayMaxUpdates && c.replayBytes < ReplayMaxBytes {
		return false, nil, 0, 0, "", "", "", ""
	}
	// Cap hit: drain buffer for an intermediate replay_end; stay replaying.
	flushBuf, flushBytes, flushElapsed = c.takeReplayBufferLocked()
	flushSessionID = c.state.ID
	flushStatus = c.state.Status
	flushModel = c.state.Model
	flushMode = c.state.Mode
	// Restart timing for the next chunk of the same window.
	c.replayStart = time.Now()
	return true, flushBuf, flushBytes, flushElapsed, flushSessionID, flushStatus, flushModel, flushMode
}

// Request sends a JSON-RPC request and waits for the matching response.
func (c *Client) Request(method string, params any) (any, error) {
	c.mu.Lock()
	if c.disposed {
		c.mu.Unlock()
		return nil, fmt.Errorf("AcpClient disposed")
	}
	id := c.nextID
	c.nextID++
	w := pendingWaiter{ch: make(chan pendingResult, 1)}
	c.pending[id] = w
	c.mu.Unlock()

	c.transport.Write(jsonrpc.EncodeRequest(id, method, params))
	res := <-w.ch
	return res.result, res.err
}

// Prompt sends session/prompt and marks status streaming (no timeline append).
// On success, relays prompt-result usage as a synthetic turn_completed so the
// desktop context ring fills even when vendor turn_completed is not on stdio.
func (c *Client) Prompt(sessionID string, blocks []ContentBlock) (any, error) {
	c.mu.Lock()
	c.state.Status = StatusStreaming
	c.state.ErrorMessage = ""
	c.state.LastAgentText = ""
	c.promptInFlight = true
	st := c.state
	c.mu.Unlock()
	c.emitState(st)

	result, err := c.Request("session/prompt", map[string]any{
		"sessionId": sessionID,
		"prompt":    blocks,
	})
	c.mu.Lock()
	c.promptInFlight = false
	if err != nil {
		c.state.Status = StatusIdle
		st = c.state
		c.mu.Unlock()
		c.emitState(st)
		return nil, err
	}
	c.mu.Unlock()
	// F-CTX-01: fan out usage before settle so the ring paints with idle status.
	c.relayPromptResultUsage(sessionID, result)
	c.scheduleSettle()
	return result, nil
}

// relayPromptResultUsage emits a turn_completed-shaped session_update when the
// prompt result carries input/output/total counters (probe-confirmed on _meta).
// No-op when counters are missing so partial results never zero the ring.
func (c *Client) relayPromptResultUsage(sessionID string, result any) {
	usage := extractUsageFromPromptResult(result)
	if usage == nil {
		return
	}
	id := sessionID
	if id == "" {
		c.mu.Lock()
		id = c.state.ID
		c.mu.Unlock()
	}
	if c.onSessionUpdate != nil {
		c.onSessionUpdate(map[string]any{
			"sessionUpdate": "turn_completed",
			"usage":         usage,
		}, id, "")
	}
}

// extractUsageFromPromptResult reads counters from result._meta.usage or
// top-level result._meta fields. Returns nil when any core counter is missing.
func extractUsageFromPromptResult(result any) map[string]any {
	root, ok := result.(map[string]any)
	if !ok || root == nil {
		return nil
	}
	meta, ok := root["_meta"].(map[string]any)
	if !ok || meta == nil {
		return nil
	}
	// Prefer nested usage bag when present.
	if nested, ok := meta["usage"].(map[string]any); ok {
		if bag := normalizeUsageBag(nested); bag != nil {
			return bag
		}
	}
	return normalizeUsageBag(meta)
}

// normalizeUsageBag requires inputTokens, outputTokens, totalTokens (all ≥ 0).
// Optional cache/reasoning/modelCalls are copied when present.
func normalizeUsageBag(bag map[string]any) map[string]any {
	if bag == nil {
		return nil
	}
	in, okIn := readNonNegNumber(bag["inputTokens"])
	out, okOut := readNonNegNumber(bag["outputTokens"])
	tot, okTot := readNonNegNumber(bag["totalTokens"])
	if !okIn || !okOut || !okTot {
		return nil
	}
	result := map[string]any{
		"inputTokens":  in,
		"outputTokens": out,
		"totalTokens":  tot,
	}
	if v, ok := readNonNegNumber(bag["cachedReadTokens"]); ok {
		result["cachedReadTokens"] = v
	}
	if v, ok := readNonNegNumber(bag["reasoningTokens"]); ok {
		result["reasoningTokens"] = v
	}
	if v, ok := readNonNegNumber(bag["modelCalls"]); ok {
		result["modelCalls"] = v
	}
	if v, ok := readNonNegNumber(bag["numTurns"]); ok {
		result["numTurns"] = v
	}
	return result
}

// readNonNegNumber reads a finite number ≥ 0 from JSON-decoded values.
func readNonNegNumber(v any) (float64, bool) {
	switch n := v.(type) {
	case float64:
		if n >= 0 && !isNaN(n) {
			return n, true
		}
	case int:
		if n >= 0 {
			return float64(n), true
		}
	case int64:
		if n >= 0 {
			return float64(n), true
		}
	}
	return 0, false
}

func isNaN(f float64) bool {
	return f != f
}

// Cancel notifies session/cancel and schedules settle.
func (c *Client) Cancel(sessionID string) {
	c.transport.Write(jsonrpc.EncodeNotification("session/cancel", map[string]any{
		"sessionId": sessionID,
	}))
	c.scheduleSettle()
}

// SetModel switches model mid-session via session/set_model when the agent supports it.
// On success, patches local model so session_lifecycle reflects the pick without reduce.
//
// @param sessionID Active ACP session id.
// @param modelID Agent-declared model id (never a desktop hardcode).
// @returns Agent result; error on RPC failure (including method-not-found).
func (c *Client) SetModel(sessionID, modelID string) (any, error) {
	result, err := c.Request("session/set_model", map[string]any{
		"sessionId": sessionID,
		"modelId":   modelID,
	})
	if err != nil {
		return nil, err
	}
	c.mu.Lock()
	if t := trimSpace(modelID); t != "" {
		c.state.Model = t
	}
	st := c.state
	c.mu.Unlock()
	c.emitState(st)
	return result, nil
}

// SetMode switches mode mid-session via session/set_mode when the agent supports it.
// Maps ask/plan/build into local Mode; unknown ids leave Mode unchanged.
//
// @param sessionID Active ACP session id.
// @param modeID Agent mode id (e.g. plan / build).
// @returns Agent result; error on RPC failure.
func (c *Client) SetMode(sessionID, modeID string) (any, error) {
	result, err := c.Request("session/set_mode", map[string]any{
		"sessionId": sessionID,
		"modeId":    modeID,
	})
	if err != nil {
		return nil, err
	}
	c.mu.Lock()
	if modeID == "ask" || modeID == "plan" || modeID == "build" {
		c.state.Mode = modeID
	}
	st := c.state
	c.mu.Unlock()
	c.emitState(st)
	return result, nil
}

// Compact requests context compact when the agent exposes session/compact.
//
// @param sessionID Active session.
// @param instruction Optional retention hint; empty omits the field.
// @returns Agent result; error on RPC failure.
func (c *Client) Compact(sessionID, instruction string) (any, error) {
	params := map[string]any{"sessionId": sessionID}
	if t := trimSpace(instruction); t != "" {
		params["instruction"] = instruction
	}
	return c.Request("session/compact", params)
}

// TokenUsage queries session/token_usage when the agent exposes it.
//
// @param sessionID Active session.
// @returns Agent result bag; error on RPC failure.
func (c *Client) TokenUsage(sessionID string) (any, error) {
	return c.Request("session/token_usage", map[string]any{
		"sessionId": sessionID,
	})
}

// ForkSession branches the source session into a peer via _x.ai/session/fork.
// Copies history on disk and returns the child id; this process stays on the parent.
//
// @param sourceSessionID Parent session id to copy history from.
// @param sourceCwd Absolute workspace of the source session.
// @param newCwd Absolute workspace for the forked peer (same as source for non-worktree).
// @returns Raw agent result (caller parses newSessionId); error on RPC failure.
func (c *Client) ForkSession(sourceSessionID, sourceCwd, newCwd string) (any, error) {
	return c.Request("_x.ai/session/fork", map[string]any{
		"sourceSessionId": sourceSessionID,
		"sourceCwd":       sourceCwd,
		"newCwd":          newCwd,
	})
}

// RespondPermission answers a pending session/request_permission reverse RPC.
func (c *Client) RespondPermission(optionID string) error {
	c.mu.Lock()
	pending := c.state.PendingPermission
	if pending == nil {
		c.mu.Unlock()
		return fmt.Errorf("No pending permission request")
	}
	reqID := pending.RequestID
	c.state.PendingPermission = nil
	nextStatus := StatusStreaming
	if optionID == "deny_and_stop" {
		nextStatus = StatusIdle
	}
	c.state.Status = nextStatus
	sessionID := c.state.ID
	st := c.state
	c.mu.Unlock()

	c.transport.Write(jsonrpc.EncodeResponse(reqID, BuildPermissionOutcome(optionID), nil))
	c.emitState(st)
	if optionID == "deny_and_stop" && sessionID != "" {
		c.Cancel(sessionID)
	}
	return nil
}

// Dispose stops settle timers and disposes the transport.
func (c *Client) Dispose() {
	c.mu.Lock()
	c.disposed = true
	if c.settleTimer != nil {
		c.settleTimer.Stop()
		c.settleTimer = nil
	}
	c.mu.Unlock()
	c.transport.Dispose()
}

// --- internals ---

func (c *Client) emitState(st SessionState) {
	if c.onStateChange != nil {
		c.onStateChange(cloneState(st))
	}
}

func (c *Client) scheduleSettle() {
	c.mu.Lock()
	if c.settleTimer != nil {
		c.settleTimer.Stop()
	}
	ms := c.settleQuietMs
	c.settleTimer = time.AfterFunc(time.Duration(ms)*time.Millisecond, func() {
		c.mu.Lock()
		if c.promptInFlight ||
			c.state.Status == StatusWaitingPermission ||
			c.state.Status == StatusDisconnected {
			c.mu.Unlock()
			return
		}
		c.state.Status = StatusIdle
		st := c.state
		c.mu.Unlock()
		c.emitState(st)
	})
	c.mu.Unlock()
}

func (c *Client) handleLine(line string) {
	dec := jsonrpc.DecodeLine(line)
	if !dec.OK {
		return
	}
	c.dispatchMessage(dec.Message)
}

// rpcIDKey normalizes JSON-RPC ids so pending map lookups match.
// encoding/json decodes numbers as float64; Request stores int keys — without
// this bridge, every handshake/prompt hangs forever waiting on a response.
func rpcIDKey(id any) any {
	switch v := id.(type) {
	case float64:
		return int(v)
	case float32:
		return int(v)
	case int:
		return v
	case int64:
		return int(v)
	case int32:
		return int(v)
	case json.Number:
		if i, err := v.Int64(); err == nil {
			return int(i)
		}
		return v.String()
	default:
		return id
	}
}

func (c *Client) dispatchMessage(message JsonRpcMessage) {
	kind := jsonrpc.ClassifyMessage(message)

	switch kind.Kind {
	case "response":
		key := rpcIDKey(kind.ID)
		c.mu.Lock()
		w, ok := c.pending[key]
		if ok {
			delete(c.pending, key)
		}
		c.mu.Unlock()
		if !ok {
			return
		}
		if kind.Error != nil {
			w.ch <- pendingResult{err: fmt.Errorf("%s", kind.Error.Message)}
		} else {
			w.ch <- pendingResult{result: kind.Result}
		}

	case "notification":
		if IsSessionUpdateMethod(kind.Method) {
			c.handleSessionUpdate(kind.Params)
		}

	case "request":
		go c.handleIncomingRequest(kind.ID, kind.Method, kind.Params)
	}
}

func (c *Client) handleSessionUpdate(params any) {
	update, sessionID, eventID := ExtractSessionUpdate(params)
	if update == nil {
		return
	}
	c.mu.Lock()
	if sessionID == "" {
		sessionID = c.state.ID
	}
	// Patch minimal fields from known update kinds (no timeline).
	if su, _ := update["sessionUpdate"].(string); su == "current_mode_update" {
		if mode, ok := update["mode"].(string); ok && mode != "" {
			c.state.Mode = mode
		} else if mid, ok := update["currentModeId"].(string); ok && mid != "" {
			if mid == "ask" || mid == "plan" || mid == "build" {
				c.state.Mode = mid
			}
		}
	}
	if su, _ := update["sessionUpdate"].(string); su == "session_info_update" {
		if title, ok := update["title"].(string); ok {
			c.state.Title = title
		}
	}
	// Live activity → streaming unless waiting for permission.
	if c.state.Status != StatusWaitingPermission && c.state.Status != StatusDisconnected {
		if c.promptInFlight || c.state.Status == StatusStreaming {
			c.state.Status = StatusStreaming
		}
	}
	st := c.state
	replaying := c.replaying
	promptInFlight := c.promptInFlight
	var (
		capFlush       bool
		flushBuf       []ReplayBufferedUpdate
		flushBytes     int
		flushElapsed   int64
		flushSessionID string
		flushStatus    SessionStatus
		flushModel     string
		flushMode      string
	)
	if replaying {
		capFlush, flushBuf, flushBytes, flushElapsed, flushSessionID, flushStatus, flushModel, flushMode =
			c.appendReplayUpdateLocked(update, eventID)
	}
	c.mu.Unlock()

	if replaying {
		// No per-update fan-out during load; optional mid-window cap flush.
		if capFlush {
			if c.onReplayEnd != nil {
				c.onReplayEnd(flushSessionID, flushBuf, flushStatus, flushModel, flushMode,
					len(flushBuf), flushBytes, flushElapsed)
			}
			// Re-open the window so the frontend stays silent for the rest.
			if c.onReplayBegin != nil {
				c.onReplayBegin(flushSessionID)
			}
		}
		return
	}
	if c.onSessionUpdate != nil {
		c.onSessionUpdate(update, sessionID, eventID)
	}
	c.emitState(st)
	if promptInFlight || st.Status == StatusStreaming {
		c.scheduleSettle()
	}
}

func (c *Client) handleIncomingRequest(id any, method string, params any) {
	if method == "session/request_permission" {
		shaped := ShapePermissionRequest(id, params)
		c.mu.Lock()
		c.state.PendingPermission = &shaped
		c.state.Status = StatusWaitingPermission
		auto := c.autoPermissionOption
		st := c.state
		c.mu.Unlock()
		c.emitState(st)
		if auto != "" {
			_ = c.RespondPermission(auto)
		}
		return
	}

	if c.onAgentRequest != nil {
		result, err := c.onAgentRequest(method, id, params)
		if err != nil {
			code := -32000
			msg := err.Error()
			if mnf, ok := err.(*MethodNotFoundError); ok {
				code = mnf.Code()
			} else if ce, ok := err.(interface{ Code() int }); ok {
				code = ce.Code()
			}
			if code == -32601 || containsIgnoreCase(msg, "method not found") {
				code = -32601
			}
			if !containsIgnoreCase(msg, method) {
				msg = msg + " (" + method + ")"
			}
			c.transport.Write(jsonrpc.EncodeResponse(id, nil, &JsonRpcError{Code: code, Message: msg}))
			return
		}
		c.transport.Write(jsonrpc.EncodeResponse(id, result, nil))
		return
	}

	c.transport.Write(jsonrpc.EncodeResponse(id, nil, &JsonRpcError{
		Code:    -32601,
		Message: "Method not found: " + method,
	}))
}

// IsSessionUpdateMethod reports whether method carries an ACP session update.
func IsSessionUpdateMethod(method string) bool {
	return method == "session/update" || method == "_x.ai/session/update"
}

// ExtractSessionUpdate pulls the update object + sessionId + eventId from params.
func ExtractSessionUpdate(params any) (update map[string]any, sessionID string, eventID string) {
	p, ok := params.(map[string]any)
	if !ok {
		return nil, "", ""
	}
	var u map[string]any
	if nested, ok := p["update"].(map[string]any); ok {
		u = nested
	} else {
		u = p
	}
	if u == nil {
		return nil, "", ""
	}
	if _, ok := u["sessionUpdate"].(string); !ok {
		return nil, "", ""
	}
	if sid, ok := p["sessionId"].(string); ok {
		sessionID = sid
	}
	eventID = extractEventID(p)
	if eventID == "" {
		eventID = extractEventID(u)
	}
	return u, sessionID, eventID
}

func extractEventID(obj map[string]any) string {
	meta, ok := obj["_meta"].(map[string]any)
	if !ok {
		return ""
	}
	if id, ok := meta["eventId"].(string); ok {
		return trimSpace(id)
	}
	return ""
}

// ShapePermissionRequest normalizes an agent permission request.
func ShapePermissionRequest(requestID any, params any) PermissionRequest {
	source, _ := params.(map[string]any)
	if source == nil {
		source = map[string]any{}
	}
	toolCall, _ := source["toolCall"].(map[string]any)
	if toolCall == nil {
		toolCall, _ = source["tool_call"].(map[string]any)
	}
	if toolCall == nil {
		toolCall = map[string]any{}
	}
	var options []PermissionOption
	rawOpts, _ := source["options"].([]any)
	if len(rawOpts) == 0 {
		if alt, ok := source["permissionOptions"].([]any); ok {
			rawOpts = alt
		}
	}
	for _, ro := range rawOpts {
		rec, _ := ro.(map[string]any)
		if rec == nil {
			continue
		}
		oid := fmt.Sprint(firstNonNil(rec["optionId"], rec["id"], "allow_once"))
		opt := PermissionOption{OptionID: oid}
		if n, ok := rec["name"].(string); ok {
			opt.Name = n
		}
		if k, ok := rec["kind"].(string); ok {
			opt.Kind = k
		}
		options = append(options, opt)
	}
	if len(options) == 0 {
		options = []PermissionOption{
			{OptionID: "allow_once", Name: "Allow once"},
			{OptionID: "allow_always", Name: "Always allow this tool"},
			{OptionID: "deny", Name: "Deny"},
			{OptionID: "deny_and_stop", Name: "Deny and stop"},
		}
	}
	tc := map[string]any{}
	if id, ok := toolCall["toolCallId"].(string); ok {
		tc["toolCallId"] = id
	} else if id, ok := toolCall["id"].(string); ok {
		tc["toolCallId"] = id
	}
	if t, ok := toolCall["title"].(string); ok {
		tc["title"] = t
	}
	if k, ok := toolCall["kind"].(string); ok {
		tc["kind"] = k
	}
	if s, ok := toolCall["status"].(string); ok {
		tc["status"] = s
	}
	pr := PermissionRequest{
		RequestID: requestID,
		ToolCall:  tc,
		Options:   options,
		Raw:       params,
	}
	if sid, ok := source["sessionId"].(string); ok {
		pr.SessionID = sid
	}
	return pr
}

// BuildPermissionOutcome builds the ACP permission success body.
func BuildPermissionOutcome(optionID string) any {
	return map[string]any{
		"outcome": map[string]any{
			"outcome":  "selected",
			"optionId": optionID,
		},
	}
}

func cloneState(s SessionState) SessionState {
	out := s
	if s.Timeline == nil {
		out.Timeline = []any{}
	} else {
		out.Timeline = append([]any{}, s.Timeline...)
	}
	if s.ToolCalls == nil {
		out.ToolCalls = map[string]any{}
	} else {
		out.ToolCalls = make(map[string]any, len(s.ToolCalls))
		for k, v := range s.ToolCalls {
			out.ToolCalls[k] = v
		}
	}
	if s.PendingPermission != nil {
		cp := *s.PendingPermission
		out.PendingPermission = &cp
	}
	if s.AvailableModels != nil {
		out.AvailableModels = append([]AvailableModel{}, s.AvailableModels...)
	}
	if s.AvailableCommands != nil {
		out.AvailableCommands = append([]any{}, s.AvailableCommands...)
	}
	return out
}

func normalizeState(s SessionState) SessionState {
	if s.Timeline == nil {
		s.Timeline = []any{}
	}
	if s.ToolCalls == nil {
		s.ToolCalls = map[string]any{}
	}
	if s.Mode == "" {
		s.Mode = "build"
	}
	if s.Status == "" {
		s.Status = StatusIdle
	}
	return s
}

func trimSpace(s string) string {
	for len(s) > 0 && (s[0] == ' ' || s[0] == '\t') {
		s = s[1:]
	}
	for len(s) > 0 && (s[len(s)-1] == ' ' || s[len(s)-1] == '\t') {
		s = s[:len(s)-1]
	}
	return s
}

func containsIgnoreCase(s, sub string) bool {
	return len(sub) == 0 || stringsContainsFold(s, sub)
}

func stringsContainsFold(s, sub string) bool {
	return len(s) >= len(sub) && (s == sub ||
		len(sub) == 0 ||
		indexFold(s, sub) >= 0)
}

func indexFold(s, sub string) int {
	// small helper without importing strings for fold — use strings package
	return indexFoldImpl(s, sub)
}
