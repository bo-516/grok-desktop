package acp

import "testing"

func TestExtractInitializeMetadataReadsMetaCommands(t *testing.T) {
	meta := extractInitializeMetadata(map[string]any{
		"_meta": map[string]any{
			"modelState": map[string]any{
				"currentModelId": "grok-4.5",
				"availableModels": []any{
					map[string]any{"modelId": "grok-4.5", "name": "Grok 4.5"},
				},
			},
			"availableCommands": []any{
				map[string]any{"name": "compact", "description": "Compress"},
				map[string]any{"name": "context", "description": "Usage"},
			},
		},
	})
	if meta.Model != "grok-4.5" {
		t.Fatalf("model=%q", meta.Model)
	}
	if len(meta.AvailableCommands) != 2 {
		t.Fatalf("commands=%d", len(meta.AvailableCommands))
	}
	rec, _ := meta.AvailableCommands[0].(map[string]any)
	if rec["name"] != "compact" {
		t.Fatalf("first command=%#v", meta.AvailableCommands[0])
	}
}

func TestExtractInitializeMetadataPrefersCurrentModelIdOverFirstRow(t *testing.T) {
	meta := extractInitializeMetadata(map[string]any{
		"_meta": map[string]any{
			"modelState": map[string]any{
				"currentModelId": "grok-4.7",
				"availableModels": []any{
					map[string]any{
						"modelId": "grok-4.5",
						"name":    "Grok 4.5",
						"_meta": map[string]any{
							"reasoningEffort": "high",
						},
					},
					map[string]any{
						"modelId": "grok-4.7",
						"name":    "Grok 4.7",
						"_meta": map[string]any{
							"reasoningEffort": "xhigh",
							"reasoningEfforts": []any{
								map[string]any{"id": "high", "label": "High", "default": true},
								map[string]any{"id": "xhigh", "label": "Extra High"},
							},
						},
					},
				},
			},
		},
	})
	if meta.Model != "grok-4.7" {
		t.Fatalf("model=%q, want currentModelId not models[0]", meta.Model)
	}
	if len(meta.AvailableModels) != 2 {
		t.Fatalf("models=%d", len(meta.AvailableModels))
	}
	if meta.AvailableModels[1].ReasoningEffort != "xhigh" {
		t.Fatalf("effort=%q", meta.AvailableModels[1].ReasoningEffort)
	}
	if len(meta.AvailableModels[1].ReasoningEfforts) != 2 {
		t.Fatalf("ladder=%d", len(meta.AvailableModels[1].ReasoningEfforts))
	}
}

func TestExtractConfigOptionsPrefersResultBody(t *testing.T) {
	got := extractConfigOptions(map[string]any{
		"configOptions": []any{
			map[string]any{"id": "model", "currentValue": "grok-4.7"},
		},
		"_meta": map[string]any{
			"configOptions": []any{
				map[string]any{"id": "model", "currentValue": "other"},
			},
		},
	})
	arr, _ := got.([]any)
	if len(arr) != 1 {
		t.Fatalf("options=%#v", got)
	}
	rec, _ := arr[0].(map[string]any)
	if rec["currentValue"] != "grok-4.7" {
		t.Fatalf("current=%#v", rec)
	}
}

func TestPreferConfigOptionsSkipsEmpty(t *testing.T) {
	fallback := []any{map[string]any{"id": "reasoning_effort", "currentValue": "xhigh"}}
	got := preferConfigOptions([]any{}, fallback)
	arr, _ := got.([]any)
	if len(arr) != 1 {
		t.Fatalf("empty preferred wiped fallback: %#v", got)
	}
	if preferConfigOptions(nil, nil) != nil {
		t.Fatal("both empty must stay nil")
	}
}

func TestApplyLifecycleUpdateKeepsConfigOptions(t *testing.T) {
	st := EmptySession("s1", "/w", "grok-4.7", "build")
	applyLifecycleUpdate(&st, map[string]any{
		"sessionUpdate": "config_option_update",
		"configOptions": []any{
			map[string]any{"id": "reasoning_effort", "currentValue": "xhigh"},
		},
	})
	arr, _ := st.ConfigOptions.([]any)
	if len(arr) != 1 {
		t.Fatalf("options=%#v", st.ConfigOptions)
	}
	applyLifecycleUpdate(&st, map[string]any{
		"sessionUpdate": "config_option_update",
		"configOptions": []any{},
	})
	arr, _ = st.ConfigOptions.([]any)
	if len(arr) != 1 {
		t.Fatalf("empty update wiped config: %#v", st.ConfigOptions)
	}
}

func TestPreferAvailableModelsFillsEffortsWhenTokensPresent(t *testing.T) {
	got := preferAvailableModels(
		[]AvailableModel{{
			ID:                 "grok-4.7",
			Name:               "Grok 4.7",
			TotalContextTokens: 500000,
		}},
		nil,
		[]AvailableModel{{
			ID:               "grok-4.7",
			ReasoningEffort:  "xhigh",
			ReasoningEfforts: []ReasoningEffort{{ID: "xhigh", Label: "Extra High"}},
		}},
	)
	if len(got) != 1 {
		t.Fatalf("len=%d", len(got))
	}
	if got[0].TotalContextTokens != 500000 || got[0].ReasoningEffort != "xhigh" || len(got[0].ReasoningEfforts) != 1 {
		t.Fatalf("got=%#v", got[0])
	}
}

func TestExtractInitializeMetadataIgnoresEmptyTopLevelCommands(t *testing.T) {
	meta := extractInitializeMetadata(map[string]any{
		"availableCommands": []any{},
		"_meta": map[string]any{
			"availableCommands": []any{
				map[string]any{"name": "workflow", "description": "Run workflow"},
			},
		},
	})
	if len(meta.AvailableCommands) != 1 {
		t.Fatalf("commands=%d", len(meta.AvailableCommands))
	}
	rec, _ := meta.AvailableCommands[0].(map[string]any)
	if rec["name"] != "workflow" {
		t.Fatalf("command=%#v", meta.AvailableCommands[0])
	}
}

func TestApplyLifecycleUpdateKeepsSlashCatalog(t *testing.T) {
	st := EmptySession("s1", "/w", "grok-4.5", "build")
	applyLifecycleUpdate(&st, map[string]any{
		"sessionUpdate": "available_commands_update",
		"availableCommands": []any{
			map[string]any{"name": "compact"},
			map[string]any{"name": "context"},
		},
	})
	if len(st.AvailableCommands) != 2 {
		t.Fatalf("after update commands=%d", len(st.AvailableCommands))
	}
	applyLifecycleUpdate(&st, map[string]any{
		"sessionUpdate":     "available_commands_update",
		"availableCommands": []any{},
	})
	if len(st.AvailableCommands) != 2 {
		t.Fatalf("empty update wiped catalog: %d", len(st.AvailableCommands))
	}
	applyLifecycleUpdate(&st, map[string]any{
		"sessionUpdate": "current_mode_update",
		"mode":          "ask",
	})
	if st.Mode != "ask" {
		t.Fatalf("mode=%q", st.Mode)
	}
}

func TestFirstNonEmptyArraySkipsEmpty(t *testing.T) {
	got := firstNonEmptyArray([]any{}, nil, []any{map[string]any{"name": "goal"}})
	if len(got) != 1 {
		t.Fatalf("got=%#v", got)
	}
	if firstNonEmptyArray(nil, []any{}) != nil {
		t.Fatal("expected nil when every candidate is empty")
	}
}

func TestPreferAvailableModelsFillsWindowFromInit(t *testing.T) {
	got := preferAvailableModels(
		[]AvailableModel{{ID: "grok-4.6", Name: "Grok 4.6"}},
		nil,
		[]AvailableModel{{ID: "grok-4.6", Name: "Grok 4.6", TotalContextTokens: 256000}},
	)
	if len(got) != 1 || got[0].TotalContextTokens != 256000 {
		t.Fatalf("got=%#v", got)
	}
}

func TestIsLiveWorkSessionUpdate(t *testing.T) {
	if !IsLiveWorkSessionUpdate("agent_message_chunk") ||
		!IsLiveWorkSessionUpdate("agent_thought_chunk") ||
		!IsLiveWorkSessionUpdate("tool_call") ||
		!IsLiveWorkSessionUpdate("tool_call_update") {
		t.Fatal("answer / thought / tool kinds must count as live work")
	}
	for _, kind := range []string{
		"available_commands_update",
		"current_mode_update",
		"session_info_update",
		"usage_update",
		"turn_completed",
		"user_message_chunk",
		"",
	} {
		if IsLiveWorkSessionUpdate(kind) {
			t.Fatalf("%q must not count as live work", kind)
		}
	}
}

func TestReplayWireStatusIdlesStreaming(t *testing.T) {
	if ReplayWireStatus(StatusStreaming) != StatusIdle {
		t.Fatal("replay wire must not advertise streaming")
	}
	if ReplayWireStatus(StatusIdle) != StatusIdle {
		t.Fatal("idle stays idle")
	}
	if ReplayWireStatus(StatusWaitingPermission) != StatusWaitingPermission {
		t.Fatal("permission during load must stay on the wire")
	}
}

func TestPromoteLiveStreamingStatusRestoresIdle(t *testing.T) {
	st := EmptySession("s1", "/w", "grok-4.5", "build")
	if st.Status != StatusIdle {
		t.Fatalf("start status=%q", st.Status)
	}
	PromoteLiveStreamingStatus(&st)
	if st.Status != StatusStreaming {
		t.Fatalf("idle should become streaming, got %q", st.Status)
	}
}

func TestPromoteLiveStreamingStatusKeepsPermission(t *testing.T) {
	st := EmptySession("s1", "/w", "grok-4.5", "build")
	st.Status = StatusWaitingPermission
	PromoteLiveStreamingStatus(&st)
	if st.Status != StatusWaitingPermission {
		t.Fatalf("permission must stay, got %q", st.Status)
	}
}

func TestPreferAvailableModelsKeepsPrimaryWindow(t *testing.T) {
	got := preferAvailableModels(
		[]AvailableModel{{ID: "grok-4.6", TotalContextTokens: 500000}},
		[]AvailableModel{{ID: "grok-4.6", TotalContextTokens: 256000}},
		[]AvailableModel{{ID: "grok-4.6", TotalContextTokens: 128000}},
	)
	if got[0].TotalContextTokens != 500000 {
		t.Fatalf("got=%d", got[0].TotalContextTokens)
	}
}
