package acp

import "testing"

func TestNormalizeAvailableModelsTotalContextTokens(t *testing.T) {
	models := normalizeAvailableModels([]any{
		map[string]any{
			"modelId": "grok-4.5",
			"name":    "Grok 4.5",
			"_meta":   map[string]any{"totalContextTokens": float64(500000)},
		},
		map[string]any{
			"id":                 "top-level",
			"totalContextTokens": float64(128000),
		},
		map[string]any{
			"id":    "bad",
			"_meta": map[string]any{"totalContextTokens": float64(-1)},
		},
	})
	if len(models) != 3 {
		t.Fatalf("len=%d", len(models))
	}
	if models[0].TotalContextTokens != 500000 {
		t.Fatalf("meta tokens=%d", models[0].TotalContextTokens)
	}
	if models[1].TotalContextTokens != 128000 {
		t.Fatalf("top-level tokens=%d", models[1].TotalContextTokens)
	}
	if models[2].TotalContextTokens != 0 {
		t.Fatalf("bad should omit, got %d", models[2].TotalContextTokens)
	}
}

func TestExtractUsageFromPromptResult(t *testing.T) {
	bag := extractUsageFromPromptResult(map[string]any{
		"stopReason": "end_turn",
		"_meta": map[string]any{
			"usage": map[string]any{
				"inputTokens":  float64(100),
				"outputTokens": float64(10),
				"totalTokens":  float64(110),
			},
		},
	})
	if bag == nil || bag["inputTokens"] != float64(100) {
		t.Fatalf("nested usage: %#v", bag)
	}
	bag2 := extractUsageFromPromptResult(map[string]any{
		"_meta": map[string]any{
			"inputTokens":  float64(50),
			"outputTokens": float64(5),
			"totalTokens":  float64(55),
		},
	})
	if bag2 == nil || bag2["totalTokens"] != float64(55) {
		t.Fatalf("top-level meta: %#v", bag2)
	}
	if extractUsageFromPromptResult(map[string]any{"_meta": map[string]any{"inputTokens": float64(1)}}) != nil {
		t.Fatal("partial should be nil")
	}
}
