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

func TestExtractSessionUpdateStampsTotalTokens(t *testing.T) {
	update, sid, eid := ExtractSessionUpdate(map[string]any{
		"sessionId": "s1",
		"update": map[string]any{
			"sessionUpdate": "tool_call",
			"toolCallId":    "t1",
			"_meta":         map[string]any{"x.ai/tool": map[string]any{"name": "grep"}},
		},
		"_meta": map[string]any{"eventId": "s1-1", "totalTokens": float64(19365)},
	})
	if update == nil {
		t.Fatal("expected update")
	}
	if sid != "s1" || eid != "s1-1" {
		t.Fatalf("sid=%s eid=%s", sid, eid)
	}
	meta, _ := update["_meta"].(map[string]any)
	if meta["totalTokens"] != float64(19365) {
		t.Fatalf("stamped totalTokens=%v", meta["totalTokens"])
	}
	tool, _ := meta["x.ai/tool"].(map[string]any)
	if tool["name"] != "grep" {
		t.Fatalf("vendor meta clobbered: %#v", meta)
	}
}

func TestExtractSessionUpdateBareUpdateDoesNotStamp(t *testing.T) {
	update, _, _ := ExtractSessionUpdate(map[string]any{
		"sessionUpdate": "tool_call",
		"_meta":         map[string]any{"x.ai/tool": map[string]any{"name": "grep"}},
	})
	if update == nil {
		t.Fatal("expected update")
	}
	meta, _ := update["_meta"].(map[string]any)
	if _, ok := meta["totalTokens"]; ok {
		t.Fatalf("bare update should not invent totalTokens: %#v", meta)
	}
}

// Probed against grok 1.0.3: initialize `_meta.modelState.availableModels[]`
// and session/new `models.availableModels[]` both carry the ladder on `_meta`.
func TestNormalizeAvailableModelsReasoningEfforts(t *testing.T) {
	models := normalizeAvailableModels([]any{
		map[string]any{
			"modelId": "grok-4.6",
			"name":    "Grok 4.6",
			"_meta": map[string]any{
				"reasoningEfforts": []any{
					map[string]any{
						"id": "xhigh", "value": "xhigh",
						"label": "Extra High Effort", "default": true,
					},
					map[string]any{"id": "low", "value": "low", "label": "Low Effort", "default": false},
					map[string]any{"id": "low", "value": "low", "label": "dupe"},
				},
			},
		},
		map[string]any{
			"id":                "snake",
			"reasoning_efforts": []any{"high", "", "high", map[string]any{"value": "medium", "name": "Medium Effort"}},
		},
		map[string]any{"id": "silent"},
	})
	if len(models) != 3 {
		t.Fatalf("len=%d", len(models))
	}
	got := models[0].ReasoningEfforts
	if len(got) != 2 {
		t.Fatalf("meta ladder=%#v", got)
	}
	if got[0] != (ReasoningEffort{ID: "xhigh", Label: "Extra High Effort", Default: true}) {
		t.Fatalf("first row=%#v", got[0])
	}
	if got[1] != (ReasoningEffort{ID: "low", Label: "Low Effort"}) {
		t.Fatalf("second row=%#v", got[1])
	}
	alias := models[1].ReasoningEfforts
	if len(alias) != 2 || alias[0].ID != "high" || alias[1] != (ReasoningEffort{ID: "medium", Label: "Medium Effort"}) {
		t.Fatalf("snake_case alias=%#v", alias)
	}
	if models[2].ReasoningEfforts != nil {
		t.Fatalf("silent model should omit, got %#v", models[2].ReasoningEfforts)
	}
}

// grok-build nests the session catalog under `models`, not top-level / `_meta`.
func TestExtractSessionResultNestedModels(t *testing.T) {
	result := map[string]any{
		"sessionId": "s1",
		"models": map[string]any{
			"currentModelId": "grok-4.5",
			"availableModels": []any{
				map[string]any{"modelId": "grok-4.5", "name": "Grok 4.5"},
			},
		},
	}
	if got := extractModelFromSessionResult(result); got != "grok-4.5" {
		t.Fatalf("model=%q", got)
	}
	models := extractAvailableModelsFromSessionResult(result)
	if len(models) != 1 || models[0].ID != "grok-4.5" {
		t.Fatalf("models=%#v", models)
	}
}
