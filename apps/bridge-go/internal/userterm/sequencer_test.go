package userterm

import (
	"reflect"
	"testing"
)

// TestOpSequencerRestoresOrder: ops that arrive out of order run in seq order.
func TestOpSequencerRestoresOrder(t *testing.T) {
	s := newOpSequencer()
	var got []int
	op := func(n int) func() { return func() { got = append(got, n) } }
	if ran := s.submit(3, op(3)); ran != 0 {
		t.Fatalf("seq 3 ran early (%d)", ran)
	}
	if ran := s.submit(2, op(2)); ran != 0 {
		t.Fatalf("seq 2 ran early (%d)", ran)
	}
	if ran := s.submit(1, op(1)); ran != 3 {
		t.Fatalf("seq 1 should flush 3 ops, ran %d", ran)
	}
	s.submit(4, op(4))
	if !reflect.DeepEqual(got, []int{1, 2, 3, 4}) {
		t.Fatalf("order = %v", got)
	}
}

// TestOpSequencerDropsDuplicatesAndRunsUnordered: stale seqs are dropped and
// seq 0 bypasses ordering.
func TestOpSequencerDropsDuplicatesAndRunsUnordered(t *testing.T) {
	s := newOpSequencer()
	count := 0
	inc := func() { count++ }
	s.submit(1, inc)
	if ran := s.submit(1, inc); ran != 0 {
		t.Fatal("duplicate seq ran")
	}
	if ran := s.submit(0, inc); ran != 1 {
		t.Fatal("unordered op did not run immediately")
	}
	if count != 2 {
		t.Fatalf("count = %d, want 2", count)
	}
}

// TestOpSequencerSkipsPermanentGap: a seq that never arrives cannot park
// input forever; past maxOutOfOrderOps the sequencer jumps the gap.
func TestOpSequencerSkipsPermanentGap(t *testing.T) {
	s := newOpSequencer()
	count := 0
	for seq := uint64(2); seq <= maxOutOfOrderOps+2; seq++ {
		s.submit(seq, func() { count++ })
	}
	if count != maxOutOfOrderOps+1 {
		t.Fatalf("count = %d, want %d after skipping the gap", count, maxOutOfOrderOps+1)
	}
}
