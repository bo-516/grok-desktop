package userprompts

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// ReadScopeState loads one scope file (missing → empty non-foreign state).
func ReadScopeState(scope PromptScope, filePath string) (PromptScopeState, error) {
	st := PromptScopeState{
		Scope:   scope,
		Path:    filePath,
		Exists:  false,
		Foreign: false,
		Entries: []PromptEntry{},
		Bytes:   0,
	}
	info, err := os.Stat(filePath)
	if err != nil {
		if os.IsNotExist(err) {
			return st, nil
		}
		return st, fmt.Errorf("failed to stat %s: %w", filePath, err)
	}
	st.Exists = true
	st.Bytes = int(info.Size())
	raw, err := os.ReadFile(filePath)
	if err != nil {
		return st, fmt.Errorf("failed to read %s: %w", filePath, err)
	}
	st.Bytes = len(raw)
	parsed := ParsePrompts(string(raw), nil)
	if parsed.Foreign {
		st.Foreign = true
		st.Entries = []PromptEntry{}
		return st, nil
	}
	st.Entries = parsed.Entries
	return st, nil
}

// PromptsGet loads the three-scope snapshot.
func PromptsGet(cwd string) (PromptsSnapshot, error) {
	if cwd == "" {
		cwd, _ = os.Getwd()
	}
	grokHome := ResolveGrokHome()
	projectRoot, gitRepo := ResolveProjectRoot(cwd)
	localExcluded := false
	if gitRepo {
		localExcluded = IsLocalExcluded(projectRoot)
	}
	g, err := ReadScopeState(ScopeGlobal, ScopePath(ScopeGlobal, grokHome, projectRoot))
	if err != nil {
		return PromptsSnapshot{}, err
	}
	p, err := ReadScopeState(ScopeProject, ScopePath(ScopeProject, grokHome, projectRoot))
	if err != nil {
		return PromptsSnapshot{}, err
	}
	pl, err := ReadScopeState(ScopeProjectLocal, ScopePath(ScopeProjectLocal, grokHome, projectRoot))
	if err != nil {
		return PromptsSnapshot{}, err
	}
	pr := projectRoot
	return PromptsSnapshot{
		ProjectRoot:   &pr,
		GitRepo:       gitRepo,
		LocalExcluded: localExcluded,
		Global:        g,
		Project:       p,
		ProjectLocal:  pl,
	}, nil
}

// PromptsSet full-list writes one scope; empty entries unlink.
func PromptsSet(scope PromptScope, entries []PromptEntry, cwd string) (PromptWriteResult, error) {
	if err := assertScope(scope); err != nil {
		return PromptWriteResult{}, err
	}
	normalized, err := normalizeEntries(entries)
	if err != nil {
		return PromptWriteResult{}, err
	}
	if cwd == "" {
		cwd, _ = os.Getwd()
	}
	grokHome := ResolveGrokHome()
	projectRoot, gitRepo := ResolveProjectRoot(cwd)
	filePath := ScopePath(scope, grokHome, projectRoot)

	if scope == ScopeProjectLocal && gitRepo {
		EnsureLocalExclude(projectRoot)
	}

	if len(normalized) == 0 {
		return PromptsClear(scope, cwd)
	}
	body, ok := SerializePrompts(normalized)
	if !ok {
		return PromptsClear(scope, cwd)
	}
	if err := assertManagedOrAbsent(filePath); err != nil {
		return PromptWriteResult{}, err
	}
	if err := AtomicWrite(filePath, []byte(body)); err != nil {
		return PromptWriteResult{}, err
	}
	return PromptWriteResult{
		Scope:   scope,
		Path:    filePath,
		Bytes:   len(body),
		Removed: false,
	}, nil
}

// PromptsClear unlinks the managed file (idempotent when absent).
func PromptsClear(scope PromptScope, cwd string) (PromptWriteResult, error) {
	if err := assertScope(scope); err != nil {
		return PromptWriteResult{}, err
	}
	if cwd == "" {
		cwd, _ = os.Getwd()
	}
	grokHome := ResolveGrokHome()
	projectRoot, _ := ResolveProjectRoot(cwd)
	filePath := ScopePath(scope, grokHome, projectRoot)

	if _, err := os.Stat(filePath); err != nil {
		if os.IsNotExist(err) {
			return PromptWriteResult{Scope: scope, Path: filePath, Bytes: 0, Removed: false}, nil
		}
		return PromptWriteResult{}, err
	}
	if err := assertManagedOrAbsent(filePath); err != nil {
		return PromptWriteResult{}, err
	}
	if err := os.Remove(filePath); err != nil {
		return PromptWriteResult{}, fmt.Errorf("failed to remove %s: %w", filePath, err)
	}
	return PromptWriteResult{Scope: scope, Path: filePath, Bytes: 0, Removed: true}, nil
}

// MoveResult is the dual write result for prompts_move.
type MoveResult struct {
	From PromptWriteResult `json:"from"`
	To   PromptWriteResult `json:"to"`
}

// PromptsMove atomically moves one entry by index from → to.
// Writes destination first; rolls back on source failure.
func PromptsMove(from, to PromptScope, entryIndex int, cwd string) (MoveResult, error) {
	if err := assertScope(from); err != nil {
		return MoveResult{}, err
	}
	if err := assertScope(to); err != nil {
		return MoveResult{}, err
	}
	if from == to {
		return MoveResult{}, fmt.Errorf("prompts_move: from and to scopes must differ")
	}
	if cwd == "" {
		cwd, _ = os.Getwd()
	}
	grokHome := ResolveGrokHome()
	projectRoot, gitRepo := ResolveProjectRoot(cwd)
	fromPath := ScopePath(from, grokHome, projectRoot)
	toPath := ScopePath(to, grokHome, projectRoot)

	fromState, err := ReadScopeState(from, fromPath)
	if err != nil {
		return MoveResult{}, err
	}
	toState, err := ReadScopeState(to, toPath)
	if err != nil {
		return MoveResult{}, err
	}
	if fromState.Foreign {
		return MoveResult{}, foreignError(fromPath)
	}
	if toState.Foreign {
		return MoveResult{}, foreignError(toPath)
	}
	if entryIndex < 0 || entryIndex >= len(fromState.Entries) {
		return MoveResult{}, fmt.Errorf("prompts_move: entryIndex %d out of range", entryIndex)
	}

	entry := fromState.Entries[entryIndex]
	nextFrom := make([]PromptEntry, 0, len(fromState.Entries)-1)
	for i, e := range fromState.Entries {
		if i != entryIndex {
			nextFrom = append(nextFrom, e)
		}
	}
	nextTo := append(append([]PromptEntry{}, toState.Entries...), entry)

	var toOriginal []byte
	toExisted := toState.Exists
	if toExisted {
		toOriginal, err = os.ReadFile(toPath)
		if err != nil {
			return MoveResult{}, err
		}
	}

	if to == ScopeProjectLocal && gitRepo {
		EnsureLocalExclude(projectRoot)
	}

	toBody, ok := SerializePrompts(nextTo)
	if !ok {
		return MoveResult{}, fmt.Errorf("prompts_move: unexpected empty destination serialize")
	}
	if err := AtomicWrite(toPath, []byte(toBody)); err != nil {
		return MoveResult{}, err
	}

	rollbackTo := func() {
		if !toExisted {
			_ = os.Remove(toPath)
			return
		}
		_ = AtomicWrite(toPath, toOriginal)
	}

	if len(nextFrom) == 0 {
		if _, err := os.Stat(fromPath); err == nil {
			if err := assertManagedOrAbsent(fromPath); err != nil {
				rollbackTo()
				return MoveResult{}, err
			}
			if err := os.Remove(fromPath); err != nil {
				rollbackTo()
				return MoveResult{}, err
			}
		}
	} else {
		fromBody, ok := SerializePrompts(nextFrom)
		if !ok {
			rollbackTo()
			return MoveResult{}, fmt.Errorf("prompts_move: unexpected empty source serialize")
		}
		if err := AtomicWrite(fromPath, []byte(fromBody)); err != nil {
			rollbackTo()
			return MoveResult{}, err
		}
	}

	fromRemoved := len(nextFrom) == 0
	fromBytes := 0
	if !fromRemoved {
		if b, ok := SerializePrompts(nextFrom); ok {
			fromBytes = len(b)
		}
	}
	return MoveResult{
		From: PromptWriteResult{
			Scope:   from,
			Path:    fromPath,
			Bytes:   fromBytes,
			Removed: fromRemoved && fromState.Exists,
		},
		To: PromptWriteResult{
			Scope:   to,
			Path:    toPath,
			Bytes:   len(toBody),
			Removed: false,
		},
	}, nil
}

// AtomicWrite writes body via same-dir tmp → fsync → rename; mode 0600; dirs 0700.
func AtomicWrite(filePath string, body []byte) error {
	dir := filepath.Dir(filePath)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("failed to create dir %s: %w", dir, err)
	}
	_ = os.Chmod(dir, 0o700)
	// Parent .grok when applicable.
	parent := filepath.Dir(dir)
	if filepath.Base(dir) == "rules" && filepath.Base(parent) == ".grok" {
		_ = os.Chmod(parent, 0o700)
	}

	tmp := filepath.Join(dir, fmt.Sprintf("%s.%d.%d.tmp", filepath.Base(filePath), os.Getpid(), time.Now().UnixNano()))
	f, err := os.OpenFile(tmp, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return fmt.Errorf("failed to write %s: %w", filePath, err)
	}
	if _, err := f.Write(body); err != nil {
		f.Close()
		_ = os.Remove(tmp)
		return fmt.Errorf("failed to write %s: %w", filePath, err)
	}
	if err := f.Sync(); err != nil {
		f.Close()
		_ = os.Remove(tmp)
		return fmt.Errorf("failed to write %s: %w", filePath, err)
	}
	if err := f.Close(); err != nil {
		_ = os.Remove(tmp)
		return fmt.Errorf("failed to write %s: %w", filePath, err)
	}
	_ = os.Chmod(tmp, 0o600)
	if err := os.Rename(tmp, filePath); err != nil {
		_ = os.Remove(tmp)
		return fmt.Errorf("failed to write %s: %w", filePath, err)
	}
	_ = os.Chmod(filePath, 0o600)
	return nil
}

func assertManagedOrAbsent(filePath string) error {
	raw, err := os.ReadFile(filePath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return fmt.Errorf("failed to read %s: %w", filePath, err)
	}
	lines := splitLines(string(raw))
	first := ""
	if len(lines) > 0 {
		first = strings.TrimSpace(lines[0])
	}
	if first != ManagedMarker {
		return foreignError(filePath)
	}
	return nil
}

func foreignError(filePath string) error {
	return fmt.Errorf("`%s` exists but was not written by grok-desktop — open it manually or rename it.", displayPath(filePath))
}

func displayPath(filePath string) string {
	home, err := os.UserHomeDir()
	if err == nil && home != "" && strings.HasPrefix(filePath, home) {
		return "~" + filePath[len(home):]
	}
	return filePath
}

func normalizeEntries(entries []PromptEntry) ([]PromptEntry, error) {
	out := make([]PromptEntry, 0, len(entries))
	for i, e := range entries {
		text, err := NormalizeEntryText(e.Text)
		if err != nil {
			return nil, err
		}
		id := e.Id
		if id == "" {
			id = fmt.Sprintf("e%d", i)
		}
		ne := PromptEntry{
			Id:      id,
			Text:    text,
			Enabled: e.Enabled,
		}
		// Default enabled when zero-value from JSON missing field is false —
		// callers should set Enabled explicitly. Coerce: treat missing as true
		// only when Text was present; here we keep the Go zero as-is unless
		// the JSON unmarshaller set it. Dispatch layer sets Enabled true.
		if e.Category != "" && validCategories[string(e.Category)] {
			ne.Category = e.Category
		}
		out = append(out, ne)
	}
	return out, nil
}

func assertScope(scope PromptScope) error {
	switch scope {
	case ScopeGlobal, ScopeProject, ScopeProjectLocal:
		return nil
	default:
		return fmt.Errorf("unknown prompt scope: %s", scope)
	}
}
