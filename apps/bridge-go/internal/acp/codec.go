package acp

import (
	"encoding/json"
	"strings"
)

// EncodeMessage serializes a JSON-RPC message as one NDJSON line (with trailing newline).
// message: any JSON-serializable envelope (request/response/notification).
// Returns the framed line; empty string on marshal failure.
func EncodeMessage(message any) string {
	b, err := json.Marshal(message)
	if err != nil {
		return ""
	}
	return string(b) + "\n"
}

// EncodeRequest builds a JSON-RPC 2.0 request line.
// id pairs with the agent response; method is the RPC name; params may be nil.
func EncodeRequest(id any, method string, params any) string {
	msg := map[string]any{
		"jsonrpc": "2.0",
		"id":      id,
		"method":  method,
	}
	if params != nil {
		msg["params"] = params
	}
	return EncodeMessage(msg)
}

// EncodeNotification builds a JSON-RPC notification (no id, no response expected).
func EncodeNotification(method string, params any) string {
	msg := map[string]any{
		"jsonrpc": "2.0",
		"method":  method,
	}
	if params != nil {
		msg["params"] = params
	}
	return EncodeMessage(msg)
}

// EncodeResponse builds a JSON-RPC success or error response for reverse requests.
// When rpcErr is non-nil, result is ignored and the error form is written.
func EncodeResponse(id any, result any, rpcErr *JsonRpcError) string {
	if rpcErr != nil {
		return EncodeMessage(map[string]any{
			"jsonrpc": "2.0",
			"id":      id,
			"error": map[string]any{
				"code":    rpcErr.Code,
				"message": rpcErr.Message,
				"data":    rpcErr.Data,
			},
		})
	}
	if result == nil {
		result = map[string]any{}
	}
	return EncodeMessage(map[string]any{
		"jsonrpc": "2.0",
		"id":      id,
		"result":  result,
	})
}

// DecodeResult is the outcome of parsing one NDJSON line.
type DecodeResult struct {
	OK      bool
	Message JsonRpcMessage
	Error   string
	Raw     string
}

// DecodeLine parses one NDJSON line into a JSON-RPC message.
// Non-JSON / empty lines return OK=false (tolerant — agent noise never panics).
func DecodeLine(line string) DecodeResult {
	raw := strings.TrimSpace(line)
	if raw == "" {
		return DecodeResult{OK: false, Error: "empty line", Raw: line}
	}
	var parsed any
	if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
		return DecodeResult{OK: false, Error: "invalid JSON", Raw: line}
	}
	obj, ok := parsed.(map[string]any)
	if !ok {
		return DecodeResult{OK: false, Error: "message is not an object", Raw: line}
	}
	return DecodeResult{OK: true, Message: JsonRpcMessage(obj)}
}

// MessageKind classifies a decoded envelope.
type MessageKind struct {
	Kind   string // request | response | notification | unknown
	ID     any
	Method string
	Params any
	Result any
	Error  *JsonRpcError
	Raw    JsonRpcMessage
}

// ClassifyMessage splits a decoded message into request / response / notification.
// Agent→client reverse calls have both id and method.
func ClassifyMessage(message JsonRpcMessage) MessageKind {
	m := map[string]any(message)
	_, hasID := m["id"]
	method, _ := m["method"].(string)

	if hasID && method != "" {
		return MessageKind{
			Kind:   "request",
			ID:     m["id"],
			Method: method,
			Params: m["params"],
			Raw:    message,
		}
	}
	if hasID && method == "" {
		var rpcErr *JsonRpcError
		if errObj, ok := m["error"].(map[string]any); ok {
			rpcErr = &JsonRpcError{}
			if c, ok := errObj["code"].(float64); ok {
				rpcErr.Code = int(c)
			}
			if msg, ok := errObj["message"].(string); ok {
				rpcErr.Message = msg
			}
			rpcErr.Data = errObj["data"]
		}
		return MessageKind{
			Kind:   "response",
			ID:     m["id"],
			Result: m["result"],
			Error:  rpcErr,
			Raw:    message,
		}
	}
	if !hasID && method != "" {
		return MessageKind{
			Kind:   "notification",
			Method: method,
			Params: m["params"],
			Raw:    message,
		}
	}
	return MessageKind{Kind: "unknown", Raw: message}
}

// SplitNdjsonBuffer splits incomplete stdout into complete lines + remainder.
// buffer: accumulated unread stdout; may contain partial last line.
// Returns non-empty complete lines and the unfinished trailing fragment.
func SplitNdjsonBuffer(buffer string) (lines []string, rest string) {
	parts := strings.Split(buffer, "\n")
	if len(parts) == 0 {
		return nil, ""
	}
	rest = parts[len(parts)-1]
	for _, p := range parts[:len(parts)-1] {
		if len(p) > 0 {
			lines = append(lines, p)
		}
	}
	return lines, rest
}

// LineSplitter frames chunked stdout into complete NDJSON lines.
// Call Feed for each chunk; onLine receives each complete line.
type LineSplitter struct {
	buffer string
	onLine func(line string)
}

// NewLineSplitter returns a framer that never delivers partial JSON lines.
// onLine is invoked for each complete line; empty lines are still delivered
// so the codec can decide to ignore them.
func NewLineSplitter(onLine func(line string)) *LineSplitter {
	return &LineSplitter{onLine: onLine}
}

// Feed appends a stdout chunk and emits any complete lines.
func (s *LineSplitter) Feed(chunk []byte) {
	s.buffer += string(chunk)
	lines, rest := SplitNdjsonBuffer(s.buffer)
	s.buffer = rest
	for _, line := range lines {
		s.onLine(line)
	}
}
