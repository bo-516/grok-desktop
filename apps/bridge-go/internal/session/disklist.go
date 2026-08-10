package session

import (
	"encoding/json"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// DiskSessionRow is one session row for desktop catalog merge.
type DiskSessionRow struct {
	ID              string `json:"id"`
	Cwd             string `json:"cwd"`
	Title           string `json:"title"`
	UpdatedAt       string `json:"updatedAt,omitempty"`
	CreatedAt       string `json:"createdAt,omitempty"`
	SessionKind     string `json:"sessionKind,omitempty"`
	ParentSessionID string `json:"parentSessionId,omitempty"`
}

// IsSubagentSessionKind reports whether kind marks a harness-spawned subagent.
func IsSubagentSessionKind(kind string) bool {
	return strings.HasPrefix(kind, "subagent")
}

// ResolveGrokHome returns GROK_HOME or ~/.grok.
func ResolveGrokHome() string {
	if v := strings.TrimSpace(os.Getenv("GROK_HOME")); v != "" {
		return filepath.Clean(v)
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".grok")
}

// DecodeWorkspaceDirName decodes a percent-encoded workspace folder name.
func DecodeWorkspaceDirName(encodedDirName string) string {
	decoded, err := url.PathUnescape(encodedDirName)
	if err != nil {
		// try QueryUnescape as fallback
		decoded, err = url.QueryUnescape(encodedDirName)
		if err != nil {
			return ""
		}
	}
	return decoded
}

// ListSessionsFromDisk walks ~/.grok/sessions and returns catalog rows.
// limit defaults to 500 (max 2000); cwdFilter scopes to one absolute workspace.
func ListSessionsFromDisk(limit int, cwdFilter, grokHome string) ([]DiskSessionRow, error) {
	if limit <= 0 {
		limit = 500
	}
	if limit > 2000 {
		limit = 2000
	}
	if grokHome == "" {
		grokHome = ResolveGrokHome()
	}
	sessionsRoot := filepath.Join(grokHome, "sessions")
	workspaceDirs, err := os.ReadDir(sessionsRoot)
	if err != nil {
		return []DiskSessionRow{}, nil
	}
	filterCwd := strings.TrimRight(cwdFilter, `/\`)
	var rows []DiskSessionRow
	parentByChild := map[string]string{}

	for _, wd := range workspaceDirs {
		if !wd.IsDir() {
			continue
		}
		workspace := DecodeWorkspaceDirName(wd.Name())
		if workspace == "" {
			continue
		}
		if filterCwd != "" && strings.TrimRight(workspace, `/\`) != filterCwd {
			continue
		}
		wsDir := filepath.Join(sessionsRoot, wd.Name())
		sessionEntries, err := os.ReadDir(wsDir)
		if err != nil {
			continue
		}
		for _, se := range sessionEntries {
			if !se.IsDir() {
				continue
			}
			sessionID := se.Name()
			sessionDir := filepath.Join(wsDir, sessionID)
			row, ok := readDiskSessionRow(sessionDir, sessionID, workspace)
			if ok {
				rows = append(rows, row)
			}
			for child, parent := range readSubagentChildIndex(sessionDir, sessionID) {
				parentByChild[child] = parent
			}
		}
	}
	for i := range rows {
		if p, ok := parentByChild[rows[i].ID]; ok {
			rows[i].ParentSessionID = p
		}
	}
	sort.Slice(rows, func(i, j int) bool {
		return parseTime(rows[i].UpdatedAt) > parseTime(rows[j].UpdatedAt)
	})
	if len(rows) > limit {
		rows = rows[:limit]
	}
	return rows, nil
}

func readDiskSessionRow(sessionDir, sessionID, fallbackCwd string) (DiskSessionRow, bool) {
	if sessionID == "" || strings.HasPrefix(sessionID, ".") {
		return DiskSessionRow{}, false
	}
	title := ""
	cwd := fallbackCwd
	var updatedAt, createdAt, sessionKind string

	raw, err := os.ReadFile(filepath.Join(sessionDir, "summary.json"))
	if err == nil {
		var parsed map[string]any
		if json.Unmarshal(raw, &parsed) == nil {
			if info, ok := parsed["info"].(map[string]any); ok {
				if c, ok := info["cwd"].(string); ok && strings.TrimSpace(c) != "" {
					cwd = strings.TrimSpace(c)
				}
			}
			if g, ok := parsed["generated_title"].(string); ok {
				title = strings.TrimSpace(g)
			}
			if title == "" {
				if s, ok := parsed["session_summary"].(string); ok {
					title = strings.TrimSpace(s)
				}
			}
			if u, ok := parsed["updated_at"].(string); ok && u != "" {
				updatedAt = u
			} else if u, ok := parsed["last_active_at"].(string); ok && u != "" {
				updatedAt = u
			}
			if c, ok := parsed["created_at"].(string); ok {
				createdAt = c
			}
			if k, ok := parsed["session_kind"].(string); ok {
				sessionKind = strings.TrimSpace(k)
			}
		}
	}
	if updatedAt == "" {
		st, err := os.Stat(sessionDir)
		if err != nil {
			return DiskSessionRow{}, false
		}
		updatedAt = st.ModTime().UTC().Format(time.RFC3339Nano)
	}
	if title == "" {
		short := sessionID
		if len(short) > 8 {
			short = short[:8]
		}
		title = "Chat " + short
	}
	return DiskSessionRow{
		ID: sessionID, Cwd: firstNonEmpty(cwd, fallbackCwd), Title: title,
		UpdatedAt: updatedAt, CreatedAt: createdAt, SessionKind: sessionKind,
	}, true
}

func readSubagentChildIndex(sessionDir, parentID string) map[string]string {
	index := map[string]string{}
	entries, err := os.ReadDir(filepath.Join(sessionDir, "subagents"))
	if err != nil {
		return index
	}
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		name := e.Name()
		raw, err := os.ReadFile(filepath.Join(sessionDir, "subagents", name, "meta.json"))
		if err != nil {
			index[name] = parentID
			continue
		}
		var meta map[string]any
		if json.Unmarshal(raw, &meta) != nil {
			index[name] = parentID
			continue
		}
		childID := name
		if c, ok := meta["child_session_id"].(string); ok && strings.TrimSpace(c) != "" {
			childID = strings.TrimSpace(c)
		}
		index[childID] = parentID
	}
	return index
}

func parseTime(s string) int64 {
	if s == "" {
		return 0
	}
	t, err := time.Parse(time.RFC3339Nano, s)
	if err != nil {
		t, err = time.Parse(time.RFC3339, s)
		if err != nil {
			return 0
		}
	}
	return t.UnixMilli()
}

func firstNonEmpty(a, b string) string {
	if a != "" {
		return a
	}
	return b
}
