package userterm

import "sync"

// outputQueue buffers PTY output between the PTY reader goroutine and the
// WebSocket sender goroutine of one terminal, and implements the two-level
// backpressure the user terminal relies on:
//
//  1. Credit window (highWater): the sender only emits a frame while the bytes
//     sent but not yet acknowledged by the UI (terminal_ack) stay below
//     highWater. A UI that stops consuming output (xterm busy parsing a flood)
//     therefore stops the bridge from pushing more into the socket.
//  2. Pending cap (maxPending): once that many bytes are waiting for credit,
//     push blocks, the reader stops draining the PTY, the kernel PTY buffer
//     fills, and the child process blocks in write(2) — the same flow control
//     a real terminal emulator applies.
//
// Abort (kill / disconnect) drops everything and turns push into a non-blocking
// discard so the reader can keep draining the PTY until it closes (ConPTY's
// ClosePseudoConsole can block while its output pipe is full).
type outputQueue struct {
	// mu guards every field below; cond waits on it.
	mu sync.Mutex
	// cond wakes both blocked pushers (room freed) and the sender (data / credit).
	cond *sync.Cond
	// buf holds output bytes not yet framed for the UI.
	buf []byte
	// unacked counts bytes framed and sent but not acknowledged by the UI.
	unacked int
	// inputClosed is set once the reader hit EOF/error: no more pushes follow.
	inputClosed bool
	// aborted is set by abort: pending output is dropped and waiters released.
	aborted bool
	// maxPending is the pending-byte cap at which push blocks (> 0).
	maxPending int
	// highWater is the unacknowledged-byte credit window (> 0).
	highWater int
	// maxFrame caps the size of one output frame (> 0).
	maxFrame int
}

// newOutputQueue builds an empty queue.
//
// @param maxPending Pending bytes at which push blocks; values < 1 become 1.
// @param highWater Unacked bytes at which next stops handing out frames; < 1 becomes 1.
// @param maxFrame Maximum bytes per frame returned by next; < 1 becomes 1.
// @returns A queue ready for one reader and one sender goroutine.
func newOutputQueue(maxPending, highWater, maxFrame int) *outputQueue {
	q := &outputQueue{
		maxPending: max(maxPending, 1),
		highWater:  max(highWater, 1),
		maxFrame:   max(maxFrame, 1),
	}
	q.cond = sync.NewCond(&q.mu)
	return q
}

// push appends one chunk of PTY output, blocking while the pending buffer is
// at or above maxPending (backpressure into the PTY).
//
// @param chunk Bytes read from the PTY; copied, so the caller may reuse it.
// @returns false when the queue was aborted (the chunk is discarded and the
// caller should keep draining without expecting delivery); true otherwise.
func (q *outputQueue) push(chunk []byte) bool {
	q.mu.Lock()
	defer q.mu.Unlock()
	for !q.aborted && len(q.buf) >= q.maxPending {
		q.cond.Wait()
	}
	if q.aborted {
		return false
	}
	q.buf = append(q.buf, chunk...)
	q.cond.Broadcast()
	return true
}

// next blocks until a frame may be sent and returns it.
//
// A frame is handed out when output is pending and the credit window has room;
// its length is counted as unacknowledged until ack returns it.
//
// @returns (frame, true) for a frame to send; (nil, false) once the reader has
// closed and everything was handed out, or when the queue was aborted. After
// false the sender loop must stop.
func (q *outputQueue) next() ([]byte, bool) {
	q.mu.Lock()
	defer q.mu.Unlock()
	for {
		if q.aborted {
			return nil, false
		}
		if len(q.buf) > 0 && q.unacked < q.highWater {
			n := min(len(q.buf), q.maxFrame)
			frame := make([]byte, n)
			copy(frame, q.buf[:n])
			// Shift left in place so the backing array never grows past
			// maxPending + one read chunk.
			q.buf = append(q.buf[:0], q.buf[n:]...)
			q.unacked += n
			q.cond.Broadcast()
			return frame, true
		}
		if len(q.buf) == 0 && q.inputClosed {
			return nil, false
		}
		q.cond.Wait()
	}
}

// ack returns credit for bytes the UI has finished rendering.
//
// @param n Bytes acknowledged; values <= 0 are ignored, and the window never
// goes negative even if a buggy client over-acks.
func (q *outputQueue) ack(n int) {
	if n <= 0 {
		return
	}
	q.mu.Lock()
	defer q.mu.Unlock()
	q.unacked = max(q.unacked-n, 0)
	q.cond.Broadcast()
}

// closeInput records that the reader reached EOF; next drains what is left
// and then reports false. Idempotent.
func (q *outputQueue) closeInput() {
	q.mu.Lock()
	defer q.mu.Unlock()
	q.inputClosed = true
	q.cond.Broadcast()
}

// abort drops pending output and releases every waiter. After abort, push
// discards (returns false) and next returns false. Idempotent.
func (q *outputQueue) abort() {
	q.mu.Lock()
	defer q.mu.Unlock()
	q.aborted = true
	q.buf = nil
	q.cond.Broadcast()
}

// pending reports bytes buffered but not yet framed (tests / diagnostics).
func (q *outputQueue) pending() int {
	q.mu.Lock()
	defer q.mu.Unlock()
	return len(q.buf)
}
