package rewind

import (
	"bufio"
	"encoding/json"
	"errors"
	"io"
	"os"
)

// CheckpointFile is grok-build's per-session rewind checkpoint log.
const CheckpointFile = "rewind_points.jsonl"

// checkpointRow is the part of one rewind_points.jsonl line the shim needs.
// Each line is one prompt: file_snapshots holds the pre-edit content of every
// file the prompt's edit tools touched (content null = file did not exist).
type checkpointRow struct {
	// PromptIndex is the prompt ordinal the snapshots belong to.
	PromptIndex *int `json:"prompt_index"`
	// FileSnapshots maps the reported path to its pre-edit snapshot.
	FileSnapshots map[string]struct {
		// Content is the pre-edit text; JSON null when the file was absent.
		Content json.RawMessage `json:"content"`
	} `json:"file_snapshots"`
}

// AbsentAtTarget lists the paths that did not exist right before prompt
// target, judged by the earliest snapshot at or after target for each path
// (that snapshot is the file's state when the rewound span first touched it).
// Malformed lines are skipped; a later line for the same prompt replaces an
// earlier one. A missing file yields an empty set and no error.
// @param path Absolute path of rewind_points.jsonl.
// @param target Rewind boundary (prompt ordinal).
// @returns Normalized path set, or the read error.
func AbsentAtTarget(path string, target int) (map[string]bool, error) {
	out := map[string]bool{}
	f, err := os.Open(path)
	if errors.Is(err, os.ErrNotExist) {
		return out, nil
	}
	if err != nil {
		return nil, err
	}
	defer f.Close()
	rows, err := readCheckpointRows(f, target)
	if err != nil {
		return nil, err
	}
	// earliest[path] = prompt index of the first snapshot at/after target.
	earliest := map[string]int{}
	for idx, snaps := range rows {
		for p, snap := range snaps {
			key := normalizeKey(p)
			if prev, seen := earliest[key]; seen && prev <= idx {
				continue
			}
			earliest[key] = idx
			out[key] = isNullContent(snap)
		}
	}
	for k, absent := range out {
		if !absent {
			delete(out, k)
		}
	}
	return out, nil
}

// readCheckpointRows decodes every line with prompt_index ≥ target.
// @param r Checkpoint log reader.
// @param target Lowest prompt index to keep.
// @returns prompt index → (path → raw content), last line per prompt wins.
func readCheckpointRows(r io.Reader, target int) (map[int]map[string]json.RawMessage, error) {
	rows := map[int]map[string]json.RawMessage{}
	br := bufio.NewReader(r)
	for {
		line, err := br.ReadBytes('\n')
		if len(line) > 0 {
			var row checkpointRow
			if json.Unmarshal(line, &row) == nil && row.PromptIndex != nil && *row.PromptIndex >= target {
				snaps := map[string]json.RawMessage{}
				for p, s := range row.FileSnapshots {
					snaps[p] = s.Content
				}
				rows[*row.PromptIndex] = snaps
			}
		}
		if errors.Is(err, io.EOF) {
			return rows, nil
		}
		if err != nil {
			return nil, err
		}
	}
}

// isNullContent reports whether a snapshot recorded an absent file. A missing
// content key is treated as "unknown" (not absent) so nothing is deleted on a
// format grok-build has not documented.
// @param raw Raw JSON of the content field.
// @returns True only for an explicit JSON null.
func isNullContent(raw json.RawMessage) bool {
	return string(raw) == "null"
}
