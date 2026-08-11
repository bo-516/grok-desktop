// Package acp implements NDJSON JSON-RPC 2.0 framing and a thin ACP client.
// Timeline reduce is intentionally NOT ported: session/update is relayed raw.
package acp

import "encoding/json"

// SessionStatus matches acp-core SessionStatus chrome values.
type SessionStatus string

const (
	StatusIdle              SessionStatus = "idle"
	StatusStreaming         SessionStatus = "streaming"
	StatusWaitingPermission SessionStatus = "waiting_permission"
	StatusDisconnected      SessionStatus = "disconnected"
)

// PermissionRequest is the shaped agent permission reverse request.
type PermissionRequest struct {
	RequestID any               `json:"requestId"`
	SessionID string            `json:"sessionId,omitempty"`
	ToolCall  map[string]any    `json:"toolCall,omitempty"`
	Options   []PermissionOption `json:"options,omitempty"`
	Raw       any               `json:"raw,omitempty"`
}

// PermissionOption is one choice on a permission dialog.
type PermissionOption struct {
	OptionID string `json:"optionId"`
	Name     string `json:"name,omitempty"`
	Kind     string `json:"kind,omitempty"`
}

// AvailableModel is a picker catalog entry.
type AvailableModel struct {
	ID   string `json:"id"`
	Name string `json:"name,omitempty"`
}

// SessionState is the minimal snapshot held by the Go bridge.
// Timeline is never reduced here; it is either empty or a seed from the client.
type SessionState struct {
	ID                 string             `json:"id"`
	Workspace          string             `json:"workspace"`
	Model              string             `json:"model"`
	Mode               string             `json:"mode"`
	Status             SessionStatus      `json:"status"`
	Timeline           []any              `json:"timeline"`
	ToolCalls          map[string]any     `json:"toolCalls"`
	// Always emit lastAgentText (even "") so desktop never receives undefined
	// after JSON decode — omitempty dropped empty strings and crashed
	// timelineContentKey on lastAgentText.length.
	LastAgentText      string             `json:"lastAgentText"`
	PendingPermission  *PermissionRequest `json:"pendingPermission,omitempty"`
	AvailableModels    []AvailableModel   `json:"availableModels,omitempty"`
	AvailableCommands  []any              `json:"availableCommands,omitempty"`
	AgentCapabilities  any                `json:"agentCapabilities,omitempty"`
	ConfigOptions      any                `json:"configOptions,omitempty"`
	Title              string             `json:"title,omitempty"`
	ErrorMessage       string             `json:"errorMessage,omitempty"`
}

// EmptySession returns an idle session with empty timeline (Go does not reduce).
func EmptySession(id, workspace, model, mode string) SessionState {
	if mode == "" {
		mode = "build"
	}
	return SessionState{
		ID:            id,
		Workspace:     workspace,
		Model:         model,
		Mode:          mode,
		Status:        StatusIdle,
		Timeline:      []any{},
		ToolCalls:     map[string]any{},
		LastAgentText: "",
	}
}

// ContentBlock is a prompt content block (text / image / resource).
type ContentBlock map[string]any

// JsonRpcMessage is a generic JSON-RPC envelope for classify/decode.
type JsonRpcMessage map[string]any

// JsonRpcError is the error object on a response.
type JsonRpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    any    `json:"data,omitempty"`
}

// InitializeResult is the loosely-typed initialize response.
type InitializeResult map[string]any

// AgentRequestHandler handles agent→client reverse RPCs (fs/terminal).
// Return (result, nil) for success; (nil, err) for JSON-RPC error.
// MethodNotFoundError should be used for unknown methods.
type AgentRequestHandler func(method string, id any, params any) (any, error)

// MethodNotFoundError signals JSON-RPC -32601.
type MethodNotFoundError struct {
	Method string
}

func (e *MethodNotFoundError) Error() string {
	return "Method not found: " + e.Method
}

// Code returns the JSON-RPC error code.
func (e *MethodNotFoundError) Code() int { return -32601 }

// AsRawMessage marshals v to json.RawMessage; nil on error.
func AsRawMessage(v any) json.RawMessage {
	b, err := json.Marshal(v)
	if err != nil {
		return nil
	}
	return b
}
