package reverse

import (
	"path/filepath"
	"regexp"
	"strings"
	"unicode/utf8"
)

// Sensitive basename patterns aligned with Node workspaceReadGuards.ts.
var sensitiveBasenameREs = []*regexp.Regexp{
	regexp.MustCompile(`(?i)^\.env($|\.)`),
	regexp.MustCompile(`(?i)\.pem$`),
	regexp.MustCompile(`(?i)\.key$`),
	regexp.MustCompile(`(?i)\.p12$`),
	regexp.MustCompile(`(?i)\.pfx$`),
	regexp.MustCompile(`(?i)^id_rsa`),
	regexp.MustCompile(`(?i)^id_ed25519`),
	regexp.MustCompile(`(?i)^\.npmrc$`),
	regexp.MustCompile(`(?i)^\.netrc$`),
	regexp.MustCompile(`(?i)^\.pgpass$`),
	regexp.MustCompile(`(?i)^credentials$`),
	regexp.MustCompile(`(?i)^service-account.*\.json$`),
	regexp.MustCompile(`(?i)\.kubeconfig$`),
	regexp.MustCompile(`(?i)^secrets\.(json|ya?ml)$`),
}

// IsSensitiveWorkspacePath reports whether a relative path looks like a secret.
func IsSensitiveWorkspacePath(relativePath string) bool {
	base := filepath.Base(strings.ReplaceAll(relativePath, "\\", "/"))
	for _, re := range sensitiveBasenameREs {
		if re.MatchString(base) {
			return true
		}
	}
	return false
}

// GuessTextMimeType returns a text mime for embedded/preview resource blocks.
func GuessTextMimeType(relativePath string) string {
	ext := strings.ToLower(filepath.Ext(relativePath))
	switch ext {
	case ".md", ".markdown":
		return "text/markdown"
	case ".json":
		return "application/json"
	case ".ts", ".tsx", ".js", ".jsx":
		return "text/plain"
	case ".css", ".html", ".xml", ".svg":
		return "text/plain"
	case ".yml", ".yaml":
		return "text/yaml"
	default:
		return "text/plain"
	}
}

// IsBinaryBuffer detects NUL bytes or high density of control chars.
func IsBinaryBuffer(buf []byte) bool {
	for _, b := range buf {
		if b == 0 {
			return true
		}
	}
	control := 0
	sample := len(buf)
	if sample > 8192 {
		sample = 8192
	}
	for i := 0; i < sample; i++ {
		b := buf[i]
		if b < 9 || (b > 13 && b < 32) {
			control++
		}
	}
	return sample > 0 && float64(control)/float64(sample) > 0.1
}

// IsBinaryUtf8Replacement reports high U+FFFD density after UTF-8 decode.
func IsBinaryUtf8Replacement(content string, byteLength int) bool {
	if byteLength <= 0 || !strings.ContainsRune(content, '\uFFFD') {
		return false
	}
	count := strings.Count(content, "\uFFFD")
	// content length is runes-ish via utf8; use rune count for density.
	n := utf8.RuneCountInString(content)
	if n == 0 {
		return false
	}
	return float64(count)/float64(n) > 0.01
}

// MaxEmbedFileBytes is the hard ceiling for @mention embed reads.
const MaxEmbedFileBytes = 256 * 1024

// MaxPreviewFileBytes is the preview ceiling (truncates, does not hard-fail).
const MaxPreviewFileBytes = 1024 * 1024
