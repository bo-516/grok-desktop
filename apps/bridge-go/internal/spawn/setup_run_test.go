package spawn

import (
	"context"
	"os"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"
	"unicode/utf8"
)

// outputSink collects RunSetupCommand chunks safely across goroutines.
type outputSink struct {
	mu     sync.Mutex
	chunks []string
}

// add is the onOutput callback.
func (s *outputSink) add(chunk string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.chunks = append(s.chunks, chunk)
}

// text joins everything received so far.
func (s *outputSink) text() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return strings.Join(s.chunks, "")
}

// skipOnWindows skips shell-script fakes on Windows (sh is not guaranteed).
func skipOnWindows(t *testing.T) {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("fake setup commands use /bin/sh")
	}
}

func TestRunSetupCommandStreamsOutputAndExitCode(t *testing.T) {
	skipOnWindows(t)
	sink := &outputSink{}
	res, err := RunSetupCommand(context.Background(),
		[]string{"/bin/sh", "-c", "echo downloading; echo warn >&2; exit 0"}, os.Environ(), time.Minute, sink.add)
	if err != nil {
		t.Fatal(err)
	}
	if res.Code == nil || *res.Code != 0 || res.Canceled || res.TimedOut {
		t.Fatalf("result %+v", res)
	}
	out := sink.text()
	if !strings.Contains(out, "downloading") || !strings.Contains(out, "warn") {
		t.Fatalf("stdout and stderr must both stream, got %q", out)
	}

	res, err = RunSetupCommand(context.Background(),
		[]string{"/bin/sh", "-c", "echo boom >&2; exit 7"}, os.Environ(), time.Minute, nil)
	if err != nil || res.Code == nil || *res.Code != 7 {
		t.Fatalf("non-zero exit must be reported as a code: %+v %v", res, err)
	}
}

func TestRunSetupCommandCancelKillsTree(t *testing.T) {
	skipOnWindows(t)
	ctx, cancel := context.WithCancel(context.Background())
	sink := &outputSink{}
	go func() {
		// Cancel once the child has printed, so it is surely running; give up
		// waiting after 10s so a broken child cannot hang the test.
		deadline := time.Now().Add(10 * time.Second)
		for !strings.Contains(sink.text(), "started") && time.Now().Before(deadline) {
			time.Sleep(10 * time.Millisecond)
		}
		cancel()
	}()
	start := time.Now()
	// The grandchild sleep would keep the pipe open without a tree kill.
	res, err := RunSetupCommand(ctx,
		[]string{"/bin/sh", "-c", "echo started; sleep 60 & wait"}, os.Environ(), time.Minute, sink.add)
	if err != nil {
		t.Fatal(err)
	}
	if !res.Canceled || res.Code != nil {
		t.Fatalf("want canceled without code, got %+v", res)
	}
	if time.Since(start) > 20*time.Second {
		t.Fatalf("cancel took %s", time.Since(start))
	}
}

func TestRunSetupCommandTimeout(t *testing.T) {
	skipOnWindows(t)
	res, err := RunSetupCommand(context.Background(),
		[]string{"/bin/sh", "-c", "exec sleep 60"}, os.Environ(), 100*time.Millisecond, nil)
	if err != nil {
		t.Fatal(err)
	}
	if !res.TimedOut || res.Code != nil {
		t.Fatalf("want timed out, got %+v", res)
	}
}

func TestRunSetupCommandStartFailure(t *testing.T) {
	_, err := RunSetupCommand(context.Background(), []string{"/definitely/not/here"}, nil, time.Second, nil)
	if err == nil {
		t.Fatal("missing program must be an error")
	}
	if _, err := RunSetupCommand(context.Background(), nil, nil, time.Second, nil); err == nil {
		t.Fatal("empty argv must be an error")
	}
}

// A multi-byte character split across two writes must arrive whole.
func TestUTF8ChunkWriterNeverSplitsARune(t *testing.T) {
	sink := &outputSink{}
	w := &utf8ChunkWriter{emit: sink.add}
	word := []byte("ok ✓ 完成")
	for i := range word {
		if _, err := w.Write(word[i : i+1]); err != nil {
			t.Fatal(err)
		}
	}
	w.flush()
	for _, c := range sink.chunks {
		if !utf8.ValidString(c) {
			t.Fatalf("chunk %q is not valid UTF-8", c)
		}
	}
	if sink.text() != string(word) {
		t.Fatalf("reassembled %q", sink.text())
	}
}

func TestCompleteUTF8Prefix(t *testing.T) {
	check := []byte("✓") // e2 9c 93
	if got := completeUTF8Prefix(append([]byte("ab"), check[:2]...)); got != 2 {
		t.Fatalf("partial tail must be held back, got %d", got)
	}
	if got := completeUTF8Prefix(append([]byte("ab"), check...)); got != 5 {
		t.Fatalf("complete rune passes, got %d", got)
	}
	if got := completeUTF8Prefix([]byte("abc")); got != 3 {
		t.Fatalf("ascii passes, got %d", got)
	}
}
