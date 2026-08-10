// Package spawn starts and reaps `grok agent stdio` process trees.
package spawn

import "os"

// AlwaysPassEnv is the product-required + standard runtime env whitelist (F-CFG-05).
var AlwaysPassEnv = []string{
	"PATH", "HOME", "USER", "LOGNAME", "TMPDIR", "TMP", "TEMP",
	"LANG", "LC_ALL", "LC_CTYPE", "TERM", "COLORTERM", "SHELL",
	"XAI_API_KEY", "GROK_BIN", "GROK_HOME", "GROK_SANDBOX", "GROK_WEB_FETCH",
	"GROK_MEMORY", "GROK_SUBAGENTS", "GROK_LSP_TOOLS", "GROK_TOOL_SEARCH",
	"GROK_LOG_FILE", "RUST_LOG",
	"HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY",
	"https_proxy", "http_proxy", "no_proxy",
	"SSL_CERT_FILE", "NODE_EXTRA_CA_CERTS",
}

// FilterEnvForGrokChild filters source env to the whitelist + GROK_*/XAI_* + extras.
// source: full process env map; extraAllow: session-opted keys from SPAWN config.
// Returns a sanitized env map suitable for the agent child (never dumps full process env).
func FilterEnvForGrokChild(source map[string]string, extraAllow []string) map[string]string {
	allow := make(map[string]bool, len(AlwaysPassEnv)+len(extraAllow))
	for _, k := range AlwaysPassEnv {
		allow[k] = true
	}
	for _, k := range extraAllow {
		if k != "" {
			allow[k] = true
		}
	}
	out := make(map[string]string)
	for k, v := range source {
		if allow[k] || hasPrefix(k, "GROK_") || hasPrefix(k, "XAI_") {
			out[k] = v
		}
	}
	return out
}

// EnvironMap converts os.Environ() KEY=VAL slices into a map.
func EnvironMap() map[string]string {
	out := make(map[string]string)
	for _, e := range os.Environ() {
		for i := 0; i < len(e); i++ {
			if e[i] == '=' {
				out[e[:i]] = e[i+1:]
				break
			}
		}
	}
	return out
}

// MapToEnviron converts a map to KEY=VAL slice for exec.Cmd.Env.
func MapToEnviron(m map[string]string) []string {
	out := make([]string, 0, len(m))
	for k, v := range m {
		out = append(out, k+"="+v)
	}
	return out
}

func hasPrefix(s, p string) bool {
	return len(s) >= len(p) && s[:len(p)] == p
}
