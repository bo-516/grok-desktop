package envfilter

import "testing"

func TestFilterEnvForGrokChild(t *testing.T) {
	src := map[string]string{
		"PATH":         "/bin",
		"HOME":         "/home/u",
		"XAI_API_KEY":  "secret",
		"GROK_CUSTOM":  "1",
		"AWS_SECRET":   "nope",
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

func TestFilterEnvExtraAllow(t *testing.T) {
	src := map[string]string{"CUSTOM_OPT_IN": "yes", "AWS_SECRET": "nope"}
	out := FilterEnvForGrokChild(src, []string{"CUSTOM_OPT_IN"})
	if out["CUSTOM_OPT_IN"] != "yes" {
		t.Fatal("extra allow missing")
	}
	if out["AWS_SECRET"] != "" {
		t.Fatal("secret still leaked")
	}
}

func TestMapToEnvironRoundTrip(t *testing.T) {
	m := map[string]string{"A": "1", "B": "2"}
	env := MapToEnviron(m)
	if len(env) != 2 {
		t.Fatalf("len=%d", len(env))
	}
}
