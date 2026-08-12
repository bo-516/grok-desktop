package spawn

import (
	"strings"
	"testing"
)

func TestBuildGrokAgentArgsOrder(t *testing.T) {
	args := BuildGrokAgentArgs(Options{
		AlwaysApprove: true,
		ExtraArgs:     []string{"--model", "grok-4", "--sandbox", "on", "--no-plan"},
	})
	joined := strings.Join(args, " ")
	// global flags before agent, agent flags before stdio
	if !strings.HasPrefix(joined, "--no-auto-update") {
		t.Fatalf("missing global no-auto-update: %v", args)
	}
	agentIdx := indexOf(args, "agent")
	stdioIdx := indexOf(args, "stdio")
	if agentIdx < 0 || stdioIdx < 0 || agentIdx > stdioIdx {
		t.Fatalf("bad positions agent=%d stdio=%d in %v", agentIdx, stdioIdx, args)
	}
	// sandbox is global → before agent
	sandboxIdx := indexOf(args, "--sandbox")
	if sandboxIdx < 0 || sandboxIdx > agentIdx {
		t.Fatalf("sandbox should be global: %v", args)
	}
	// model is agent → between agent and stdio
	modelIdx := indexOf(args, "--model")
	if modelIdx < agentIdx || modelIdx > stdioIdx {
		t.Fatalf("model should be agent-scoped: %v", args)
	}
	// always-approve folded
	if indexOf(args, "--always-approve") < 0 {
		t.Fatalf("missing always-approve: %v", args)
	}
}

func indexOf(ss []string, s string) int {
	for i, v := range ss {
		if v == s {
			return i
		}
	}
	return -1
}

func TestRulesArgvPlacement(t *testing.T) {
	// A-01: --rules is a global flag → before agent
	args := BuildGrokAgentArgs(Options{
		ExtraArgs: []string{"--rules", "be brief", "--model", "m1"},
	})
	rulesIdx := indexOf(args, "--rules")
	agentIdx := indexOf(args, "agent")
	if rulesIdx < 0 || rulesIdx > agentIdx {
		t.Fatalf("A-01: --rules should be global before agent: %v", args)
	}
	if rulesIdx+1 >= len(args) || args[rulesIdx+1] != "be brief" {
		t.Fatalf("A-01: rules value missing: %v", args)
	}
}

func TestRulesSpecialCharsSingleArgv(t *testing.T) {
	// A-03: newline / quotes / CJK stay one argv element
	text := "line1\n\"quoted\" 中文"
	args := BuildGrokAgentArgs(Options{
		ExtraArgs: []string{"--rules", text},
	})
	rulesIdx := indexOf(args, "--rules")
	if rulesIdx < 0 || rulesIdx+1 >= len(args) || args[rulesIdx+1] != text {
		t.Fatalf("A-03: rules not single argv: %v", args)
	}
	count := 0
	for _, a := range args {
		if a == text {
			count++
		}
	}
	if count != 1 {
		t.Fatalf("A-03: split across argv: %v", args)
	}
}
