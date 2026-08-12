package jsonrpc

import (
	"strings"
	"testing"
)

func TestEncodeDecodeRoundTrip(t *testing.T) {
	line := EncodeRequest(1, "initialize", map[string]any{"protocolVersion": 1})
	if !strings.HasSuffix(line, "\n") {
		t.Fatalf("expected trailing newline")
	}
	dec := DecodeLine(line)
	if !dec.OK {
		t.Fatalf("decode failed: %s", dec.Error)
	}
	kind := ClassifyMessage(dec.Message)
	if kind.Kind != "request" || kind.Method != "initialize" {
		t.Fatalf("kind=%+v", kind)
	}
}

func TestDecodeEmptyAndInvalid(t *testing.T) {
	if DecodeLine("").OK || DecodeLine("   ").OK {
		t.Fatal("empty should fail")
	}
	if DecodeLine("not-json").OK {
		t.Fatal("invalid json should fail")
	}
	if DecodeLine("42").OK {
		t.Fatal("non-object should fail")
	}
}

func TestClassifyResponseAndNotification(t *testing.T) {
	resp := DecodeLine(EncodeMessage(map[string]any{
		"jsonrpc": "2.0",
		"id":      3,
		"result":  map[string]any{"ok": true},
	}))
	k := ClassifyMessage(resp.Message)
	if k.Kind != "response" {
		t.Fatalf("want response got %s", k.Kind)
	}
	// JSON numbers decode as float64; callers must normalize with rpcIDKey.
	if _, ok := k.ID.(float64); !ok {
		t.Fatalf("expected float64 id, got %T %v", k.ID, k.ID)
	}

	n := DecodeLine(EncodeNotification("session/update", map[string]any{
		"sessionId": "s1",
		"update":    map[string]any{"sessionUpdate": "agent_message_chunk"},
	}))
	kn := ClassifyMessage(n.Message)
	if kn.Kind != "notification" || kn.Method != "session/update" {
		t.Fatalf("want notification got %+v", kn)
	}
}

func TestSplitNdjsonBuffer(t *testing.T) {
	lines, rest := SplitNdjsonBuffer("{\"a\":1}\n{\"b\":2}\npartial")
	if len(lines) != 2 || rest != "partial" {
		t.Fatalf("lines=%v rest=%q", lines, rest)
	}
	// Empty lines between content are dropped by SplitNdjsonBuffer filter.
	lines2, rest2 := SplitNdjsonBuffer("one\n\ntwo\n")
	if len(lines2) != 2 || rest2 != "" {
		t.Fatalf("lines2=%v rest2=%q", lines2, rest2)
	}
}

func TestLineSplitterFeedsCompleteLinesOnly(t *testing.T) {
	var got []string
	s := NewLineSplitter(func(line string) { got = append(got, line) })
	s.Feed([]byte("{\"x\":1"))
	if len(got) != 0 {
		t.Fatalf("partial should not emit")
	}
	s.Feed([]byte("}\n{\"y\":2}\n"))
	if len(got) != 2 {
		t.Fatalf("got %v", got)
	}
}

func TestEncodeResponseError(t *testing.T) {
	line := EncodeResponse(7, nil, &Error{Code: -32601, Message: "Method not found"})
	dec := DecodeLine(line)
	k := ClassifyMessage(dec.Message)
	if k.Kind != "response" || k.Error == nil || k.Error.Code != -32601 {
		t.Fatalf("kind=%+v", k)
	}
}
