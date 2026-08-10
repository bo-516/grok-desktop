package reverse

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// ReadWorkspaceFileResult is the guarded embed-read outcome.
type ReadWorkspaceFileResult struct {
	OK       bool   `json:"ok"`
	Content  string `json:"content,omitempty"`
	MimeType string `json:"mimeType,omitempty"`
	Bytes    int    `json:"bytes"`
	Reason   string `json:"reason,omitempty"`
	Error    string `json:"error,omitempty"`
}

// PreviewWorkspaceFileResult may truncate instead of hard-failing on oversize.
type PreviewWorkspaceFileResult struct {
	OK        bool   `json:"ok"`
	Content   string `json:"content,omitempty"`
	MimeType  string `json:"mimeType,omitempty"`
	Bytes     int    `json:"bytes"`
	Truncated bool   `json:"truncated,omitempty"`
	Reason    string `json:"reason,omitempty"`
	Error     string `json:"error,omitempty"`
}

// HandleReverseRequest dispatches fs/terminal reverse methods for one workspace.
// method: JSON-RPC method from agent; params: request params object.
// terminals: shared registry (required when terminal capability is on).
// Returns result for JSON-RPC success, or error (MethodNotFound / IO / boundary).
func HandleReverseRequest(method string, params any, workspaceAbs string, terminals *TerminalRegistry) (any, error) {
	p, _ := params.(map[string]any)
	if p == nil {
		p = map[string]any{}
	}

	switch method {
	case "fs/read_text_file":
		pathStr, _ := p["path"].(string)
		abs, err := ResolveWorkspacePath(workspaceAbs, pathStr)
		if err != nil {
			return nil, err
		}
		data, err := os.ReadFile(abs)
		if err != nil {
			return nil, err
		}
		return map[string]any{"content": string(data)}, nil

	case "fs/write_text_file":
		pathStr, _ := p["path"].(string)
		abs, err := ResolveWorkspacePath(workspaceAbs, pathStr)
		if err != nil {
			return nil, err
		}
		if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
			return nil, err
		}
		content := ""
		if c, ok := p["content"].(string); ok {
			content = c
		} else if p["content"] != nil {
			content = stringify(p["content"])
		}
		if err := os.WriteFile(abs, []byte(content), 0o644); err != nil {
			return nil, err
		}
		return map[string]any{}, nil

	case "terminal/create":
		return terminals.Create(workspaceAbs, TerminalCreateParams{
			Command:         strField(p, "command"),
			Args:            stringSlice(p["args"]),
			Cwd:             strField(p, "cwd"),
			Env:             stringMap(p["env"]),
			OutputByteLimit: intField(p, "outputByteLimit", 0),
		})

	case "terminal/output", "terminal/wait_for_exit", "terminal/wait":
		terminalID := firstString(p, "terminalId", "id")
		timeoutMs := 30_000
		if v, ok := p["timeoutMs"].(float64); ok {
			timeoutMs = int(v)
		} else if method == "terminal/output" {
			timeoutMs = 0
		}
		return terminals.Wait(terminalID, timeoutMs)

	case "terminal/kill", "terminal/release":
		terminalID := firstString(p, "terminalId", "id")
		return terminals.Kill(terminalID), nil

	default:
		return nil, &MethodNotFoundError{Method: method}
	}
}

// MethodNotFoundError signals JSON-RPC -32601 for reverse handlers.
type MethodNotFoundError struct {
	Method string
}

func (e *MethodNotFoundError) Error() string {
	return "Method not found: " + e.Method
}

// Code returns -32601.
func (e *MethodNotFoundError) Code() int { return -32601 }

// ReadWorkspaceFileForEmbed reads with full safety guards; hard-fails on oversize.
func ReadWorkspaceFileForEmbed(workspaceAbs, relativePath string) ReadWorkspaceFileResult {
	resolved := resolveReadableFile(workspaceAbs, relativePath)
	if !resolved.ok {
		return resolved.result
	}
	if resolved.bytes > MaxEmbedFileBytes {
		return ReadWorkspaceFileResult{OK: false, Bytes: resolved.bytes, Reason: "too_large"}
	}
	buf, err := os.ReadFile(resolved.abs)
	if err != nil {
		return ReadWorkspaceFileResult{OK: false, Bytes: resolved.bytes, Reason: "error", Error: err.Error()}
	}
	return decodeTextResult(buf, relativePath)
}

// ReadWorkspaceFileForPreview truncates oversize files instead of hard-failing.
func ReadWorkspaceFileForPreview(workspaceAbs, relativePath string, maxBytes int) PreviewWorkspaceFileResult {
	ceiling := MaxPreviewFileBytes
	if maxBytes > 0 && maxBytes < ceiling {
		ceiling = maxBytes
	}
	resolved := resolveReadableFile(workspaceAbs, relativePath)
	if !resolved.ok {
		return PreviewWorkspaceFileResult{
			OK: resolved.result.OK, Bytes: resolved.result.Bytes,
			Reason: resolved.result.Reason, Error: resolved.result.Error,
		}
	}
	truncated := resolved.bytes > ceiling
	var buf []byte
	var err error
	if truncated {
		f, e := os.Open(resolved.abs)
		if e != nil {
			return PreviewWorkspaceFileResult{OK: false, Bytes: resolved.bytes, Reason: "error", Error: e.Error()}
		}
		tmp := make([]byte, ceiling)
		n, e := f.Read(tmp)
		_ = f.Close()
		if e != nil && n == 0 {
			return PreviewWorkspaceFileResult{OK: false, Bytes: resolved.bytes, Reason: "error", Error: e.Error()}
		}
		buf = tmp[:n]
	} else {
		buf, err = os.ReadFile(resolved.abs)
		if err != nil {
			return PreviewWorkspaceFileResult{OK: false, Bytes: resolved.bytes, Reason: "error", Error: err.Error()}
		}
	}
	dec := decodeTextResult(buf, relativePath)
	if !dec.OK {
		return PreviewWorkspaceFileResult{OK: false, Bytes: resolved.bytes, Reason: dec.Reason}
	}
	return PreviewWorkspaceFileResult{
		OK: true, Content: dec.Content, MimeType: dec.MimeType,
		Bytes: resolved.bytes, Truncated: truncated,
	}
}

type resolvedFile struct {
	ok     bool
	abs    string
	bytes  int
	result ReadWorkspaceFileResult
}

func resolveReadableFile(workspaceAbs, relativePath string) resolvedFile {
	if IsSensitiveWorkspacePath(relativePath) {
		return resolvedFile{result: ReadWorkspaceFileResult{OK: false, Bytes: 0, Reason: "sensitive"}}
	}
	abs, err := ResolveWorkspacePath(workspaceAbs, relativePath)
	if err != nil {
		reason := "error"
		if strings.Contains(strings.ToLower(err.Error()), "outside") {
			reason = "outside"
		}
		return resolvedFile{result: ReadWorkspaceFileResult{OK: false, Bytes: 0, Reason: reason, Error: err.Error()}}
	}
	st, err := os.Stat(abs)
	if err != nil {
		return resolvedFile{result: ReadWorkspaceFileResult{OK: false, Bytes: 0, Reason: "not_found"}}
	}
	if st.IsDir() {
		return resolvedFile{result: ReadWorkspaceFileResult{OK: false, Bytes: 0, Reason: "directory"}}
	}
	return resolvedFile{ok: true, abs: abs, bytes: int(st.Size())}
}

func decodeTextResult(buf []byte, relativePath string) ReadWorkspaceFileResult {
	if IsBinaryBuffer(buf) {
		return ReadWorkspaceFileResult{OK: false, Bytes: len(buf), Reason: "binary"}
	}
	content := string(buf)
	if IsBinaryUtf8Replacement(content, len(buf)) {
		return ReadWorkspaceFileResult{OK: false, Bytes: len(buf), Reason: "binary"}
	}
	return ReadWorkspaceFileResult{
		OK: true, Content: content, MimeType: GuessTextMimeType(relativePath), Bytes: len(buf),
	}
}

func strField(p map[string]any, key string) string {
	if v, ok := p[key].(string); ok {
		return v
	}
	return ""
}

func intField(p map[string]any, key string, def int) int {
	if v, ok := p[key].(float64); ok {
		return int(v)
	}
	return def
}

func firstString(p map[string]any, keys ...string) string {
	for _, k := range keys {
		if v, ok := p[k].(string); ok && v != "" {
			return v
		}
		if v, ok := p[k]; ok && v != nil {
			return stringify(v)
		}
	}
	return ""
}

func stringSlice(v any) []string {
	arr, ok := v.([]any)
	if !ok {
		return nil
	}
	out := make([]string, 0, len(arr))
	for _, item := range arr {
		out = append(out, stringify(item))
	}
	return out
}

func stringMap(v any) map[string]string {
	m, ok := v.(map[string]any)
	if !ok {
		return nil
	}
	out := make(map[string]string, len(m))
	for k, val := range m {
		out[k] = stringify(val)
	}
	return out
}

func stringify(v any) string {
	switch t := v.(type) {
	case string:
		return t
	case float64:
		if t == float64(int64(t)) {
			return strconv.FormatInt(int64(t), 10)
		}
		return strconv.FormatFloat(t, 'f', -1, 64)
	case bool:
		return strconv.FormatBool(t)
	default:
		return fmt.Sprint(v)
	}
}
