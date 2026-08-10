package acp

import "strings"

// indexFoldImpl is a case-insensitive substring search used by containsIgnoreCase.
func indexFoldImpl(s, sub string) int {
	return strings.Index(strings.ToLower(s), strings.ToLower(sub))
}
