// Package worktree creates and inspects grok-managed git worktrees.
// Session start calls Create before spawning the agent. The desktop calls
// Inspect to decide whether "Run in a new worktree" applies and whether
// Remove worktree must be refused.
package worktree

import (
	"fmt"
	"strings"
)

// createTimeoutMs is the deadline for `grok worktree create`.
// Creating a copy of a large tree can take longer than a list call.
const createTimeoutMs = 60_000

// listTimeoutMs is the deadline for `grok worktree list` and `show`.
// Both are reads; they should finish well under a minute.
const listTimeoutMs = 30_000

// Request is the optional worktree object on a session start frame.
// A non-nil request always creates a worktree. Empty Name and Ref mean
// "let grok name it" and "base on HEAD plus uncommitted changes".
type Request struct {
	// Name is the optional worktree name (`grok worktree create NAME`).
	// Empty lets the CLI generate one. A value that starts with "-" is rejected
	// so it cannot be read as a flag.
	Name string
	// Ref is the optional base (`--ref`). Empty omits the flag, which is the
	// CLI default: HEAD plus uncommitted changes. A value that starts with "-"
	// is rejected.
	Ref string
	// Cwd is the source repository the CLI runs in. Create fills this from
	// the session start cwd; ParseRequest leaves it empty.
	Cwd string
}

// ParseRequest reads the `worktree` field of a session start frame.
// Nil (field absent or JSON null) means "do not create" and returns (nil, nil).
// A JSON object, including `{}`, returns a request and creates a worktree.
// A non-object is an error so the start fails instead of ignoring the field.
//
// @param raw Decoded JSON value; nil when the client omitted worktree.
// @returns Request to create, or nil when the client did not ask. Error when
// the shape or a name/ref token is invalid — callers must not start the session.
func ParseRequest(raw any) (*Request, error) {
	if raw == nil {
		return nil, nil
	}
	fields, ok := raw.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("worktree must be an object with optional name and ref")
	}
	name, err := stringField(fields, "name")
	if err != nil {
		return nil, err
	}
	ref, err := stringField(fields, "ref")
	if err != nil {
		return nil, err
	}
	if err := rejectFlagToken("worktree name", name); err != nil {
		return nil, err
	}
	if err := rejectFlagToken("worktree ref", ref); err != nil {
		return nil, err
	}
	return &Request{Name: name, Ref: ref}, nil
}

// BuildCreateArgs is the argv for `grok worktree create [NAME] [--ref REF]`.
// Name is positional and comes before options, matching the CLI. Empty name
// and empty ref are omitted so the CLI keeps its defaults.
//
// @param name Optional worktree name; empty lets grok generate one.
// @param ref Optional base ref; empty omits --ref (HEAD plus uncommitted changes).
// @returns Args after the grok binary. Never includes a leading dash token
// from name or ref; ParseRequest rejects those before Create runs.
func BuildCreateArgs(name, ref string) []string {
	args := []string{"worktree", "create"}
	if name != "" {
		args = append(args, name)
	}
	if ref != "" {
		args = append(args, "--ref", ref)
	}
	return args
}

// stringField reads one optional string from a JSON object.
// Missing and JSON null are empty. Any other type is an error.
//
// @param fields Object bag; nil is treated as empty.
// @param key Field name (`name` or `ref`).
// @returns Trimmed string (may be empty) or an error when the type is wrong.
func stringField(fields map[string]any, key string) (string, error) {
	if fields == nil {
		return "", nil
	}
	raw, ok := fields[key]
	if !ok || raw == nil {
		return "", nil
	}
	text, ok := raw.(string)
	if !ok {
		return "", fmt.Errorf("worktree %s must be a string", key)
	}
	return strings.TrimSpace(text), nil
}

// rejectFlagToken rejects values that the CLI would parse as flags.
// Empty is allowed. Newlines are rejected so a value cannot break argv.
//
// @param label Human name used in the error (`worktree name` / `worktree ref`).
// @param value Already-trimmed token.
// @returns nil when the token is safe to pass as its own argv element.
func rejectFlagToken(label, value string) error {
	if value == "" {
		return nil
	}
	if strings.HasPrefix(value, "-") {
		return fmt.Errorf("%s must not start with '-'", label)
	}
	if strings.ContainsAny(value, "\r\n") {
		return fmt.Errorf("%s must be a single line", label)
	}
	return nil
}
