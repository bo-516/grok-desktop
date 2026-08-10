package wsapi

import (
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sync"

	"github.com/gorilla/websocket"
	"github.com/xai-org/grok-desktop/apps/bridge-go/internal/pool"
	"github.com/xai-org/grok-desktop/apps/bridge-go/internal/session"
)

// Bridge version advertised on hello for cold-switch observability.
const BridgeVersion = "0.1.0"

// BridgeImpl is the hello.impl value for this binary.
const BridgeImpl = "go"

// Config is process-level bridge configuration from env.
type Config struct {
	Host           string
	Port           int
	Cwd            string
	AlwaysApprove  bool
	PoolCapacity   int
	Token          string
	AllowedOrigins []string
}

// ConfigFromEnv reads BRIDGE_* environment variables.
func ConfigFromEnv(defaultCwd string) Config {
	host := os.Getenv("BRIDGE_HOST")
	if host == "" {
		host = "127.0.0.1"
	}
	port := ResolveListenPort(os.Getenv("BRIDGE_PORT"), 8765)
	cwd := os.Getenv("BRIDGE_CWD")
	if cwd == "" {
		cwd = defaultCwd
	}
	if abs, err := filepath.Abs(cwd); err == nil {
		cwd = abs
	}
	return Config{
		Host:           host,
		Port:           port,
		Cwd:            cwd,
		AlwaysApprove:  os.Getenv("BRIDGE_ALWAYS_APPROVE") == "1",
		PoolCapacity:   session.PoolCapacityFromEnv(),
		Token:          ResolveBridgeToken(os.Getenv("BRIDGE_TOKEN")),
		AllowedOrigins: ResolveAllowedOrigins(os.Getenv("BRIDGE_ALLOWED_ORIGINS")),
	}
}

// Server is the HTTP + WebSocket bridge process.
type Server struct {
	cfg      Config
	pool     *pool.RuntimePool
	handlers *Handlers
	upgrader websocket.Upgrader
	mu       sync.Mutex
	// Per-connection write mutex: gorilla websocket allows only one concurrent writer.
	sockets  map[*websocket.Conn]*sync.Mutex
	httpSrv  *http.Server
	listener net.Listener
}

// NewServer constructs the bridge server (not yet listening).
func NewServer(cfg Config) *Server {
	p := pool.NewRuntimePool(cfg.PoolCapacity)
	s := &Server{
		cfg:     cfg,
		pool:    p,
		sockets: make(map[*websocket.Conn]*sync.Mutex),
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool {
				// Origin is enforced in authorize before upgrade; allow all here
				// so browsers get a proper 401/403 from our handler instead of
				// a silent upgrade reject from gorilla.
				return true
			},
		},
	}
	s.handlers = NewHandlers(p, cfg.AlwaysApprove, cfg.Cwd, cfg.PoolCapacity, s.send, s.broadcast)
	return s
}

// ListenAndServe binds host:port and serves until the listener is closed.
func (s *Server) ListenAndServe() error {
	mux := http.NewServeMux()
	mux.HandleFunc("/", s.handleHTTP)
	mux.HandleFunc("/ws", s.handleWS)
	// Also accept WS on root path (Node attaches WSS to the same HTTP server).
	// Node uses WebSocketServer({ server }) so any path upgrades. Match that.
	s.httpSrv = &http.Server{Handler: mux}

	addr := fmt.Sprintf("%s:%d", s.cfg.Host, s.cfg.Port)
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return err
	}
	s.listener = ln
	boundPort := ln.Addr().(*net.TCPAddr).Port

	fmt.Fprintf(os.Stderr,
		"[bridge] listening http://%s:%d cwd=%s pool=%d alwaysApprove=%v impl=%s\n",
		s.cfg.Host, boundPort, s.cfg.Cwd, s.cfg.PoolCapacity, s.cfg.AlwaysApprove, BridgeImpl)
	wsURL := BridgeWsURL(boundPort, s.cfg.Token, s.cfg.Host)
	fmt.Fprintf(os.Stderr, "[bridge] ws=%s\n", wsURL)
	ready, _ := json.Marshal(map[string]any{
		"host": s.cfg.Host, "port": boundPort, "token": s.cfg.Token,
		"impl": BridgeImpl, "version": BridgeVersion,
	})
	fmt.Fprintf(os.Stderr, "[bridge] ready %s\n", string(ready))

	return s.httpSrv.Serve(ln)
}

// BoundPort returns the actual listen port (useful when Port was 0).
func (s *Server) BoundPort() int {
	if s.listener == nil {
		return s.cfg.Port
	}
	return s.listener.Addr().(*net.TCPAddr).Port
}

// Close shuts down the HTTP server and all child agent processes.
func (s *Server) Close() error {
	s.pool.DisposeAll()
	if s.httpSrv != nil {
		return s.httpSrv.Close()
	}
	return nil
}

// Pool exposes the runtime pool for tests / health.
func (s *Server) Pool() *pool.RuntimePool { return s.pool }

// Handlers exposes message handlers for tests.
func (s *Server) Handlers() *Handlers { return s.handlers }

func (s *Server) broadcast(msg map[string]any) {
	raw, err := json.Marshal(msg)
	if err != nil {
		return
	}
	s.mu.Lock()
	conns := make([]struct {
		ws *websocket.Conn
		w  *sync.Mutex
	}, 0, len(s.sockets))
	for ws, wmu := range s.sockets {
		conns = append(conns, struct {
			ws *websocket.Conn
			w  *sync.Mutex
		}{ws, wmu})
	}
	s.mu.Unlock()
	for _, c := range conns {
		c.w.Lock()
		_ = c.ws.WriteMessage(websocket.TextMessage, raw)
		c.w.Unlock()
	}
}

func (s *Server) send(ws *websocket.Conn, msg map[string]any) {
	raw, err := json.Marshal(msg)
	if err != nil {
		return
	}
	s.mu.Lock()
	wmu := s.sockets[ws]
	s.mu.Unlock()
	if wmu == nil {
		// Connection not registered yet or already closed — best-effort write.
		_ = ws.WriteMessage(websocket.TextMessage, raw)
		return
	}
	wmu.Lock()
	_ = ws.WriteMessage(websocket.TextMessage, raw)
	wmu.Unlock()
}

func (s *Server) handleHTTP(w http.ResponseWriter, r *http.Request) {
	// WebSocket upgrade on any path (Node-compatible).
	if websocket.IsWebSocketUpgrade(r) {
		s.handleWS(w, r)
		return
	}
	// Health endpoint stays open (no secrets).
	env := session.CheckEnvironment(s.cfg.PoolCapacity)
	port := s.BoundPort()
	body := map[string]any{
		"ok":      true,
		"service": "grok-desktop-bridge",
		"impl":    BridgeImpl,
		"version": BridgeVersion,
		"cwd":     s.handlers.State.DefaultListCwd,
		"ws":      fmt.Sprintf("ws://%s:%d", s.cfg.Host, port),
		"focusedSessionId": s.handlers.State.FocusedSessionID,
		"pool": map[string]any{
			"capacity": s.cfg.PoolCapacity,
			"entries":  s.pool.List(),
		},
		"environment": env,
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(body)
}

func (s *Server) handleWS(w http.ResponseWriter, r *http.Request) {
	authCfg := WsAuthConfig{Token: s.cfg.Token, AllowedOrigins: s.cfg.AllowedOrigins}
	result := AuthorizeWsConnection(r, authCfg)
	if !result.OK {
		http.Error(w, result.Reason, result.Status)
		return
	}
	conn, err := s.upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	writeMu := &sync.Mutex{}
	s.mu.Lock()
	s.sockets[conn] = writeMu
	s.mu.Unlock()

	port := s.BoundPort()
	s.send(conn, map[string]any{
		"type": "hello", "cwd": s.handlers.State.DefaultListCwd,
		"port": port, "poolCapacity": s.cfg.PoolCapacity,
		"impl": BridgeImpl, "version": BridgeVersion,
	})
	s.send(conn, map[string]any{"type": "pool", "entries": s.pool.List()})
	focused := s.handlers.State.FocusedSessionID
	if focused != "" && s.pool.Has(focused) {
		if rt := s.pool.Get(focused); rt != nil {
			s.send(conn, map[string]any{"type": "state", "session": rt.GetSessionState()})
		}
	}
	go func() {
		env := session.CheckEnvironment(s.cfg.PoolCapacity)
		s.send(conn, map[string]any{"type": "environment", "env": env})
	}()

	go func() {
		defer func() {
			s.mu.Lock()
			delete(s.sockets, conn)
			s.mu.Unlock()
			_ = conn.Close()
		}()
		for {
			_, data, err := conn.ReadMessage()
			if err != nil {
				return
			}
			// Dispatch off the read loop (like Node's void async handlers).
			// Critical: handlePrompt blocks on session/prompt until the agent
			// returns; if we ran that inline, a mid-turn {type:permission}
			// frame could never be ReadMessage'd → reverse-RPC deadlock.
			// permission / cancel / ping must stay concurrent with prompt.
			payload := string(data)
			go func() {
				defer func() {
					if rec := recover(); rec != nil {
						fmt.Fprintf(os.Stderr, "[bridge] handler panic: %v\n", rec)
					}
				}()
				s.handlers.OnClientMessage(conn, payload)
			}()
		}
	}()
}
