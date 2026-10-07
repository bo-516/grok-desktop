package acp

// CatalogFromInitialize reads the current model id and availableModels from an
// initialize result. currentModelId wins over the first catalog row. A nil or
// empty result yields "" and nil — callers must not invent a catalog.
func CatalogFromInitialize(init map[string]any) (string, []AvailableModel) {
	if init == nil {
		return "", nil
	}
	meta := extractInitializeMetadata(init)
	return meta.Model, meta.AvailableModels
}

// nonEmptyConfigOptions returns v when it is a non-empty array.
// Empty arrays, null, and other types are missing: storing them would wipe a
// model / reasoning_effort select the composer already has. Returns nil when
// nothing usable is present so omitempty can drop the field.
func nonEmptyConfigOptions(v any) any {
	arr, ok := v.([]any)
	if !ok || len(arr) == 0 {
		return nil
	}
	return arr
}

// extractConfigOptions reads configOptions from a session/new or session/load
// result. grok-build puts the live model and reasoning_effort selects on the
// result body; `_meta.configOptions` is the fallback. An empty top-level array
// does not hide the meta list. Returns nil when both are missing or empty —
// callers must not invent options.
func extractConfigOptions(result any) any {
	rec, _ := result.(map[string]any)
	if rec == nil {
		return nil
	}
	if opts := nonEmptyConfigOptions(rec["configOptions"]); opts != nil {
		return opts
	}
	meta, _ := rec["_meta"].(map[string]any)
	if meta == nil {
		return nil
	}
	return nonEmptyConfigOptions(meta["configOptions"])
}

// preferConfigOptions keeps the first non-empty option list.
// preferred is the RPC result (authoritative when present). fallback is an
// in-flight config_option_update already applied to the session. An empty
// preferred must not wipe that fallback — session/new answers after the
// notification, and dropping the result used to leave the snapshot empty when
// the notification never arrived.
func preferConfigOptions(preferred, fallback any) any {
	if opts := nonEmptyConfigOptions(preferred); opts != nil {
		return opts
	}
	return nonEmptyConfigOptions(fallback)
}
