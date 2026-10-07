package acp

// fillModelGaps copies window size, effort ladder, and current effort onto dst
// when dst left them empty. A row that kept totalContextTokens but dropped the
// ladder must not hide those fields — returning early on tokens used to do that.
// Name is filled the same way. Non-empty dst fields are kept; src is never
// allowed to wipe them. Missing src fields leave dst unchanged.
func fillModelGaps(dst, src AvailableModel) AvailableModel {
	if dst.Name == "" && src.Name != "" {
		dst.Name = src.Name
	}
	if dst.TotalContextTokens == 0 && src.TotalContextTokens > 0 {
		dst.TotalContextTokens = src.TotalContextTokens
	}
	if len(dst.ReasoningEfforts) == 0 && len(src.ReasoningEfforts) > 0 {
		dst.ReasoningEfforts = src.ReasoningEfforts
	}
	if dst.ReasoningEffort == "" && src.ReasoningEffort != "" {
		dst.ReasoningEffort = src.ReasoningEffort
	}
	return dst
}

// preferAvailableModels picks the first non-empty catalog (primary, then
// current, then init) and fills TotalContextTokens, ReasoningEfforts, and
// ReasoningEffort from the other lists when a thin session/new|load row
// dropped them. Without the window fill the composer tip stays on
// "No turns yet". Without the effort fill the Thinking menu is empty or
// falls back to the recommended row instead of the agent's current effort.
// primary is session/new|load models (may be empty); current is the in-memory
// snapshot; fromInit is initialize `_meta`. An empty primary does not wipe a
// later non-empty list.
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
	absorb := func(m AvailableModel) {
		prev, ok := byID[m.ID]
		if !ok {
			byID[m.ID] = m
			return
		}
		byID[m.ID] = fillModelGaps(prev, m)
	}
	for _, m := range fromInit {
		absorb(m)
	}
	for _, m := range current {
		absorb(m)
	}
	out := make([]AvailableModel, len(picked))
	copy(out, picked)
	for i := range out {
		other, ok := byID[out[i].ID]
		if !ok {
			continue
		}
		out[i] = fillModelGaps(out[i], other)
	}
	return out
}
