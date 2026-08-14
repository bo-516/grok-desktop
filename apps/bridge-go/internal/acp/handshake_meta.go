package acp

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
)

// initMeta is the subset of initialize used to prefill session snapshot fields.
type initMeta struct {
	Model             string
	AvailableModels   []AvailableModel
	AvailableCommands []any
}

// extractInitializeMetadata reads model, model catalog, and slash commands from
// initialize. Supports standard top-level fields and grok-build `_meta` shapes.
// Empty top-level arrays do not hide `_meta.availableCommands`.
func extractInitializeMetadata(init map[string]any) initMeta {
	meta, _ := init["_meta"].(map[string]any)
	modelState, _ := meta["modelState"].(map[string]any)
	rawModels := firstNonEmptyArray(init["availableModels"], modelState["availableModels"])
	models := normalizeAvailableModels(rawModels)

	model := ""
	if modelState != nil {
		if m, ok := modelState["model"].(string); ok {
			model = m
		} else if m, ok := modelState["currentModel"].(string); ok {
			model = m
		} else if m, ok := modelState["modelId"].(string); ok {
			model = m
		}
	}
	if model == "" && len(models) > 0 {
		model = models[0].ID
	}

	// Prefer first non-empty source so empty top-level `availableCommands: []`
	// cannot hide the real grok-build catalog on `_meta` / modelState.
	rawCmds := firstNonEmptyArray(
		init["availableCommands"],
		meta["availableCommands"],
		modelState["availableCommands"],
	)
	return initMeta{
		Model:             model,
		AvailableModels:   models,
		AvailableCommands: rawCmds,
	}
}

func authMethodSet(init map[string]any) map[string]bool {
	out := map[string]bool{}
	raw, _ := init["authMethods"].([]any)
	for _, m := range raw {
		if rec, ok := m.(map[string]any); ok {
			if id, ok := rec["id"].(string); ok && id != "" {
				out[id] = true
			}
		}
	}
	return out
}

func extractModelFromSessionResult(result any) string {
	rec, _ := result.(map[string]any)
	if rec == nil {
		return ""
	}
	if m, ok := rec["model"].(string); ok && m != "" {
		return m
	}
	// grok-build answers session/new|load with `models.currentModelId`; without
	// this the resumed session falls back to the initialize-wide default.
	if models, ok := rec["models"].(map[string]any); ok {
		if m, ok := models["currentModelId"].(string); ok && m != "" {
			return m
		}
	}
	meta, _ := rec["_meta"].(map[string]any)
	if meta != nil {
		if m, ok := meta["model"].(string); ok {
			return m
		}
		ms, _ := meta["modelState"].(map[string]any)
		if ms != nil {
			if m, ok := ms["model"].(string); ok {
				return m
			}
		}
	}
	return ""
}

func extractAvailableModelsFromSessionResult(result any) []AvailableModel {
	rec, _ := result.(map[string]any)
	if rec == nil {
		return nil
	}
	if arr, ok := rec["availableModels"].([]any); ok {
		return normalizeAvailableModels(arr)
	}
	// grok-build nests the session catalog under `models` — reading it keeps a
	// model switch from being masked by the stale initialize catalog.
	if models, ok := rec["models"].(map[string]any); ok {
		if arr, ok := models["availableModels"].([]any); ok {
			return normalizeAvailableModels(arr)
		}
	}
	meta, _ := rec["_meta"].(map[string]any)
	if meta != nil {
		ms, _ := meta["modelState"].(map[string]any)
		if ms != nil {
			if arr, ok := ms["availableModels"].([]any); ok {
				return normalizeAvailableModels(arr)
			}
		}
		if arr, ok := meta["availableModels"].([]any); ok {
			return normalizeAvailableModels(arr)
		}
	}
	return nil
}

func normalizeAvailableModels(raw any) []AvailableModel {
	arr, _ := raw.([]any)
	ids := map[string]bool{}
	var models []AvailableModel
	for _, item := range arr {
		if s, ok := item.(string); ok {
			id := strings.TrimSpace(s)
			if id == "" || ids[id] {
				continue
			}
			ids[id] = true
			models = append(models, AvailableModel{ID: id})
			continue
		}
		rec, _ := item.(map[string]any)
		if rec == nil {
			continue
		}
		id := strings.TrimSpace(fmt.Sprint(firstNonNil(rec["id"], rec["modelId"], rec["value"], rec["name"], "")))
		if id == "" || id == "<nil>" || ids[id] {
			continue
		}
		ids[id] = true
		m := AvailableModel{ID: id}
		if n, ok := rec["name"].(string); ok && strings.TrimSpace(n) != "" {
			m.Name = strings.TrimSpace(n)
		} else if n, ok := rec["label"].(string); ok && strings.TrimSpace(n) != "" {
			m.Name = strings.TrimSpace(n)
		}
		// Context window: model `_meta.totalContextTokens` (grok-build) or top-level.
		// Must survive JSON to the desktop or the composer ring stays at "No turns yet".
		if n := readPositiveInt(rec["totalContextTokens"]); n > 0 {
			m.TotalContextTokens = n
		} else if meta, ok := rec["_meta"].(map[string]any); ok {
			if n := readPositiveInt(meta["totalContextTokens"]); n > 0 {
				m.TotalContextTokens = n
			}
		}
		// Effort ladder: model `_meta.reasoningEfforts` (grok-build wire) or the
		// snake_case / top-level aliases. Desktop `/effort` and the Thinking menu
		// read only this field, so dropping it leaves both surfaces empty.
		rawEfforts := firstNonNil(rec["reasoningEfforts"], rec["reasoning_efforts"])
		if meta, ok := rec["_meta"].(map[string]any); ok {
			rawEfforts = firstNonNil(meta["reasoningEfforts"], meta["reasoning_efforts"], rawEfforts)
		}
		m.ReasoningEfforts = readReasoningEfforts(rawEfforts)
		models = append(models, m)
	}
	return models
}

// readReasoningEfforts maps an agent effort array into catalog rows.
// Accepts `{id|value, label|name, default}` objects and bare id strings; keeps
// agent order and drops duplicates. Returns nil when nothing valid is present
// so the field stays omitted rather than shipping an empty ladder.
func readReasoningEfforts(raw any) []ReasoningEffort {
	arr, _ := raw.([]any)
	seen := map[string]bool{}
	var out []ReasoningEffort
	for _, item := range arr {
		if s, ok := item.(string); ok {
			id := strings.TrimSpace(s)
			if id == "" || seen[id] {
				continue
			}
			seen[id] = true
			out = append(out, ReasoningEffort{ID: id})
			continue
		}
		rec, _ := item.(map[string]any)
		if rec == nil {
			continue
		}
		id := strings.TrimSpace(fmt.Sprint(firstNonNil(rec["id"], rec["value"], "")))
		if id == "" || id == "<nil>" || seen[id] {
			continue
		}
		seen[id] = true
		row := ReasoningEffort{ID: id}
		if l, ok := rec["label"].(string); ok && strings.TrimSpace(l) != "" {
			row.Label = strings.TrimSpace(l)
		} else if l, ok := rec["name"].(string); ok && strings.TrimSpace(l) != "" {
			row.Label = strings.TrimSpace(l)
		}
		if d, ok := rec["default"].(bool); ok && d {
			row.Default = true
		}
		out = append(out, row)
	}
	return out
}

// readPositiveInt reads a finite integer ≥ 1 from JSON number or numeric string.
// Returns 0 when absent / invalid so callers can treat 0 as "unknown".
func readPositiveInt(v any) int {
	switch n := v.(type) {
	case float64:
		if n >= 1 {
			return int(n)
		}
	case int:
		if n >= 1 {
			return n
		}
	case int64:
		if n >= 1 {
			return int(n)
		}
	case json.Number:
		i, err := n.Int64()
		if err == nil && i >= 1 {
			return int(i)
		}
	case string:
		s := strings.TrimSpace(n)
		if s == "" {
			return 0
		}
		i, err := strconv.ParseInt(s, 10, 64)
		if err == nil && i >= 1 {
			return int(i)
		}
	}
	return 0
}

// IsLiveWorkSessionUpdate reports whether an ACP sessionUpdate kind means the
// agent is still working. Metadata (commands / mode / title / usage / plan)
// must not flip a just-loaded idle transcript back to streaming — desktop
// would show Responding on the last agent bubble of a finished chat.
// @param kind sessionUpdate discriminator; unknown kinds are not live work.
func IsLiveWorkSessionUpdate(kind string) bool {
	switch kind {
	case "agent_message_chunk", "agent_thought_chunk", "tool_call", "tool_call_update":
		return true
	default:
		return false
	}
}

// ReplayWireStatus is the status advertised on replay_end.
// Load replay promotes streaming internally so a still-running turn can
// restore Working on the next live chunk; the wire must stay idle (unless
// a permission is already up) or desktop paints Responding on history.
// @param status Internal client status at flush time.
func ReplayWireStatus(status SessionStatus) SessionStatus {
	if status == StatusWaitingPermission {
		return status
	}
	return StatusIdle
}

// PromoteLiveStreamingStatus marks a session streaming when live work arrives
// after session/load forced idle. waiting_permission / disconnected stay put.
// Callers must gate on IsLiveWorkSessionUpdate; this helper does not inspect
// the update kind.
// @param st Session snapshot to patch in place; nil is a no-op.
func PromoteLiveStreamingStatus(st *SessionState) {
	if st == nil {
		return
	}
	if st.Status == StatusWaitingPermission || st.Status == StatusDisconnected {
		return
	}
	st.Status = StatusStreaming
}

// applyLifecycleUpdate patches Go-held SessionState from a raw session/update.
// Timeline is never reduced here. A non-empty available_commands_update is
// stored so later empty full-state frames still carry the grok-build slash
// catalog that the composer `/` menu reads.
func applyLifecycleUpdate(st *SessionState, update map[string]any) {
	if st == nil || update == nil {
		return
	}
	su, _ := update["sessionUpdate"].(string)
	switch su {
	case "current_mode_update":
		if mode, ok := update["mode"].(string); ok && mode != "" {
			st.Mode = mode
		} else if mid, ok := update["currentModeId"].(string); ok && mid != "" {
			if mid == "ask" || mid == "plan" || mid == "build" {
				st.Mode = mid
			}
		}
	case "session_info_update":
		if title, ok := update["title"].(string); ok {
			st.Title = title
		}
	case "available_commands_update":
		// Empty updates must not clear a catalog already taken from initialize.
		cmds := firstNonEmptyArray(update["availableCommands"])
		if len(cmds) > 0 {
			st.AvailableCommands = cmds
		}
	}
}

func preferCommands(a, b []any) []any {
	if len(a) > 0 {
		return a
	}
	return b
}

// preferAvailableModels picks the first non-empty catalog (primary, then
// current, then init) and fills TotalContextTokens from later lists when a
// thin session/new|load row dropped the window. Without this the composer
// tip stays on "No turns yet" even though initialize already knew the size.
// primary is session/new|load models (may be empty); current is the in-memory
// snapshot; fromInit is initialize `_meta` (source of missing window sizes).
func preferAvailableModels(primary, current, fromInit []AvailableModel) []AvailableModel {
	picked := primary
	if len(picked) == 0 {
		picked = current
	}
	if len(picked) == 0 {
		picked = fromInit
	}
	if len(picked) == 0 {
		return picked
	}
	byID := make(map[string]AvailableModel, len(fromInit)+len(current))
	for _, m := range fromInit {
		byID[m.ID] = m
	}
	for _, m := range current {
		if m.TotalContextTokens > 0 {
			byID[m.ID] = m
		} else if _, ok := byID[m.ID]; !ok {
			byID[m.ID] = m
		}
	}
	out := make([]AvailableModel, len(picked))
	copy(out, picked)
	for i := range out {
		if out[i].TotalContextTokens > 0 {
			continue
		}
		if other, ok := byID[out[i].ID]; ok && other.TotalContextTokens > 0 {
			out[i].TotalContextTokens = other.TotalContextTokens
		}
	}
	return out
}

// firstNonEmptyArray returns the first candidate that is a non-empty slice.
// Empty arrays are skipped so initialize `availableCommands: []` cannot hide
// `_meta.availableCommands` (parity with acp-core firstNonEmptyArray).
func firstNonEmptyArray(vals ...any) []any {
	for _, v := range vals {
		if a, ok := v.([]any); ok && len(a) > 0 {
			return a
		}
	}
	return nil
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}

func firstNonNil(vals ...any) any {
	for _, v := range vals {
		if v != nil {
			return v
		}
	}
	return nil
}
