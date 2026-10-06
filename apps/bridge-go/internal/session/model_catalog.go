package session

import (
	"fmt"
	"time"

	"github.com/xai-org/grok-desktop/apps/bridge-go/internal/acp"
	"github.com/xai-org/grok-desktop/apps/bridge-go/internal/pool"
	"github.com/xai-org/grok-desktop/apps/bridge-go/internal/spawn"
)

const (
	// catalogPoolWait is how long to wait for an in-flight handshake to publish
	// models before spawning a second grok. An empty pool does not wait.
	catalogPoolWait = 8 * time.Second
	// catalogPoolPoll is the gap between pool snapshots while waiting.
	catalogPoolPoll = 200 * time.Millisecond
	// catalogProbeTimeout bounds the initialize-only process. Longer than a
	// healthy initialize, shorter than the desktop's 40s request timeout.
	catalogProbeTimeout = 25 * time.Second
)

// ModelCatalog is the picker snapshot from a live session or an initialize-only
// probe. ConfigOptions is often empty on initialize; the current effort then
// lives on AvailableModels[].ReasoningEffort. Callers must not invent rows.
type ModelCatalog struct {
	Model           string
	AvailableModels []acp.AvailableModel
	ConfigOptions   any
}

// ReadModelCatalog returns a resident catalog when any pooled session already
// has models. If a runtime exists but models are not ready, it waits up to
// catalogPoolWait, then falls through to an initialize-only probe. The probe
// spawns grok, sends initialize, and disposes the process. It does not call
// session/new (that would create a ghost chat). cwd is the child working
// directory; empty uses ".". A nil pool probes immediately. Errors are spawn
// or initialize failures — an empty catalog with a nil error means the agent
// answered and advertised nothing.
func ReadModelCatalog(p *pool.RuntimePool, cwd string) (ModelCatalog, error) {
	if snap, ok := waitPoolCatalog(p, catalogPoolWait); ok {
		return snap, nil
	}
	return probeInitializeCatalog(cwd)
}

// waitPoolCatalog returns the first resident snapshot that has models.
// When the pool is empty and nothing is spawning, it returns immediately so
// a New chat does not sit through the wait. While a handshake is in flight
// (resident without models, or PendingSpawns > 0) it polls until the deadline.
func waitPoolCatalog(p *pool.RuntimePool, wait time.Duration) (ModelCatalog, bool) {
	if p == nil {
		return ModelCatalog{}, false
	}
	deadline := time.Now().Add(wait)
	for {
		states := p.SessionStates()
		snap, ok := catalogFromStates(states)
		if ok {
			return snap, true
		}
		// Empty pool and no in-flight spawn: probe now. A resident without
		// models, or a BeginSpawn that has not Inserted yet, is still a handshake.
		busy := len(states) > 0 || p.PendingSpawns() > 0
		if !busy || !time.Now().Before(deadline) {
			return ModelCatalog{}, false
		}
		time.Sleep(catalogPoolPoll)
	}
}

// catalogFromStates picks a snapshot that actually has models.
// Among several, one that also carries configOptions wins so the composer
// sees reasoning_effort currentValue when any live session has it.
func catalogFromStates(states []acp.SessionState) (ModelCatalog, bool) {
	var found ModelCatalog
	ok := false
	for _, st := range states {
		if len(st.AvailableModels) == 0 {
			continue
		}
		hasConfig := found.ConfigOptions != nil
		if !ok || (!hasConfig && st.ConfigOptions != nil) {
			found = ModelCatalog{
				Model:           st.Model,
				AvailableModels: st.AvailableModels,
				ConfigOptions:   st.ConfigOptions,
			}
			ok = true
		}
	}
	return found, ok
}

// probeInitializeCatalog starts a short-lived grok agent stdio, requests
// initialize, and disposes both the client and the process. On timeout it
// disposes so the Request goroutine unblocks via transport close. cwd empty
// becomes ".". Does not authenticate and does not call session/new.
func probeInitializeCatalog(cwd string) (ModelCatalog, error) {
	if cwd == "" {
		cwd = "."
	}
	proc, err := spawn.SpawnGrokAgent(spawn.Options{Cwd: cwd})
	if err != nil {
		return ModelCatalog{}, err
	}
	client := acp.NewClient(acp.ClientOptions{Transport: proc.Transport})
	disposed := false
	dispose := func() {
		if disposed {
			return
		}
		disposed = true
		client.Dispose()
		proc.Dispose()
	}
	defer dispose()

	type probeResult struct {
		raw any
		err error
	}
	ch := make(chan probeResult, 1)
	go func() {
		raw, reqErr := client.Request("initialize", map[string]any{
			"protocolVersion": 1,
			"clientCapabilities": map[string]any{
				"fs": map[string]any{
					"readTextFile":  true,
					"writeTextFile": false,
				},
				"terminal": false,
			},
		})
		ch <- probeResult{raw: raw, err: reqErr}
	}()

	select {
	case res := <-ch:
		if res.err != nil {
			return ModelCatalog{}, res.err
		}
		init, _ := res.raw.(map[string]any)
		model, models := acp.CatalogFromInitialize(init)
		return ModelCatalog{Model: model, AvailableModels: models}, nil
	case <-time.After(catalogProbeTimeout):
		dispose()
		return ModelCatalog{}, fmt.Errorf("initialize timed out")
	}
}
