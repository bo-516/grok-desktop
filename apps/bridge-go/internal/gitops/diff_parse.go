package gitops

import (
	"bufio"
	"bytes"
	"errors"
	"io"
	"strconv"
	"strings"
)

// DiffFile is one changed path in a working-tree diff.
// Paths are repo-relative with `/` separators.
type DiffFile struct {
	// Path is the current path (rename destination).
	Path string `json:"path"`
	// OrigPath is the rename / copy source; empty otherwise.
	OrigPath string `json:"origPath,omitempty"`
	// Status is added | modified | deleted | renamed | copied | typechange |
	// unmerged | unknown.
	Status string `json:"status"`
	// Untracked is true for files git does not track yet (shown as added).
	Untracked bool `json:"untracked,omitempty"`
	// Added is the number of added lines (0 for binary files).
	Added int `json:"added"`
	// Removed is the number of removed lines (0 for binary files).
	Removed int `json:"removed"`
	// Binary is true when git reports the file as binary (numstat "-").
	Binary bool `json:"binary,omitempty"`
	// OldMode / NewMode are octal file modes ("100644"); "000000" when absent.
	OldMode string `json:"oldMode,omitempty"`
	NewMode string `json:"newMode,omitempty"`
	// Patch is this file's unified diff section (headers + full-context
	// hunks). Empty when Binary, TooLarge or Omitted.
	Patch string `json:"patch,omitempty"`
	// TooLarge is true when the patch exceeded the per-file byte cap.
	TooLarge bool `json:"tooLarge,omitempty"`
	// Omitted is true when the aggregate budget ran out before this file;
	// request it again with `paths` to load it alone.
	Omitted bool `json:"omitted,omitempty"`
}

// rawStatusNames maps `git diff --raw` status letters to DiffFile.Status.
var rawStatusNames = map[byte]string{
	'A': "added",
	'M': "modified",
	'D': "deleted",
	'R': "renamed",
	'C': "copied",
	'T': "typechange",
	'U': "unmerged",
}

// parseRawNumstat parses `git diff --raw --numstat -z` output: every raw
// record first (`:<srcMode> <dstMode> <srcSha> <dstSha> <status>` then one
// path, or two for renames / copies), then one numstat record per raw record
// in the same order (`<added>\t<removed>\t<path>`, or an empty path followed
// by the two rename paths). Binary files report "-" counts.
// @param out Raw NUL-separated stdout.
// @returns Files in git's diff-queue order (the same order as the patch).
func parseRawNumstat(out string) ([]DiffFile, error) {
	tokens := strings.Split(out, "\x00")
	files := []DiffFile{}
	i := 0
	for i < len(tokens) && strings.HasPrefix(tokens[i], ":") {
		fields := strings.Fields(tokens[i][1:])
		if len(fields) < 5 || fields[4] == "" {
			return nil, errors.New("malformed git diff --raw record")
		}
		letter := fields[4][0]
		f := DiffFile{OldMode: fields[0], NewMode: fields[1], Status: rawStatusNames[letter]}
		if f.Status == "" {
			f.Status = "unknown"
		}
		if letter == 'R' || letter == 'C' {
			if i+2 >= len(tokens) {
				return nil, errors.New("truncated git diff --raw rename record")
			}
			f.OrigPath, f.Path = tokens[i+1], tokens[i+2]
			i += 3
		} else {
			if i+1 >= len(tokens) {
				return nil, errors.New("truncated git diff --raw record")
			}
			f.Path = tokens[i+1]
			i += 2
		}
		files = append(files, f)
	}
	for k := 0; k < len(files) && i < len(tokens); k++ {
		parts := strings.SplitN(tokens[i], "\t", 3)
		if len(parts) != 3 {
			return nil, errors.New("malformed git diff --numstat record")
		}
		if parts[0] == "-" || parts[1] == "-" {
			files[k].Binary = true
		} else {
			files[k].Added, _ = strconv.Atoi(parts[0])
			files[k].Removed, _ = strconv.Atoi(parts[1])
		}
		if parts[2] == "" {
			i += 3 // rename: old and new path follow as their own tokens
		} else {
			i++
		}
	}
	return files, nil
}

// patchSection is one per-file chunk of a streamed `git diff` patch.
type patchSection struct {
	// text accumulates the section while it stays under the caps.
	text bytes.Buffer
	// size counts every byte of the section, kept or not, so a section that
	// was dropped for budget can still be classified as tooLarge.
	size int
	// tooLarge marks a section that crossed the per-file cap (wins over omitted:
	// reloading it alone would fail the same way).
	tooLarge bool
	// omitted marks a section dropped because the aggregate budget ran out.
	omitted bool
}

// sectionHeaders start a new per-file section at the beginning of a line.
// Hunk body lines always start with ' ', '+', '-' or '\', so a file whose
// content contains "diff --git" can never be mistaken for a header.
var sectionHeaders = [][]byte{[]byte("diff --git "), []byte("* Unmerged path ")}

// splitPatchStream reads a multi-file patch and splits it into per-file
// sections without holding more than the caps in memory: bytes past a
// section's maxFile are discarded (tooLarge) and sections that do not fit the
// remaining maxTotal budget are dropped (omitted). Very long lines are read in
// buffer-sized fragments, so a minified file cannot force a huge allocation.
// The reader is always drained to EOF so git never blocks on a full pipe.
// @param r Patch stream (git stdout).
// @param maxFile Per-section byte cap.
// @param maxTotal Aggregate byte budget across kept sections.
// @returns Sections in stream order.
func splitPatchStream(r io.Reader, maxFile, maxTotal int) ([]*patchSection, error) {
	br := bufio.NewReaderSize(r, 64*1024)
	sections := []*patchSection{}
	var cur *patchSection
	total := 0
	atLineStart := true
	for {
		chunk, err := br.ReadSlice('\n')
		if len(chunk) > 0 {
			if atLineStart && isSectionHeader(chunk) {
				cur = &patchSection{}
				sections = append(sections, cur)
			}
			if cur != nil {
				total = appendCapped(cur, chunk, maxFile, maxTotal, total)
			}
			atLineStart = chunk[len(chunk)-1] == '\n'
		}
		if errors.Is(err, bufio.ErrBufferFull) {
			continue
		}
		if errors.Is(err, io.EOF) {
			return sections, nil
		}
		if err != nil {
			return sections, err
		}
	}
}

// isSectionHeader reports whether a line fragment starts a file section.
// @param line Bytes at the start of a line.
// @returns True for `diff --git ` / `* Unmerged path ` lines.
func isSectionHeader(line []byte) bool {
	for _, h := range sectionHeaders {
		if bytes.HasPrefix(line, h) {
			return true
		}
	}
	return false
}

// appendCapped appends chunk to sec while respecting both caps.
// @param sec Section receiving the bytes.
// @param chunk Next fragment of the stream.
// @param maxFile Per-section cap; crossing it frees the section and flags
//
//	tooLarge (clearing omitted).
//
// @param maxTotal Aggregate budget; crossing it frees the section and flags omitted.
// @param total Bytes currently held across all kept sections.
// @returns Updated total.
func appendCapped(sec *patchSection, chunk []byte, maxFile, maxTotal, total int) int {
	sec.size += len(chunk)
	if sec.tooLarge {
		return total
	}
	held := sec.text.Len()
	switch {
	case sec.size > maxFile:
		sec.tooLarge = true
		sec.omitted = false
	case sec.omitted:
		return total
	case total+len(chunk) > maxTotal:
		sec.omitted = true
	default:
		sec.text.Write(chunk)
		return total + len(chunk)
	}
	sec.text = bytes.Buffer{}
	return total - held
}

// attachPatches copies section text onto files by position. Positions only
// line up when git printed exactly one section per raw record; otherwise
// every file is marked omitted rather than risk showing one file's diff under
// another file's name.
// @param files Diff files in raw order (mutated in place).
// @param sections Sections in patch order.
// @returns False when the counts disagree (no patches attached).
func attachPatches(files []DiffFile, sections []*patchSection) bool {
	if len(sections) != len(files) {
		for i := range files {
			files[i].Omitted = !files[i].Binary
		}
		return false
	}
	for i := range files {
		sec := sections[i]
		switch {
		case files[i].Binary:
			// No textual patch for binaries; numstat already flagged them.
		case sec.tooLarge:
			files[i].TooLarge = true
		case sec.omitted:
			files[i].Omitted = true
		default:
			files[i].Patch = sec.text.String()
		}
	}
	return true
}
