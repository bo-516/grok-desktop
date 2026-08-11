package main

import (
	"bytes"
	"embed"
	"io"
	"io/fs"
	"net/http"
	"strings"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// frontendDist holds the packaged Vite build of apps/desktop.
// Build step: copy apps/desktop/dist → apps/shell/frontend/dist (see README).
//
//go:embed all:frontend/dist
var frontendDist embed.FS

// FrontendAssets returns an http.Handler that serves the embedded desktop dist.
// AssetFileServerFS auto-locates index.html under the embed tree.
func FrontendAssets() http.Handler {
	// Prefer a sub-FS rooted at frontend/dist when present so paths are clean.
	sub, err := fs.Sub(frontendDist, "frontend/dist")
	if err != nil {
		return application.AssetFileServerFS(frontendDist)
	}
	return application.AssetFileServerFS(sub)
}

// BridgeURLInjectMiddleware rewrites HTML responses to inject boot JS
// (bridge URL + log dir globals) in <head> before any module scripts run.
//
// Why not WebviewWindowOptions.JS alone? On darwin that runs after
// WebViewDidFinishNavigation, which is too late for Vite modules that call
// defaultBridgeUrl() at boot. Head injection is the reliable path.
//
// injectJS must already be a complete script body (no <script> tags), typically
// from bridgeInjectJS — quotes/backslashes must already be JSON-safe.
func BridgeURLInjectMiddleware(injectJS string) application.Middleware {
	inject := []byte("<script>" + injectJS + "</script>")
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			path := r.URL.Path
			if path != "/" && path != "" && path != "/index.html" {
				next.ServeHTTP(w, r)
				return
			}
			rec := &htmlCapture{header: make(http.Header), code: http.StatusOK}
			next.ServeHTTP(rec, r)
			body := rec.body.Bytes()
			ct := rec.header.Get("Content-Type")
			if !strings.Contains(ct, "html") && !bytes.Contains(body, []byte("<html")) {
				copyHeader(w.Header(), rec.header)
				w.WriteHeader(rec.code)
				_, _ = w.Write(body)
				return
			}
			// Prefer insert after <head>; fall back to before first <script>.
			out := body
			lower := bytes.ToLower(body)
			if i := bytes.Index(lower, []byte("<head>")); i >= 0 {
				at := i + len("<head>")
				out = append(append(append([]byte{}, body[:at]...), inject...), body[at:]...)
			} else if i := bytes.Index(lower, []byte("<script")); i >= 0 {
				out = append(append(append([]byte{}, body[:i]...), inject...), body[i:]...)
			} else {
				out = append(inject, body...)
			}
			copyHeader(w.Header(), rec.header)
			// Content-Length may be stale after rewrite.
			w.Header().Del("Content-Length")
			w.WriteHeader(rec.code)
			_, _ = w.Write(out)
		})
	}
}

// htmlCapture buffers an HTTP response so middleware can rewrite HTML.
type htmlCapture struct {
	header http.Header
	code   int
	body   bytes.Buffer
}

func (h *htmlCapture) Header() http.Header { return h.header }

func (h *htmlCapture) WriteHeader(statusCode int) { h.code = statusCode }

func (h *htmlCapture) Write(b []byte) (int, error) { return h.body.Write(b) }

// Ensure htmlCapture implements http.ResponseWriter.
var _ http.ResponseWriter = (*htmlCapture)(nil)

// copyHeader copies all src headers into dst.
func copyHeader(dst, src http.Header) {
	for k, vv := range src {
		for _, v := range vv {
			dst.Add(k, v)
		}
	}
}

// Silence unused import if tools reorder packages; io is for ResponseWriter parity docs.
var _ io.Writer = (*htmlCapture)(nil)
