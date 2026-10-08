package sessionstream

import (
	"fmt"
	"testing"
)

// frame builds a raw frame of exactly n bytes tagged with seq (n >= 16).
func frame(seq int64, n int) []byte {
	head := fmt.Sprintf(`{"seq":%d,"p":"`, seq)
	pad := n - len(head) - 2
	b := []byte(head)
	for i := 0; i < pad; i++ {
		b = append(b, 'x')
	}
	return append(b, '"', '}')
}

func TestRingFrameBoundEvictsOldestAndRaisesFloor(t *testing.T) {
	r := newFrameRing(3, 1<<20)
	for seq := int64(1); seq <= 5; seq++ {
		r.push(seq, frame(seq, 32))
	}
	if r.live() != 3 || r.oldestSeq() != 3 || r.floor != 2 {
		t.Fatalf("live=%d oldest=%d floor=%d, want 3/3/2", r.live(), r.oldestSeq(), r.floor)
	}
	if _, ok := r.since(1); ok {
		t.Fatal("since(1) needs evicted seq 2 → must be too old")
	}
	got, ok := r.since(2)
	if !ok || len(got) != 3 {
		t.Fatalf("since(2) ok=%v len=%d, want 3 frames", ok, len(got))
	}
	if string(got[0]) != string(frame(3, 32)) {
		t.Fatalf("frames must be verbatim, got %s", got[0])
	}
}

func TestRingByteBoundKeepsWindowContiguous(t *testing.T) {
	r := newFrameRing(100, 100)
	r.push(1, frame(1, 40))
	r.push(2, frame(2, 40))
	r.push(3, frame(3, 40)) // 120 > 100 → evict seq 1
	if r.bytes != 80 || r.oldestSeq() != 2 || r.floor != 1 {
		t.Fatalf("bytes=%d oldest=%d floor=%d", r.bytes, r.oldestSeq(), r.floor)
	}
	got, ok := r.since(1)
	if !ok || len(got) != 2 {
		t.Fatalf("since(1) ok=%v len=%d", ok, len(got))
	}
}

func TestRingOversizedFrameIsNotRetainedAndBlocksOlderCatchUp(t *testing.T) {
	r := newFrameRing(10, 64)
	r.push(1, frame(1, 32))
	r.push(2, frame(2, 200)) // larger than the whole ring
	if r.live() != 0 || r.floor != 2 {
		t.Fatalf("live=%d floor=%d, want empty ring with floor 2", r.live(), r.floor)
	}
	if _, ok := r.since(1); ok {
		t.Fatal("client before the oversized frame must be too old")
	}
	got, ok := r.since(2)
	if !ok || len(got) != 0 {
		t.Fatalf("client at the oversized frame is current: ok=%v len=%d", ok, len(got))
	}
	r.push(3, frame(3, 32))
	if got, ok := r.since(2); !ok || len(got) != 1 {
		t.Fatalf("since(2) after seq 3: ok=%v len=%d", ok, len(got))
	}
}

func TestRingCompactionKeepsBackingArrayBounded(t *testing.T) {
	r := newFrameRing(4, 1<<20)
	for seq := int64(1); seq <= 1000; seq++ {
		r.push(seq, frame(seq, 20))
	}
	if r.live() != 4 || cap(r.entries) > 16 {
		t.Fatalf("live=%d cap=%d — ring must not grow with total frames", r.live(), cap(r.entries))
	}
	got, ok := r.since(996)
	if !ok || len(got) != 4 {
		t.Fatalf("since(996) ok=%v len=%d", ok, len(got))
	}
}

func TestRingCurrentClientGetsEmptyOK(t *testing.T) {
	r := newFrameRing(4, 1<<20)
	if got, ok := r.since(0); !ok || len(got) != 0 {
		t.Fatalf("empty ring since(0): ok=%v len=%d", ok, len(got))
	}
	r.push(1, frame(1, 20))
	if got, ok := r.since(1); !ok || len(got) != 0 {
		t.Fatalf("since(head): ok=%v len=%d", ok, len(got))
	}
}
