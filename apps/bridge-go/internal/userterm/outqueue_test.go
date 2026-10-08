package userterm

import (
	"bytes"
	"testing"
	"time"
)

// TestOutputQueueCreditWindow: next stops handing out frames once highWater
// bytes are unacknowledged and resumes after ack.
func TestOutputQueueCreditWindow(t *testing.T) {
	q := newOutputQueue(1024, 8, 4)
	q.push([]byte("abcdefghijkl"))

	frames := [][]byte{}
	for range 2 {
		f, ok := q.next()
		if !ok {
			t.Fatal("next reported closed")
		}
		frames = append(frames, f)
	}
	if got := string(bytes.Join(frames, nil)); got != "abcdefgh" {
		t.Fatalf("frames = %q, want abcdefgh", got)
	}

	got := make(chan []byte, 1)
	go func() {
		f, _ := q.next()
		got <- f
	}()
	select {
	case f := <-got:
		t.Fatalf("next returned %q with a full credit window", f)
	case <-time.After(50 * time.Millisecond):
	}
	q.ack(4)
	select {
	case f := <-got:
		if string(f) != "ijkl" {
			t.Fatalf("frame after ack = %q, want ijkl", f)
		}
	case <-time.After(time.Second):
		t.Fatal("next did not resume after ack")
	}
}

// TestOutputQueuePendingCapBlocksPush: push blocks at maxPending until the
// sender takes a frame, which is the backpressure into the PTY.
func TestOutputQueuePendingCapBlocksPush(t *testing.T) {
	q := newOutputQueue(4, 100, 4)
	q.push([]byte("1234"))
	done := make(chan bool, 1)
	go func() { done <- q.push([]byte("5")) }()
	select {
	case <-done:
		t.Fatal("push did not block at the pending cap")
	case <-time.After(50 * time.Millisecond):
	}
	if f, ok := q.next(); !ok || string(f) != "1234" {
		t.Fatalf("next = %q,%v", f, ok)
	}
	select {
	case ok := <-done:
		if !ok {
			t.Fatal("push reported abort")
		}
	case <-time.After(time.Second):
		t.Fatal("push stayed blocked after room was freed")
	}
	if q.pending() != 1 {
		t.Fatalf("pending = %d, want 1", q.pending())
	}
}

// TestOutputQueueCloseDrainsThenEnds: after closeInput, remaining bytes are
// still delivered, then next reports false.
func TestOutputQueueCloseDrainsThenEnds(t *testing.T) {
	q := newOutputQueue(64, 64, 64)
	q.push([]byte("tail"))
	q.closeInput()
	if f, ok := q.next(); !ok || string(f) != "tail" {
		t.Fatalf("next = %q,%v; want tail,true", f, ok)
	}
	if _, ok := q.next(); ok {
		t.Fatal("next after drain should report false")
	}
}

// TestOutputQueueAbortReleasesWaiters: abort wakes a blocked pusher and a
// blocked sender and turns push into a discard.
func TestOutputQueueAbortReleasesWaiters(t *testing.T) {
	q := newOutputQueue(1, 100, 4)
	q.push([]byte("x"))
	pushed := make(chan bool, 1)
	go func() { pushed <- q.push([]byte("y")) }()
	time.Sleep(20 * time.Millisecond)
	q.abort()
	select {
	case ok := <-pushed:
		if ok {
			t.Fatal("push after abort should report false")
		}
	case <-time.After(time.Second):
		t.Fatal("abort did not release the blocked pusher")
	}
	if _, ok := q.next(); ok {
		t.Fatal("next after abort should report false")
	}
	if q.push([]byte("z")) {
		t.Fatal("push on an aborted queue should discard")
	}
}

// TestOutputQueueAckNeverNegative: over-acking clamps instead of granting
// unlimited credit.
func TestOutputQueueAckNeverNegative(t *testing.T) {
	q := newOutputQueue(64, 4, 4)
	q.ack(1000)
	q.push([]byte("abcdefgh"))
	if f, _ := q.next(); string(f) != "abcd" {
		t.Fatalf("first frame = %q", f)
	}
	got := make(chan struct{})
	go func() {
		_, _ = q.next()
		close(got)
	}()
	select {
	case <-got:
		t.Fatal("over-ack before sending granted extra credit")
	case <-time.After(50 * time.Millisecond):
	}
	q.abort()
	<-got
}
