package userprompts

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func goldenDir(t *testing.T) string {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	// apps/bridge-go/internal/userprompts → apps/bridge/test/fixtures/prompts-golden
	return filepath.Clean(filepath.Join(filepath.Dir(file), "..", "..", "..", "bridge", "test", "fixtures", "prompts-golden"))
}

func TestSerializeEmptyNull(t *testing.T) {
	body, ok := SerializePrompts(nil)
	if ok || body != "" {
		t.Fatalf("F-01: expected empty→null, got ok=%v body=%q", ok, body)
	}
	body, ok = SerializePrompts([]PromptEntry{})
	if ok || body != "" {
		t.Fatalf("F-01: expected empty slice→null, got ok=%v body=%q", ok, body)
	}
}

func TestSerializeEnabled(t *testing.T) {
	body, ok := SerializePrompts([]PromptEntry{{Id: "x", Text: "Always respond in zh-CN.", Enabled: true}})
	if !ok {
		t.Fatal("F-02: expected body")
	}
	if !containsLine(body, "- Always respond in zh-CN.") {
		t.Fatalf("F-02: missing enabled line:\n%s", body)
	}
}

func TestSerializeDisabled(t *testing.T) {
	body, ok := SerializePrompts([]PromptEntry{{Id: "x", Text: "Prefer concise answers.", Enabled: false}})
	if !ok {
		t.Fatal("F-03: expected body")
	}
	if !containsLine(body, "<!-- grok-desktop:off Prefer concise answers. -->") {
		t.Fatalf("F-03: missing off line:\n%s", body)
	}
}

func TestCategoryRoundTrip(t *testing.T) {
	entries := []PromptEntry{
		{Id: "a", Text: "Always respond in zh-CN.", Enabled: true, Category: CatLanguage},
		{Id: "b", Text: "Prefer concise answers.", Enabled: false, Category: CatStyle},
	}
	body, ok := SerializePrompts(entries)
	if !ok {
		t.Fatal("F-04: serialize")
	}
	parsed := ParsePrompts(body, nil)
	if parsed.Foreign || len(parsed.Entries) != 2 {
		t.Fatalf("F-04: parse %#v", parsed)
	}
	if parsed.Entries[0].Text != entries[0].Text || parsed.Entries[0].Category != CatLanguage || !parsed.Entries[0].Enabled {
		t.Fatalf("F-04: entry0 %#v", parsed.Entries[0])
	}
	if parsed.Entries[1].Text != entries[1].Text || parsed.Entries[1].Category != CatStyle || parsed.Entries[1].Enabled {
		t.Fatalf("F-04: entry1 %#v", parsed.Entries[1])
	}
}

func TestRoundTripOrder(t *testing.T) {
	entries := []PromptEntry{
		{Id: "1", Text: "A", Enabled: true, Category: CatName},
		{Id: "2", Text: "B", Enabled: false},
		{Id: "3", Text: "C", Enabled: true, Category: CatWorkflow},
	}
	body, ok := SerializePrompts(entries)
	if !ok {
		t.Fatal("F-05")
	}
	parsed := ParsePrompts(body, nil)
	if len(parsed.Entries) != 3 {
		t.Fatalf("F-05: len=%d", len(parsed.Entries))
	}
	for i := range entries {
		if parsed.Entries[i].Text != entries[i].Text ||
			parsed.Entries[i].Enabled != entries[i].Enabled ||
			parsed.Entries[i].Category != entries[i].Category {
			t.Fatalf("F-05: idx %d got %#v want %#v", i, parsed.Entries[i], entries[i])
		}
	}
}

func TestTolerantParse(t *testing.T) {
	body := ManagedMarker + "\r\n" +
		ManagedBanner + "\r\n" +
		"\r\n" +
		"- Keep me.  \r\n" +
		"\r\n" +
		"not a valid line\r\n" +
		"<!-- random comment -->\r\n" +
		"- Second.\r\n"
	parsed := ParsePrompts(body, nil)
	if parsed.Foreign || len(parsed.Entries) != 2 {
		t.Fatalf("F-06: %#v", parsed)
	}
	if parsed.Entries[0].Text != "Keep me." || parsed.Entries[1].Text != "Second." {
		t.Fatalf("F-06: texts %#v", parsed.Entries)
	}
}

func TestGoldenBytes(t *testing.T) {
	dir := goldenDir(t)
	basicEntries := []PromptEntry{
		{Id: "a", Text: "Always respond in zh-CN.", Enabled: true, Category: CatLanguage},
		{Id: "b", Text: "My name is Jack.", Enabled: true, Category: CatName},
		{Id: "c", Text: "Prefer concise answers.", Enabled: false, Category: CatStyle},
	}
	basic, ok := SerializePrompts(basicEntries)
	if !ok {
		t.Fatal("F-07 basic serialize")
	}
	goldenBasic, err := os.ReadFile(filepath.Join(dir, "basic.md"))
	if err != nil {
		t.Fatal(err)
	}
	if basic != string(goldenBasic) {
		t.Fatalf("F-07 basic mismatch\n--- got ---\n%s\n--- want ---\n%s", basic, goldenBasic)
	}

	mixedEntries := []PromptEntry{
		{Id: "a", Text: "Run lint before commit.", Enabled: true, Category: CatWorkflow},
		{Id: "b", Text: "Prefer small pure functions.", Enabled: true},
		{Id: "c", Text: "Do not use emoji.", Enabled: false},
	}
	mixed, ok := SerializePrompts(mixedEntries)
	if !ok {
		t.Fatal("F-07 mixed serialize")
	}
	goldenMixed, err := os.ReadFile(filepath.Join(dir, "mixed.md"))
	if err != nil {
		t.Fatal(err)
	}
	if mixed != string(goldenMixed) {
		t.Fatalf("F-07 mixed mismatch\n--- got ---\n%s\n--- want ---\n%s", mixed, goldenMixed)
	}
}

func TestForeignParse(t *testing.T) {
	parsed := ParsePrompts("# hand written\n- do not touch\n", nil)
	if !parsed.Foreign || len(parsed.Entries) != 0 {
		t.Fatalf("F-08: %#v", parsed)
	}
}

func containsLine(body, line string) bool {
	for _, l := range splitLines(body) {
		if l == line {
			return true
		}
	}
	return false
}
