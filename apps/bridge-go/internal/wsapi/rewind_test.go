package wsapi

import (
	"strings"
	"testing"

	"github.com/xai-org/grok-desktop/apps/bridge-go/internal/acp"
	"github.com/xai-org/grok-desktop/apps/bridge-go/internal/pool"
	"github.com/xai-org/grok-desktop/apps/bridge-go/internal/rewind"
)

// rewindTestHandlers builds handlers whose pool holds one fake runtime that
// answers `_x.ai/rewind/*` with canned results and records the last call.
func rewindTestHandlers(t *testing.T, status acp.SessionStatus, calls *[]string) *Handlers {
	t.Helper()
	p := pool.NewRuntimePool(2)
	err := p.Insert(&pool.PooledRuntime{
		SessionID: "s1",
		Cwd:       t.TempDir(),
		GetStatus: func() acp.SessionStatus { return status },
		Dispose:   func() {},
		XaiRequest: func(method string, params map[string]any) (any, error) {
			*calls = append(*calls, method)
			if method == "_x.ai/rewind/points" {
				return map[string]any{"rewind_points": []any{
					map[string]any{"prompt_index": float64(0), "num_file_snapshots": float64(1), "prompt_preview": "hi"},
				}}, nil
			}
			return map[string]any{"success": true, "reverted_files": []any{"a.txt"}}, nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	return NewHandlers(p, false, t.TempDir(), 2, nil, nil)
}

func TestRewindCliCommands(t *testing.T) {
	calls := []string{}
	h := rewindTestHandlers(t, acp.StatusIdle, &calls)

	points, err := h.dispatchRewindCliCommand("rewind_points", map[string]any{"sessionId": "s1"})
	if err != nil {
		t.Fatal(err)
	}
	if got := points.([]rewind.Point); len(got) != 1 || got[0].Preview != "hi" || !got[0].HasFileChanges {
		t.Fatalf("points = %+v", got)
	}

	res, err := h.dispatchRewindCliCommand("rewind_files", map[string]any{"sessionId": "s1", "targetPromptIndex": float64(0)})
	if err != nil {
		t.Fatal(err)
	}
	if r := res.(rewind.Result); !r.Success || len(r.RevertedFiles) != 1 {
		t.Fatalf("result = %+v", r)
	}
	if strings.Join(calls, ",") != "_x.ai/rewind/points,_x.ai/rewind/execute" {
		t.Fatalf("calls = %v", calls)
	}
}

func TestRewindCliCommandGuards(t *testing.T) {
	calls := []string{}
	h := rewindTestHandlers(t, acp.StatusStreaming, &calls)
	cases := []struct {
		name string
		cmd  string
		args map[string]any
		want string
	}{
		{"no session", "rewind_points", nil, "sessionId is required"},
		{"unknown session", "rewind_points", map[string]any{"sessionId": "other"}, "not in pool"},
		{"no target", "rewind_files", map[string]any{"sessionId": "s1"}, "targetPromptIndex is required"},
		{"busy", "rewind_files", map[string]any{"sessionId": "s1", "targetPromptIndex": float64(0)}, "current turn"},
	}
	for _, tc := range cases {
		_, err := h.dispatchRewindCliCommand(tc.cmd, tc.args)
		if err == nil || !strings.Contains(err.Error(), tc.want) {
			t.Fatalf("%s: err = %v", tc.name, err)
		}
	}
	if len(calls) != 0 {
		t.Fatalf("guards must not reach the agent: %v", calls)
	}
	if !isRewindCliCommand("rewind_files") || isRewindCliCommand("git_status") {
		t.Fatal("isRewindCliCommand")
	}
}
