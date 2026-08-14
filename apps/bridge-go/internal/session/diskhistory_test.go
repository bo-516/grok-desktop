package session

import (
	"encoding/json"
	"net/url"
	"os"
	"path/filepath"
	"testing"
)

func writeHistoryFixture(t *testing.T, home, workspace, id string, files map[string]string) string {
	t.Helper()
	dir := filepath.Join(home, "sessions", url.PathEscape(workspace), id)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	for name, body := range files {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o644); err != nil {
			t.Fatalf("write %s: %v", name, err)
		}
	}
	return dir
}

func TestReadSessionHistoryPrefersChatHistory(t *testing.T) {
	home := t.TempDir()
	id := "019fe000-0000-7000-8000-000000000021"
	ws := "/tmp/hist-go"
	writeHistoryFixture(t, home, ws, id, map[string]string{
		"chat_history.jsonl": `{"type":"user","content":"from chat"}` + "\n",
		"updates.jsonl":      `{"method":"session/update","params":{"update":{"sessionUpdate":"agent_message_chunk"}}}` + "\n",
	})

	hist := ReadSessionHistoryFromDisk(id, ws, home, 0)
	if hist.SessionID != id {
		t.Fatalf("sessionId: %q", hist.SessionID)
	}
	if hist.Cwd != ws {
		t.Fatalf("cwd: %q", hist.Cwd)
	}
	if len(hist.ChatHistory) != 1 {
		t.Fatalf("want 1 chat row, got %d", len(hist.ChatHistory))
	}
	if len(hist.Updates) != 0 {
		t.Fatalf("updates should be skipped when chat_history exists, got %d", len(hist.Updates))
	}
}

func TestReadSessionHistoryFallsBackToUpdates(t *testing.T) {
	home := t.TempDir()
	id := "019fe000-0000-7000-8000-000000000022"
	ws := "/tmp/hist-upd"
	line, _ := json.Marshal(map[string]any{
		"method": "session/update",
		"params": map[string]any{
			"update": map[string]any{"sessionUpdate": "user_message_chunk"},
			"_meta":  map[string]any{"eventId": "e9"},
		},
	})
	writeHistoryFixture(t, home, ws, id, map[string]string{
		"updates.jsonl": string(line) + "\n",
	})

	hist := ReadSessionHistoryFromDisk(id, "", home, 0)
	if len(hist.Updates) != 1 {
		t.Fatalf("want 1 update, got %d", len(hist.Updates))
	}
	if hist.Updates[0].EventID != "e9" {
		t.Fatalf("eventId: %q", hist.Updates[0].EventID)
	}
}

func TestReadSessionHistoryMissingIsEmpty(t *testing.T) {
	hist := ReadSessionHistoryFromDisk("nope", "", t.TempDir(), 0)
	if hist.Count != 0 {
		t.Fatalf("want empty, got %+v", hist)
	}
}

func TestParseHistoryLineRejectsNonUpdates(t *testing.T) {
	if ParseHistoryLine(map[string]any{"method": "session/new"}) != nil {
		t.Fatal("session/new must not parse as an update")
	}
}
