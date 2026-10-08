package sessionstream_test

import (
	"testing"

	"github.com/xai-org/grok-desktop/apps/bridge-go/internal/sessionstream"
)

func TestClaimPrimaryRecordsKindAndStartID(t *testing.T) {
	reg := sessionstream.NewRegistry(0)
	reg.ClaimPrimary("s1", sessionstream.KindStarted, "start-1")
	p, ok := reg.Lookup("s1")
	if !ok || p.Kind != sessionstream.KindStarted || p.StartID != "start-1" || p.ParentSessionID != "" {
		t.Fatalf("lookup = %+v ok=%v", p, ok)
	}
	// Crash recovery re-claims as resumed and clears the start id.
	reg.ClaimPrimary("s1", sessionstream.KindResumed, "")
	if p, _ := reg.Lookup("s1"); p.Kind != sessionstream.KindResumed || p.StartID != "" {
		t.Fatalf("re-claim = %+v", p)
	}
	if _, ok := reg.Lookup("unknown"); ok {
		t.Fatal("unknown ids must not resolve")
	}
}

func TestLinkChildExplicitBeatsHostedAndKeepsPrimaryKind(t *testing.T) {
	reg := sessionstream.NewRegistry(0)
	// Child frames arrive through the root's process before the spawn notice.
	reg.LinkChild("c1", "root", false)
	if p, _ := reg.Lookup("c1"); p.Kind != sessionstream.KindChild || p.ParentSessionID != "root" {
		t.Fatalf("hosted link = %+v", p)
	}
	// Nested: the intermediate child's subagent_spawned names the real parent.
	reg.LinkChild("c1", "mid", true)
	if p, _ := reg.Lookup("c1"); p.ParentSessionID != "mid" {
		t.Fatalf("explicit link must win, got %+v", p)
	}
	// Later implicit links never undo an explicit one.
	reg.LinkChild("c1", "root", false)
	if p, _ := reg.Lookup("c1"); p.ParentSessionID != "mid" {
		t.Fatalf("implicit link overrode explicit: %+v", p)
	}
	// Opening the child on its own keeps the lineage.
	reg.ClaimPrimary("c1", sessionstream.KindResumed, "")
	if p, _ := reg.Lookup("c1"); p.Kind != sessionstream.KindResumed || p.ParentSessionID != "mid" {
		t.Fatalf("resumed child = %+v", p)
	}
	reg.LinkChild("self", "self", true)
	reg.LinkChild("", "p", true)
	if _, ok := reg.Lookup("self"); ok {
		t.Fatal("self links are ignored")
	}
}

func TestAnnotateHydrateAlwaysLiveOnlyForChildren(t *testing.T) {
	reg := sessionstream.NewRegistry(0)
	reg.ClaimPrimary("p", sessionstream.KindStarted, "s-1")
	reg.LinkChild("c", "p", true)

	live := map[string]any{}
	reg.Annotate(live, "p", false)
	if _, ok := live["provenance"]; ok {
		t.Fatal("primary live frames stay lean")
	}
	hydrate := map[string]any{}
	reg.Annotate(hydrate, "p", true)
	if p, ok := hydrate["provenance"].(sessionstream.Provenance); !ok || p.StartID != "s-1" {
		t.Fatalf("hydrate provenance = %#v", hydrate["provenance"])
	}
	child := map[string]any{}
	reg.Annotate(child, "c", false)
	if p, ok := child["provenance"].(sessionstream.Provenance); !ok || p.ParentSessionID != "p" {
		t.Fatalf("child live provenance = %#v", child["provenance"])
	}
	unknown := map[string]any{}
	reg.Annotate(unknown, "x", true)
	if len(unknown) != 0 {
		t.Fatal("unknown ids are not annotated")
	}
}

func TestRegistryIsBounded(t *testing.T) {
	reg := sessionstream.NewRegistry(2)
	reg.ClaimPrimary("a", sessionstream.KindStarted, "")
	reg.ClaimPrimary("b", sessionstream.KindStarted, "")
	reg.ClaimPrimary("c", sessionstream.KindStarted, "")
	if _, ok := reg.Lookup("a"); ok {
		t.Fatal("oldest entry must be evicted")
	}
	if _, ok := reg.Lookup("c"); !ok {
		t.Fatal("newest entry must stay")
	}
}

func TestSubagentChildID(t *testing.T) {
	cases := []struct {
		update map[string]any
		want   string
	}{
		{map[string]any{"sessionUpdate": "subagent_spawned", "child_session_id": " c1 "}, "c1"},
		{map[string]any{"sessionUpdate": "subagent_finished", "childSessionId": "c2"}, "c2"},
		{map[string]any{"sessionUpdate": "subagent_spawned", "subagent_id": "c3"}, "c3"},
		{map[string]any{"sessionUpdate": "agent_message_chunk", "child_session_id": "no"}, ""},
		{map[string]any{"sessionUpdate": "subagent_spawned"}, ""},
	}
	for _, tc := range cases {
		if got := sessionstream.SubagentChildID(tc.update); got != tc.want {
			t.Fatalf("SubagentChildID(%v) = %q, want %q", tc.update, got, tc.want)
		}
	}
}
