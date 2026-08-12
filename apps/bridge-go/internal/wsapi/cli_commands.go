package wsapi

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/xai-org/grok-desktop/apps/bridge-go/internal/spawn"
)

// Timeouts for one-shot CLI channel commands (ms). Match Node cliCommands.
const (
	sessionsSearchTimeoutMs = 60_000
	sessionsDeleteTimeoutMs = 30_000
	exportTimeoutMs         = 60_000
	mcpMutateTimeoutMs      = 30_000
	worktreeListTimeoutMs   = 30_000
	worktreeMutateTimeoutMs = 60_000
	modelsListTimeoutMs     = 30_000
	memoryClearTimeoutMs    = 30_000
	authLoginTimeoutMs      = 300_000
	authLogoutTimeoutMs     = 30_000
	updateCheckTimeoutMs    = 30_000
	pluginTimeoutMs         = 120_000
	marketplaceTimeoutMs    = 60_000
	importClaudeTimeoutMs   = 120_000
)

// safeMcpServerNameRE matches MCP server ids safe for log basenames.
// Letters, digits, dot, underscore, hyphen only (mirrors Node mcpLogReader).
var safeMcpServerNameRE = regexp.MustCompile(`^[A-Za-z0-9._-]+$`)

// sessionsSearch runs `grok sessions search <query> --json` (full-text).
// Falls back to plain text on JSON failure.
//
// @param query Search string; empty still invokes the CLI (it will error).
// @param cwd Optional workspace scope.
// @returns Parsed JSON or `{raw: string}`.
func sessionsSearch(query, cwd string) (any, error) {
	result, err := spawn.RunGrokCli(
		[]string{"sessions", "search", query, "--json"},
		cwd,
		sessionsSearchTimeoutMs,
	)
	if err != nil {
		return nil, err
	}
	if result.Code != nil && *result.Code == 0 {
		if result.JSON != nil {
			return result.JSON, nil
		}
		return map[string]any{"raw": result.Stdout}, nil
	}
	plain, err := spawn.RunGrokCli(
		[]string{"sessions", "search", query},
		cwd,
		sessionsSearchTimeoutMs,
	)
	if err != nil {
		return nil, err
	}
	if err := spawn.AssertCliOk(plain, "sessions search"); err != nil {
		return nil, err
	}
	return map[string]any{"raw": plain.Stdout}, nil
}

// sessionsDelete permanently deletes a session (`grok sessions delete --yes`).
// On non-zero exit retries without --yes (some CLI versions differ).
//
// @param sessionID Upstream session id.
// @returns CliRunResult-shaped map {code, stdout, stderr}.
func sessionsDelete(sessionID string) (any, error) {
	result, err := spawn.RunGrokCli(
		[]string{"sessions", "delete", sessionID, "--yes"},
		"",
		sessionsDeleteTimeoutMs,
	)
	if err != nil {
		return nil, err
	}
	if result.Code != nil && *result.Code == 0 {
		return cliRunMap(result), nil
	}
	plain, err := spawn.RunGrokCli(
		[]string{"sessions", "delete", sessionID},
		"",
		sessionsDeleteTimeoutMs,
	)
	if err != nil {
		return nil, err
	}
	return cliRunMap(plain), nil
}

// sessionsExport exports a session as Markdown (`grok export <id> [outFile]`).
//
// @param sessionID Target session.
// @param outFile Optional output path; empty means stdout capture.
// @returns {markdown, path?} bag matching Node sessionsExport.
func sessionsExport(sessionID, outFile string) (any, error) {
	args := []string{"export", sessionID}
	if outFile != "" {
		args = append(args, outFile)
	}
	result, err := spawn.RunGrokCli(args, "", exportTimeoutMs)
	if err != nil {
		return nil, err
	}
	if err := spawn.AssertCliOk(result, "export"); err != nil {
		return nil, err
	}
	out := map[string]any{"markdown": result.Stdout}
	if outFile != "" {
		out["path"] = outFile
	}
	return out, nil
}

// mcpAddStdio runs `grok mcp add` for a stdio server.
// args bag: name, command, cmdArgs[], env[] (KEY=value), scope (user|project).
//
// @param args Free-form client args.
// @param cwd Optional project cwd for --scope project.
// @returns CliRunResult-shaped map.
func mcpAddStdio(args map[string]any, cwd string) (any, error) {
	name := stringArg(args, "name")
	command := stringArg(args, "command")
	cliArgs := buildMcpAddStdioArgs(name, command, stringSliceArg(args, "cmdArgs"), stringSliceArg(args, "env"), stringArg(args, "scope"))
	result, err := spawn.RunGrokCli(cliArgs, cwd, mcpMutateTimeoutMs)
	if err != nil {
		return nil, err
	}
	return cliRunMap(result), nil
}

// buildMcpAddStdioArgs builds argv for `grok mcp add` (stdio). Pure for tests.
//
// @param name Server id.
// @param command Binary / entrypoint.
// @param cmdArgs Optional args after `--`.
// @param env Repeatable KEY=value for `-e`.
// @param scope user (default) or project.
// @returns Full argv after the binary name.
func buildMcpAddStdioArgs(name, command string, cmdArgs, env []string, scope string) []string {
	out := []string{"mcp", "add", name}
	for _, entry := range env {
		if t := strings.TrimSpace(entry); t != "" {
			out = append(out, "-e", t)
		}
	}
	out = append(out, command)
	if len(cmdArgs) > 0 {
		out = append(out, "--")
		out = append(out, cmdArgs...)
	}
	if scope == "project" {
		out = append(out, "--scope", "project")
	}
	return out
}

// mcpEnable runs `grok mcp enable <name>`.
func mcpEnable(name, cwd string) (any, error) {
	result, err := spawn.RunGrokCli([]string{"mcp", "enable", name}, cwd, mcpMutateTimeoutMs)
	if err != nil {
		return nil, err
	}
	return cliRunMap(result), nil
}

// mcpDisable runs `grok mcp disable <name>`.
func mcpDisable(name, cwd string) (any, error) {
	result, err := spawn.RunGrokCli([]string{"mcp", "disable", name}, cwd, mcpMutateTimeoutMs)
	if err != nil {
		return nil, err
	}
	return cliRunMap(result), nil
}

// mcpRemove runs `grok mcp remove <name> [--scope project|user]`.
func mcpRemove(name, scope, cwd string) (any, error) {
	args := []string{"mcp", "remove", name}
	if scope != "" {
		args = append(args, "--scope", scope)
	}
	result, err := spawn.RunGrokCli(args, cwd, mcpMutateTimeoutMs)
	if err != nil {
		return nil, err
	}
	return cliRunMap(result), nil
}

// mcpAddHttp runs `grok mcp add` for http/sse transport.
// args bag: name, url, headers[], transport (http|sse), scope.
func mcpAddHttp(args map[string]any, cwd string) (any, error) {
	cliArgs := buildMcpAddHttpArgs(
		stringArg(args, "name"),
		stringArg(args, "url"),
		stringSliceArg(args, "headers"),
		stringArg(args, "transport"),
		stringArg(args, "scope"),
	)
	result, err := spawn.RunGrokCli(cliArgs, cwd, mcpMutateTimeoutMs)
	if err != nil {
		return nil, err
	}
	return cliRunMap(result), nil
}

// buildMcpAddHttpArgs builds argv for remote MCP add. Pure for tests.
func buildMcpAddHttpArgs(name, url string, headers []string, transport, scope string) []string {
	if transport != "sse" {
		transport = "http"
	}
	out := []string{"mcp", "add", name, "--transport", transport, url}
	for _, h := range headers {
		if t := strings.TrimSpace(h); t != "" {
			out = append(out, "-H", t)
		}
	}
	if scope == "project" {
		out = append(out, "--scope", "project")
	}
	return out
}

// worktreeList runs `grok worktree list --json` with plain fallback.
func worktreeList(cwd string) (any, error) {
	result, err := spawn.RunGrokCli([]string{"worktree", "list", "--json"}, cwd, worktreeListTimeoutMs)
	if err != nil {
		return nil, err
	}
	if (result.Code != nil && *result.Code == 0) && result.JSON != nil {
		return result.JSON, nil
	}
	plain, err := spawn.RunGrokCli([]string{"worktree", "list"}, cwd, worktreeListTimeoutMs)
	if err != nil {
		return nil, err
	}
	code := 1
	if plain.Code != nil {
		code = *plain.Code
	}
	return map[string]any{"raw": plain.Stdout, "code": code}, nil
}

// worktreeRm runs `grok worktree rm <name> [--dry-run]`.
func worktreeRm(name string, dryRun bool, cwd string) (any, error) {
	args := []string{"worktree", "rm", name}
	if dryRun {
		args = append(args, "--dry-run")
	}
	result, err := spawn.RunGrokCli(args, cwd, worktreeMutateTimeoutMs)
	if err != nil {
		return nil, err
	}
	return cliRunMap(result), nil
}

// worktreeGc runs `grok worktree gc --max-age <maxAge>`.
func worktreeGc(maxAge, cwd string) (any, error) {
	result, err := spawn.RunGrokCli(
		[]string{"worktree", "gc", "--max-age", maxAge},
		cwd,
		worktreeMutateTimeoutMs,
	)
	if err != nil {
		return nil, err
	}
	return cliRunMap(result), nil
}

// modelsList runs `grok models --json` with plain fallback.
func modelsList() (any, error) {
	result, err := spawn.RunGrokCli([]string{"models", "--json"}, "", modelsListTimeoutMs)
	if err != nil {
		return nil, err
	}
	if (result.Code != nil && *result.Code == 0) && result.JSON != nil {
		return result.JSON, nil
	}
	plain, err := spawn.RunGrokCli([]string{"models"}, "", modelsListTimeoutMs)
	if err != nil {
		return nil, err
	}
	code := 1
	if plain.Code != nil {
		code = *plain.Code
	}
	return map[string]any{"raw": plain.Stdout, "code": code}, nil
}

// memoryClear runs `grok memory clear --workspace|--global|--all --yes`.
//
// @param scope workspace | global | all (unknown → workspace).
// @param cwd Workspace when scope includes workspace.
func memoryClear(scope, cwd string) (any, error) {
	flag := "--workspace"
	switch scope {
	case "global":
		flag = "--global"
	case "all":
		flag = "--all"
	}
	result, err := spawn.RunGrokCli(
		[]string{"memory", "clear", flag, "--yes"},
		cwd,
		memoryClearTimeoutMs,
	)
	if err != nil {
		return nil, err
	}
	return cliRunMap(result), nil
}

// authLogin runs `grok login` (optionally --device-auth). Long timeout for OIDC.
func authLogin(deviceAuth bool) (any, error) {
	args := []string{"login"}
	if deviceAuth {
		args = []string{"login", "--device-auth"}
	}
	result, err := spawn.RunGrokCli(args, "", authLoginTimeoutMs)
	if err != nil {
		return nil, err
	}
	return cliRunMap(result), nil
}

// authLogout runs `grok logout`. Caller must dispose the pool after success.
func authLogout() (any, error) {
	result, err := spawn.RunGrokCli([]string{"logout"}, "", authLogoutTimeoutMs)
	if err != nil {
		return nil, err
	}
	return cliRunMap(result), nil
}

// updateCheck runs `grok update --check` without applying updates.
func updateCheck() (any, error) {
	result, err := spawn.RunGrokCli([]string{"update", "--check"}, "", updateCheckTimeoutMs)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"code":   codeOrNeg1(result),
		"stdout": result.Stdout,
		"stderr": result.Stderr,
	}, nil
}

// pluginAction runs `grok plugin <action> [name] --json` with plain fallback.
// Empty action defaults to "list" (matches Node).
func pluginAction(action, name, cwd string) (any, error) {
	if action == "" {
		action = "list"
	}
	args := []string{"plugin", action}
	if name != "" {
		args = append(args, name)
	}
	jsonArgs := append(append([]string{}, args...), "--json")
	result, err := spawn.RunGrokCli(jsonArgs, cwd, pluginTimeoutMs)
	if err != nil {
		return nil, err
	}
	if (result.Code != nil && *result.Code == 0) && result.JSON != nil {
		return result.JSON, nil
	}
	plain, err := spawn.RunGrokCli(args, cwd, pluginTimeoutMs)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"code": codeOrNeg1(plain),
		"raw":  plain.Stdout + plain.Stderr,
	}, nil
}

// marketplaceAction runs `grok plugin marketplace <action> [name]`.
// Empty action defaults to "list".
func marketplaceAction(action, name string) (any, error) {
	if action == "" {
		action = "list"
	}
	args := []string{"plugin", "marketplace", action}
	if name != "" {
		args = append(args, name)
	}
	result, err := spawn.RunGrokCli(args, "", marketplaceTimeoutMs)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"code": codeOrNeg1(result),
		"raw":  result.Stdout + result.Stderr,
		"json": result.JSON,
	}, nil
}

// mcpStderrLog reads or lists ~/.grok/logs/mcp/*.stderr.log (F-EXT-06).
// args.list=true → basenames; otherwise args.name → file content (empty if missing/unsafe).
func mcpStderrLog(args map[string]any) (any, error) {
	home, _ := os.UserHomeDir()
	if boolArg(args, "list") {
		return listMcpStderrLogs(home), nil
	}
	name := stringArg(args, "name")
	return map[string]any{
		"name":    name,
		"content": readMcpStderrLog(name, home),
	}, nil
}

// importClaude runs `grok import` (Claude Code history import).
func importClaude(cwd string) (any, error) {
	result, err := spawn.RunGrokCli([]string{"import"}, cwd, importClaudeTimeoutMs)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"code":   codeOrNeg1(result),
		"stdout": result.Stdout,
		"stderr": result.Stderr,
	}, nil
}

// --- MCP log helpers (mirrors Node mcpLogReader) ---

// isSafeMcpServerName reports whether a server id is safe as a log basename.
func isSafeMcpServerName(serverName string) bool {
	return serverName != "" &&
		len(serverName) <= 128 &&
		safeMcpServerNameRE.MatchString(serverName) &&
		!strings.Contains(serverName, "..")
}

// defaultMcpLogDir returns ~/.grok/logs/mcp under home.
func defaultMcpLogDir(home string) string {
	return filepath.Join(home, ".grok", "logs", "mcp")
}

// resolveMcpLogFile returns the absolute log path or empty when unsafe/escapes.
func resolveMcpLogFile(serverName, home string) string {
	if !isSafeMcpServerName(serverName) {
		return ""
	}
	dir := filepath.Clean(defaultMcpLogDir(home))
	file := filepath.Clean(filepath.Join(dir, serverName+".stderr.log"))
	rel, err := filepath.Rel(dir, file)
	if err != nil || strings.HasPrefix(rel, "..") || filepath.IsAbs(rel) {
		return ""
	}
	return file
}

// readMcpStderrLog returns log text or empty string when missing/unsafe.
func readMcpStderrLog(serverName, home string) string {
	file := resolveMcpLogFile(serverName, home)
	if file == "" {
		return ""
	}
	b, err := os.ReadFile(file)
	if err != nil {
		return ""
	}
	return string(b)
}

// listMcpStderrLogs lists available MCP stderr log basenames under home.
func listMcpStderrLogs(home string) []string {
	dir := defaultMcpLogDir(home)
	entries, err := os.ReadDir(dir)
	if err != nil {
		return []string{}
	}
	out := make([]string, 0, len(entries))
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		if strings.HasSuffix(name, ".stderr.log") {
			out = append(out, name)
		}
	}
	return out
}

// --- shared result helpers ---

// cliRunMap shapes a CliRunResult like Node's serializable run result.
func cliRunMap(result spawn.CliRunResult) map[string]any {
	m := map[string]any{
		"stdout": result.Stdout,
		"stderr": result.Stderr,
		"code":   codeOrNeg1(result),
	}
	if result.JSON != nil {
		m["json"] = result.JSON
	}
	return m
}

// codeOrNeg1 returns the exit code or -1 when nil.
func codeOrNeg1(result spawn.CliRunResult) int {
	if result.Code != nil {
		return *result.Code
	}
	return -1
}
