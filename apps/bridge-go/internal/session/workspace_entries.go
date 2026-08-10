package session

import (
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"unicode"
)

// WorkspaceEntry is an @mention completion candidate.
type WorkspaceEntry struct {
	Path    string `json:"path"`
	Kind    string `json:"kind"` // file | directory
	Ignored *bool  `json:"ignored,omitempty"`
}

var generatedDirectoryNames = map[string]bool{
	".git": true, ".next": true, ".turbo": true, ".cache": true,
	"node_modules": true, "dist": true, "build": true, "coverage": true,
}

const (
	defaultMaxDepth    = 8
	defaultMaxEntries  = 400
	defaultMaxScanned  = 20000
)

// ListWorkspaceEntries walks workspace for @ completion matches.
// workspace: absolute cwd; query: lowercased path fragment (empty = first batch).
func ListWorkspaceEntries(workspace, query string) ([]WorkspaceEntry, error) {
	root, err := filepath.Abs(workspace)
	if err != nil {
		return nil, err
	}
	normalizedQuery := strings.ToLower(strings.TrimSpace(query))
	type scored struct {
		entry WorkspaceEntry
		score int
	}
	var matches []scored
	scanned := 0

	var walk func(abs, rel string, depth int)
	walk = func(abs, rel string, depth int) {
		entries, err := os.ReadDir(abs)
		if err != nil {
			return
		}
		sort.Slice(entries, func(i, j int) bool {
			return entries[i].Name() < entries[j].Name()
		})
		for _, child := range entries {
			if scanned >= defaultMaxScanned {
				return
			}
			if normalizedQuery == "" && len(matches) >= defaultMaxEntries {
				return
			}
			scanned++
			name := child.Name()
			childPath := name
			if rel != "" {
				childPath = rel + "/" + name
			}
			if strings.HasPrefix(name, ".") {
				continue
			}
			// Skip symlinks
			info, err := child.Info()
			if err != nil {
				continue
			}
			if info.Mode()&fs.ModeSymlink != 0 {
				continue
			}
			childAbs := filepath.Join(abs, name)
			if child.IsDir() {
				if generatedDirectoryNames[name] {
					continue
				}
				score := scoreWorkspaceEntry(childPath, "directory", normalizedQuery)
				if score < 1<<30 {
					matches = append(matches, scored{
						entry: WorkspaceEntry{Path: childPath, Kind: "directory"},
						score: score,
					})
				}
				if depth < defaultMaxDepth {
					walk(childAbs, childPath, depth+1)
				}
				continue
			}
			if child.Type().IsRegular() || info.Mode().IsRegular() {
				score := scoreWorkspaceEntry(childPath, "file", normalizedQuery)
				if score < 1<<30 {
					matches = append(matches, scored{
						entry: WorkspaceEntry{Path: childPath, Kind: "file"},
						score: score,
					})
				}
			}
		}
	}
	walk(root, "", 0)

	sort.Slice(matches, func(i, j int) bool {
		if matches[i].score != matches[j].score {
			return matches[i].score < matches[j].score
		}
		return matches[i].entry.Path < matches[j].entry.Path
	})
	if len(matches) > defaultMaxEntries {
		matches = matches[:defaultMaxEntries]
	}
	out := make([]WorkspaceEntry, len(matches))
	for i, m := range matches {
		out[i] = m.entry
	}
	return annotateIgnoredFlags(root, out), nil
}

func scoreWorkspaceEntry(path, kind, query string) int {
	_ = kind
	normalizedPath := strings.ToLower(path)
	parts := strings.Split(normalizedPath, "/")
	normalizedName := normalizedPath
	if len(parts) > 0 {
		normalizedName = parts[len(parts)-1]
	}
	if query == "" {
		return 3
	}
	if strings.HasPrefix(normalizedName, query) {
		return 0
	}
	if strings.HasPrefix(normalizedPath, query) {
		return 1
	}
	if strings.Contains(normalizedPath, query) {
		return 2
	}
	return 1 << 30
}

func annotateIgnoredFlags(workspaceAbs string, entries []WorkspaceEntry) []WorkspaceEntry {
	if len(entries) == 0 {
		return entries
	}
	paths := make([]string, len(entries))
	for i, e := range entries {
		paths[i] = e.Path
	}
	ignored, ok := runGitCheckIgnore(workspaceAbs, paths)
	if !ok {
		// Unknown: strip ignored fields
		out := make([]WorkspaceEntry, len(entries))
		for i, e := range entries {
			out[i] = WorkspaceEntry{Path: e.Path, Kind: e.Kind}
		}
		return out
	}
	out := make([]WorkspaceEntry, len(entries))
	for i, e := range entries {
		v := ignored[e.Path]
		out[i] = WorkspaceEntry{Path: e.Path, Kind: e.Kind, Ignored: &v}
		// set true/false explicitly
		if !v {
			f := false
			out[i].Ignored = &f
		} else {
			t := true
			out[i].Ignored = &t
		}
	}
	return out
}

func runGitCheckIgnore(workspaceAbs string, paths []string) (map[string]bool, bool) {
	cmd := exec.Command("git", "check-ignore", "--stdin", "-z", "--no-index")
	cmd.Dir = workspaceAbs
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, false
	}
	var stdout strings.Builder
	cmd.Stdout = &stdout
	if err := cmd.Start(); err != nil {
		return nil, false
	}
	payload := strings.Join(paths, "\x00") + "\x00"
	_, _ = stdin.Write([]byte(payload))
	_ = stdin.Close()
	err = cmd.Wait()
	// exit 0 = some ignored, 1 = none, other = unknown
	if err != nil {
		if ee, ok := err.(*exec.ExitError); ok {
			if ee.ExitCode() != 1 {
				return nil, false
			}
		} else {
			return nil, false
		}
	}
	set := map[string]bool{}
	for _, p := range strings.Split(stdout.String(), "\x00") {
		p = strings.TrimSpace(p)
		if p != "" {
			set[p] = true
		}
	}
	// Also ensure non-ignored are false
	out := map[string]bool{}
	for _, p := range paths {
		out[p] = set[p]
	}
	return out, true
}

// lowerFold is unused helper kept for future locale-aware ranking.
func lowerFold(s string) string {
	return strings.Map(unicode.ToLower, s)
}
