package session

import (
	"bufio"
	"encoding/json"
	"net/url"
	"os"
	"path/filepath"
	"strings"
)

// SessionHistoryMaxBytes caps one history file. Larger files are skipped so
// the CLI channel is not blocked by a multi-tens-of-MB parse; session/load
// still fills the canvas afterwards.
const SessionHistoryMaxBytes = 32 * 1024 * 1024

// DiskHistoryUpdate is one ACP update extracted from updates.jsonl.
type DiskHistoryUpdate struct {
	Update  map[string]any `json:"update"`
	EventID string         `json:"eventId,omitempty"`
}

// DiskSessionHistory is the on-disk transcript for one session.
// ChatHistory is preferred (complete turns). Updates is the ACP log and is
// often missing older user echoes — only filled when chat history is empty.
type DiskSessionHistory struct {
	SessionID   string              `json:"sessionId"`
	Cwd         string              `json:"cwd,omitempty"`
	ChatHistory []any               `json:"chatHistory"`
	Updates     []DiskHistoryUpdate `json:"updates"`
	Count       int                 `json:"count"`
	Bytes       int                 `json:"bytes"`
}

// EncodeWorkspaceDirName percent-encodes a workspace the way grok-build names
// session folders (encodeURIComponent / PathEscape).
func EncodeWorkspaceDirName(workspace string) string {
	return url.PathEscape(workspace)
}

// FindSessionDir locates ~/.grok/sessions/<ws>/<sessionId>.
// cwd is an optional catalog hint; a walk covers encoding mismatches.
// Missing folders return "" (not an error) so the desktop can fall through
// to session/load.
func FindSessionDir(sessionID, cwd, grokHome string) string {
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" || strings.HasPrefix(sessionID, ".") {
		return ""
	}
	if grokHome == "" {
		grokHome = ResolveGrokHome()
	}
	sessionsRoot := filepath.Join(grokHome, "sessions")
	cwd = strings.TrimSpace(cwd)
	if cwd != "" {
		for _, enc := range []string{
			url.PathEscape(cwd),
			url.QueryEscape(cwd),
		} {
			candidate := filepath.Join(sessionsRoot, enc, sessionID)
			if isDir(candidate) {
				return candidate
			}
		}
	}
	entries, err := os.ReadDir(sessionsRoot)
	if err != nil {
		return ""
	}
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		candidate := filepath.Join(sessionsRoot, e.Name(), sessionID)
		if isDir(candidate) {
			return candidate
		}
	}
	return ""
}

// ReadSessionHistoryFromDisk reads chat_history.jsonl (preferred) and, when
// that file is empty/missing, updates.jsonl. Missing / oversized files yield
// empty slices — the caller must not treat that as a hard error.
func ReadSessionHistoryFromDisk(sessionID, cwd, grokHome string, maxBytes int) DiskSessionHistory {
	sessionID = strings.TrimSpace(sessionID)
	out := DiskSessionHistory{
		SessionID:   sessionID,
		Cwd:         strings.TrimSpace(cwd),
		ChatHistory: []any{},
		Updates:     []DiskHistoryUpdate{},
	}
	if sessionID == "" {
		return out
	}
	if maxBytes <= 0 {
		maxBytes = SessionHistoryMaxBytes
	}
	sessionDir := FindSessionDir(sessionID, cwd, grokHome)
	if sessionDir == "" {
		return out
	}
	decoded := DecodeWorkspaceDirName(filepath.Base(filepath.Dir(sessionDir)))
	if decoded != "" {
		out.Cwd = decoded
	}
	chatRecs, chatBytes := readJSONLFile(filepath.Join(sessionDir, "chat_history.jsonl"), maxBytes)
	out.ChatHistory = chatRecs
	out.Bytes += chatBytes
	if len(chatRecs) == 0 {
		updRecs, updBytes := readJSONLFile(filepath.Join(sessionDir, "updates.jsonl"), maxBytes)
		out.Bytes += updBytes
		for _, rec := range updRecs {
			if item := ParseHistoryLine(rec); item != nil {
				out.Updates = append(out.Updates, *item)
			}
		}
	}
	if out.ChatHistory == nil {
		out.ChatHistory = []any{}
	}
	if out.Updates == nil {
		out.Updates = []DiskHistoryUpdate{}
	}
	out.Count = len(out.ChatHistory) + len(out.Updates)
	return out
}

// ParseHistoryLine pulls an ACP update out of one updates.jsonl object.
// Accepts session/update, _x.ai/session/update, or a bare {sessionUpdate}.
func ParseHistoryLine(raw any) *DiskHistoryUpdate {
	rec, ok := raw.(map[string]any)
	if !ok {
		return nil
	}
	params := rec
	if p, ok := rec["params"].(map[string]any); ok {
		params = p
	}
	var update map[string]any
	if u, ok := params["update"].(map[string]any); ok {
		update = u
	} else if _, ok := rec["sessionUpdate"]; ok {
		update = rec
	}
	if update == nil {
		return nil
	}
	if _, ok := update["sessionUpdate"].(string); !ok {
		return nil
	}
	eventID := ""
	if meta, ok := params["_meta"].(map[string]any); ok {
		if s, ok := meta["eventId"].(string); ok {
			eventID = strings.TrimSpace(s)
		}
	} else if meta, ok := rec["_meta"].(map[string]any); ok {
		if s, ok := meta["eventId"].(string); ok {
			eventID = strings.TrimSpace(s)
		}
	}
	return &DiskHistoryUpdate{Update: update, EventID: eventID}
}

func readJSONLFile(filePath string, maxBytes int) ([]any, int) {
	st, err := os.Stat(filePath)
	if err != nil || st.Size() <= 0 || st.Size() > int64(maxBytes) {
		return []any{}, 0
	}
	f, err := os.Open(filePath)
	if err != nil {
		return []any{}, 0
	}
	defer f.Close()
	records := []any{}
	scanner := bufio.NewScanner(f)
	// Default 64K is too small for a single tool_result line.
	buf := make([]byte, 0, 1024*1024)
	scanner.Buffer(buf, maxBytes)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var rec any
		if json.Unmarshal([]byte(line), &rec) != nil {
			continue
		}
		records = append(records, rec)
	}
	return records, int(st.Size())
}

func isDir(p string) bool {
	st, err := os.Stat(p)
	return err == nil && st.IsDir()
}
