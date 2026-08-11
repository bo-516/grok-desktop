package main

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"unicode/utf8"
)

// UI log HTTP path served by the asset server (same origin as the embedded UI).
// Frontend POSTs JSON { level, message, stack? } so crashes land on disk even when
// the WebView console is not attached to a terminal.
const UILogPath = "/__grok_desktop_log"

// Max body size for one UI log post (guards against runaway dump loops).
const uiLogMaxBody = 64 << 10

// uiLogRequest is the JSON body accepted by UILogPath.
type uiLogRequest struct {
	// Level is error|warn|info (default error).
	Level string `json:"level"`
	// Message is a short human line (required).
	Message string `json:"message"`
	// Stack is optional stack / component stack text.
	Stack string `json:"stack,omitempty"`
	// Source tags the emitter (e.g. "boot", "boundary", "window.onerror").
	Source string `json:"source,omitempty"`
}

// WithUILogHandler wraps the asset handler so POST UILogPath is handled before
// static files. logger may be nil (then the endpoint returns 503).
// GET on the path returns 405. Other methods/paths pass through to next.
func WithUILogHandler(next http.Handler, logger *SessionLogger) http.Handler {
	if next == nil {
		next = http.NotFoundHandler()
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != UILogPath {
			next.ServeHTTP(w, r)
			return
		}
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			http.Error(w, "POST only", http.StatusMethodNotAllowed)
			return
		}
		if logger == nil {
			http.Error(w, "logging not ready", http.StatusServiceUnavailable)
			return
		}
		body, err := io.ReadAll(io.LimitReader(r.Body, uiLogMaxBody+1))
		if err != nil {
			http.Error(w, "read body", http.StatusBadRequest)
			return
		}
		if len(body) > uiLogMaxBody {
			http.Error(w, "body too large", http.StatusRequestEntityTooLarge)
			return
		}
		var req uiLogRequest
		if len(body) > 0 {
			if err := json.Unmarshal(body, &req); err != nil {
				// Plain text fallback so a desperate beacon still lands.
				req.Message = string(body)
				req.Level = "error"
			}
		}
		req.Message = strings.TrimSpace(req.Message)
		if req.Message == "" {
			http.Error(w, "message required", http.StatusBadRequest)
			return
		}
		// Cap field lengths so a single post cannot flood the disk.
		req.Message = truncateRunes(req.Message, 2000)
		req.Stack = truncateRunes(req.Stack, 8000)
		req.Source = truncateRunes(strings.TrimSpace(req.Source), 64)
		req.Level = strings.ToLower(strings.TrimSpace(req.Level))
		if req.Level == "" {
			req.Level = "error"
		}

		parts := []string{req.Message}
		if req.Source != "" {
			parts = append([]string{"src=" + req.Source}, parts...)
		}
		if req.Stack != "" {
			parts = append(parts, "stack="+req.Stack)
		}
		if err := logger.AppendUI(req.Level, strings.Join(parts, " ")); err != nil {
			http.Error(w, "write failed", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNoContent)
	})
}

// truncateRunes shortens s to at most max runes (not bytes) without splitting UTF-8.
func truncateRunes(s string, max int) string {
	if max <= 0 || s == "" {
		return ""
	}
	if utf8.RuneCountInString(s) <= max {
		return s
	}
	runes := []rune(s)
	return string(runes[:max]) + "…"
}
