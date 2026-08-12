// Package userprompts implements managed user-prompt markdown serialize/parse
// and on-disk store for the three scopes (global / project / projectLocal).
// Format contract matches apps/bridge/src/userPromptsFormat.ts byte-for-byte
// (shared golden fixtures under apps/bridge/test/fixtures/prompts-golden/).
package userprompts

import (
	"fmt"
	"regexp"
	"strings"
	"unicode"
)

// PromptScope is which layer a prompt entry lives in; selects the on-disk file.
type PromptScope string

const (
	ScopeGlobal       PromptScope = "global"
	ScopeProject      PromptScope = "project"
	ScopeProjectLocal PromptScope = "projectLocal"
)

// PromptCategory is an optional UI bucket for override badges.
type PromptCategory string

const (
	CatLanguage PromptCategory = "language"
	CatName     PromptCategory = "name"
	CatStyle    PromptCategory = "style"
	CatWorkflow PromptCategory = "workflow"
	CatCustom   PromptCategory = "custom"
)

// PromptEntry is one user-authored instruction line (Id is client-only).
type PromptEntry struct {
	// Id is client-side identity; NOT written to disk.
	Id string `json:"id"`
	// Text is the single-line instruction, already normalized.
	Text string `json:"text"`
	// Enabled false keeps the entry in-file as a comment.
	Enabled bool `json:"enabled"`
	// Category is optional; omit when unset.
	Category PromptCategory `json:"category,omitempty"`
}

// ManagedMarker is the first line of every managed file — ownership gate.
const ManagedMarker = "<!-- grok-desktop:managed v1 -->"

// ManagedBanner is the fixed second line for humans who open the file.
const ManagedBanner = "<!-- Edited in the grok-desktop app. Manual edits are overwritten. -->"

// EntryTextMax is the max characters per entry after normalization.
const EntryTextMax = 2000

var validCategories = map[string]bool{
	"language": true,
	"name":     true,
	"style":    true,
	"workflow": true,
	"custom":   true,
}

// NormalizeEntryText trims, collapses whitespace, strips controls, validates.
// Returns the normalized text or an error reason matching the Node bridge.
func NormalizeEntryText(raw string) (string, error) {
	text := raw
	// Collapse newlines / CR / tabs to a single space.
	var b strings.Builder
	b.Grow(len(text))
	prevSpace := false
	for _, r := range text {
		if r == '\r' || r == '\n' || r == '\t' {
			if !prevSpace {
				b.WriteByte(' ')
				prevSpace = true
			}
			continue
		}
		if r < 0x20 {
			// strip other control characters
			continue
		}
		if r == ' ' {
			if !prevSpace {
				b.WriteByte(' ')
				prevSpace = true
			}
			continue
		}
		prevSpace = false
		b.WriteRune(r)
	}
	text = strings.TrimSpace(b.String())
	// Collapse remaining double spaces from mixed paths.
	for strings.Contains(text, "  ") {
		text = strings.ReplaceAll(text, "  ", " ")
	}
	if text == "" {
		return "", fmt.Errorf("entry text is empty")
	}
	if strings.Contains(text, "-->") {
		return "", fmt.Errorf("entry text must not contain \"-->\"")
	}
	if len([]rune(text)) > EntryTextMax {
		return "", fmt.Errorf("entry text exceeds %d characters", EntryTextMax)
	}
	return text, nil
}

// SerializePrompts writes managed markdown, or returns ("", false) when empty
// so the caller unlinks (empty files are still loaded by grok — F4).
func SerializePrompts(entries []PromptEntry) (string, bool) {
	if len(entries) == 0 {
		return "", false
	}
	var lines []string
	lines = append(lines, ManagedMarker, ManagedBanner, "")
	for _, e := range entries {
		cat := ""
		if e.Category != "" && validCategories[string(e.Category)] {
			cat = string(e.Category)
		}
		if e.Enabled {
			if cat != "" {
				lines = append(lines, fmt.Sprintf("- %s <!--@%s-->", e.Text, cat))
			} else {
				lines = append(lines, fmt.Sprintf("- %s", e.Text))
			}
		} else if cat != "" {
			lines = append(lines, fmt.Sprintf("<!-- grok-desktop:off @%s %s -->", cat, e.Text))
		} else {
			lines = append(lines, fmt.Sprintf("<!-- grok-desktop:off %s -->", e.Text))
		}
	}
	return strings.Join(lines, "\n") + "\n", true
}

// ParsePromptsResult is the outcome of ParsePrompts.
type ParsePromptsResult struct {
	// Foreign is true when the file lacks the managed marker.
	Foreign bool
	// Entries are recognized lines; empty when foreign.
	Entries []PromptEntry
}

// ParsePrompts parses managed markdown. Unknown lines are ignored.
// idFactory may be nil; then sequential e0, e1, … ids are assigned.
func ParsePrompts(content string, idFactory func() string) ParsePromptsResult {
	lines := splitLines(content)
	first := ""
	if len(lines) > 0 {
		first = strings.TrimSpace(lines[0])
	}
	if first != ManagedMarker {
		return ParsePromptsResult{Foreign: true, Entries: nil}
	}

	nextID := 0
	makeID := idFactory
	if makeID == nil {
		makeID = func() string {
			id := fmt.Sprintf("e%d", nextID)
			nextID++
			return id
		}
	}

	var entries []PromptEntry
	for i := 1; i < len(lines); i++ {
		trimmed := strings.TrimSpace(lines[i])
		if trimmed == "" || trimmed == ManagedBanner {
			continue
		}
		if off, ok := parseOffLine(trimmed); ok {
			e := PromptEntry{Id: makeID(), Text: off.text, Enabled: false}
			if off.category != "" {
				e.Category = PromptCategory(off.category)
			}
			entries = append(entries, e)
			continue
		}
		if on, ok := parseEnabledLine(trimmed); ok {
			e := PromptEntry{Id: makeID(), Text: on.text, Enabled: true}
			if on.category != "" {
				e.Category = PromptCategory(on.category)
			}
			entries = append(entries, e)
		}
	}
	if entries == nil {
		entries = []PromptEntry{}
	}
	return ParsePromptsResult{Foreign: false, Entries: entries}
}

type parsedLine struct {
	text     string
	category string
}

var enabledCatRe = regexp.MustCompile(`^(.*?)\s*<!--@([a-zA-Z0-9_]+)-->\s*$`)
var offRe = regexp.MustCompile(`^<!--\s*grok-desktop:off\s+(.+?)\s*-->$`)
var offCatRe = regexp.MustCompile(`^@([a-zA-Z0-9_]+)\s+(.+)$`)

func parseEnabledLine(trimmed string) (parsedLine, bool) {
	if !strings.HasPrefix(trimmed, "- ") {
		return parsedLine{}, false
	}
	body := strings.TrimRightFunc(trimmed[2:], unicode.IsSpace)
	if m := enabledCatRe.FindStringSubmatch(body); m != nil {
		text := strings.TrimSpace(m[1])
		cat := m[2]
		if text == "" || strings.Contains(text, "-->") {
			return parsedLine{}, false
		}
		if validCategories[cat] {
			return parsedLine{text: text, category: cat}, true
		}
		return parsedLine{text: text}, true
	}
	text := strings.TrimSpace(body)
	if text == "" || strings.Contains(text, "-->") {
		return parsedLine{}, false
	}
	return parsedLine{text: text}, true
}

func parseOffLine(trimmed string) (parsedLine, bool) {
	m := offRe.FindStringSubmatch(trimmed)
	if m == nil {
		return parsedLine{}, false
	}
	rest := strings.TrimSpace(m[1])
	if rest == "" {
		return parsedLine{}, false
	}
	if cm := offCatRe.FindStringSubmatch(rest); cm != nil {
		cat := cm[1]
		text := strings.TrimSpace(cm[2])
		if text == "" || strings.Contains(text, "-->") {
			return parsedLine{}, false
		}
		if validCategories[cat] {
			return parsedLine{text: text, category: cat}, true
		}
		return parsedLine{text: text}, true
	}
	if strings.Contains(rest, "-->") {
		return parsedLine{}, false
	}
	return parsedLine{text: rest}, true
}

func splitLines(s string) []string {
	s = strings.ReplaceAll(s, "\r\n", "\n")
	s = strings.ReplaceAll(s, "\r", "\n")
	return strings.Split(s, "\n")
}
