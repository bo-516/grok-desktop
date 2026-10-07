package session

import (
	"os"
	"testing"
	"time"

	"github.com/xai-org/grok-desktop/apps/bridge-go/internal/acp"
	"github.com/xai-org/grok-desktop/apps/bridge-go/internal/pool"
)

func residentWithModels(model string) *pool.PooledRuntime {
	st := acp.EmptySession("s1", "/w", model, "build")
	st.AvailableModels = []acp.AvailableModel{{
		ID:              model,
		Name:            "Grok",
		ReasoningEffort: "xhigh",
	}}
	st.ConfigOptions = []any{map[string]any{"id": "reasoning_effort", "currentValue": "xhigh"}}
	return &pool.PooledRuntime{
		SessionID: "s1",
		Cwd:       "/w",
		GetStatus: func() acp.SessionStatus { return acp.StatusIdle },
		GetSessionState: func() acp.SessionState {
			return st
		},
		Dispose: func() {},
	}
}

func TestWaitPoolCatalogReturnsResidentModels(t *testing.T) {
	p := pool.NewRuntimePool(2)
	if err := p.Insert(residentWithModels("grok-4.7")); err != nil {
		t.Fatal(err)
	}
	snap, ok := waitPoolCatalog(p, time.Second)
	if !ok || snap.Model != "grok-4.7" || len(snap.AvailableModels) != 1 {
		t.Fatalf("snap=%#v ok=%v", snap, ok)
	}
	if snap.AvailableModels[0].ReasoningEffort != "xhigh" {
		t.Fatalf("effort=%q", snap.AvailableModels[0].ReasoningEffort)
	}
}

func TestWaitPoolCatalogSkipsEmptyPool(t *testing.T) {
	p := pool.NewRuntimePool(1)
	start := time.Now()
	_, ok := waitPoolCatalog(p, 5*time.Second)
	if ok {
		t.Fatal("empty pool must not report a catalog")
	}
	if time.Since(start) > 500*time.Millisecond {
		t.Fatal("empty pool must not wait for the deadline")
	}
}

func TestWaitPoolCatalogWaitsForInFlightHandshake(t *testing.T) {
	p := pool.NewRuntimePool(2)
	if err := p.BeginSpawn(); err != nil {
		t.Fatal(err)
	}
	go func() {
		time.Sleep(150 * time.Millisecond)
		_ = p.Insert(residentWithModels("grok-4.7"))
	}()
	snap, ok := waitPoolCatalog(p, 2*time.Second)
	if !ok || snap.Model != "grok-4.7" {
		t.Fatalf("snap=%#v ok=%v", snap, ok)
	}
}

func TestProbeInitializeCatalogLive(t *testing.T) {
	if os.Getenv("GROK_DESKTOP_LIVE_CATALOG") != "1" {
		t.Skip("set GROK_DESKTOP_LIVE_CATALOG=1 to probe a real grok initialize")
	}
	snap, err := probeInitializeCatalog(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if snap.Model == "" || len(snap.AvailableModels) == 0 {
		t.Fatalf("empty catalog model=%q models=%d", snap.Model, len(snap.AvailableModels))
	}
	t.Logf("model=%s count=%d", snap.Model, len(snap.AvailableModels))
}
