package rewind

import "fmt"

// normalizePoints maps the `_x.ai/rewind/points` result onto Points.
// grok-build answers in snake_case; camelCase spellings are accepted too so a
// future casing change does not silently empty the list.
// @param raw Decoded JSON result (map expected; anything else yields none).
// @returns Points in the agent's order (never nil).
func normalizePoints(raw any) []Point {
	out := []Point{}
	m, _ := raw.(map[string]any)
	rows, _ := pick(m, "rewind_points", "rewindPoints", "points").([]any)
	for _, r := range rows {
		row, ok := r.(map[string]any)
		if !ok {
			continue
		}
		idx, ok := toInt(pick(row, "prompt_index", "promptIndex"))
		if !ok || idx < 0 {
			continue
		}
		count, _ := toInt(pick(row, "num_file_snapshots", "numFileSnapshots"))
		out = append(out, Point{
			PromptIndex:    idx,
			Preview:        toString(pick(row, "prompt_preview", "promptPreview", "prompt_text", "promptText")),
			CreatedAt:      toString(pick(row, "created_at", "createdAt")),
			FileCount:      count,
			HasFileChanges: toBool(pick(row, "has_file_changes", "hasFileChanges")) || count > 0,
		})
	}
	return out
}

// normalizeResult maps the `_x.ai/rewind/execute` result onto Result.
// @param raw Decoded JSON result.
// @param target Requested boundary (used when the agent omits the echo).
// @returns Result with non-nil slices; a non-object result is a refusal.
func normalizeResult(raw any, target int) Result {
	m, ok := raw.(map[string]any)
	res := Result{
		TargetPromptIndex: target,
		RevertedFiles:     []string{},
		CleanFiles:        []string{},
		Conflicts:         []Conflict{},
		DeletedFiles:      []string{},
		Warnings:          []string{},
	}
	if !ok {
		res.Error = "grok-build returned no rewind result"
		return res
	}
	res.Success = toBool(m["success"])
	if idx, ok := toInt(pick(m, "target_prompt_index", "targetPromptIndex")); ok {
		res.TargetPromptIndex = idx
	}
	res.RevertedFiles = toStrings(pick(m, "reverted_files", "revertedFiles"))
	res.CleanFiles = toStrings(pick(m, "clean_files", "cleanFiles"))
	conflicts, _ := m["conflicts"].([]any)
	for _, c := range conflicts {
		cm, ok := c.(map[string]any)
		if !ok {
			continue
		}
		path := toString(cm["path"])
		if path == "" {
			continue
		}
		res.Conflicts = append(res.Conflicts, Conflict{
			Path: path,
			Type: toString(pick(cm, "conflict_type", "conflictType", "type")),
		})
	}
	res.Error = toString(m["error"])
	if !res.Success && res.Error == "" {
		res.Error = "grok-build did not apply the rewind"
	}
	return res
}

// pick returns the first present (non-nil) value among keys.
// @param m Object (nil-safe).
// @param keys Candidate keys in priority order.
// @returns Value or nil.
func pick(m map[string]any, keys ...string) any {
	for _, k := range keys {
		if v, ok := m[k]; ok && v != nil {
			return v
		}
	}
	return nil
}

// toInt converts a JSON number (float64) or Go int to int.
// @param v Value.
// @returns Integer and whether v was numeric.
func toInt(v any) (int, bool) {
	switch n := v.(type) {
	case float64:
		return int(n), true
	case int:
		return n, true
	case int64:
		return int(n), true
	default:
		return 0, false
	}
}

// toString returns strings as-is, "" for nil, fmt.Sprint otherwise.
// @param v Value.
// @returns String form.
func toString(v any) string {
	switch s := v.(type) {
	case nil:
		return ""
	case string:
		return s
	default:
		return fmt.Sprint(s)
	}
}

// toBool is true only for a JSON true.
// @param v Value.
// @returns Boolean.
func toBool(v any) bool {
	b, _ := v.(bool)
	return b
}

// toStrings converts a JSON array to non-empty strings (never nil).
// @param v Value ([]any expected).
// @returns Strings.
func toStrings(v any) []string {
	out := []string{}
	arr, _ := v.([]any)
	for _, item := range arr {
		if s := toString(item); s != "" {
			out = append(out, s)
		}
	}
	return out
}
