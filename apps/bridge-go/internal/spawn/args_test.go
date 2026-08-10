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

func TestFilterEnvForGrokChild(t *testing.T) {
	src := map[string]string{
		"PATH":        "/bin",
		"HOME":        "/home/u",
		"XAI_API_KEY": "secret",
		"GROK_CUSTOM": "1",
		"AWS_SECRET":  "nope",
		"SECRET_TOKEN": "nope",
	}
	out := FilterEnvForGrokChild(src, nil)
	if out["AWS_SECRET"] != "" || out["SECRET_TOKEN"] != "" {
		t.Fatal("leaked secrets")
	}
	if out["XAI_API_KEY"] != "secret" || out["GROK_CUSTOM"] != "1" || out["PATH"] != "/bin" {
		t.Fatalf("missing required: %v", out)
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
