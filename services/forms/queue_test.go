package forms

import (
	"errors"
	"os"
	"path/filepath"
	"sync"
	"testing"
)

func TestQueueFreezesUntilDropped(t *testing.T) {
	q := &queue{dir: t.TempDir()}
	if resumed, comments, err := q.take(); err != nil || resumed || len(comments) != 0 {
		t.Fatalf("take of nothing: %v %v %v", resumed, comments, err)
	}
	for _, record := range []string{`{"id":"a"}`, `{"id":"b"}`} {
		if err := q.add([]byte(record), 1e6, 1e6); err != nil {
			t.Fatal(err)
		}
	}
	resumed, comments, err := q.take()
	if err != nil || resumed || len(comments) != 2 {
		t.Fatalf("first take: %v %d %v", resumed, len(comments), err)
	}
	q.add([]byte(`{"id":"c"}`), 1e6, 1e6)
	if resumed, comments, _ := q.take(); !resumed || len(comments) != 2 {
		t.Errorf("second take: %v %d", resumed, len(comments))
	}
	q.drop()
	if resumed, comments, _ := q.take(); resumed || len(comments) != 1 || string(stringifyJS(comments[0])) != `{"id":"c"}` {
		t.Errorf("after drop: %v %v", resumed, comments)
	}
}

// review 2026-10-31 (before going public): the queue, which holds email addresses, was readable by every local user
func TestQueueFileIsTheServicesAlone(t *testing.T) {
	q := &queue{dir: t.TempDir()}
	if err := q.add([]byte(`{"id":"a"}`), 1e6, 1e6); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(filepath.Join(q.dir, queueFile))
	if err != nil {
		t.Fatal(err)
	}
	if mode := info.Mode().Perm(); mode != 0o600 {
		t.Fatalf("mode %o", mode)
	}
}

func TestQueueLimits(t *testing.T) {
	q := &queue{dir: t.TempDir()}
	q.add([]byte(`{}`), 1e6, 1e6)
	if err := q.add([]byte(`{}`), 1e6, 1); !errors.Is(err, errQueueFull) {
		t.Errorf("entries: %v", err)
	}
	if err := q.add([]byte(`{}`), 3, 1e6); !errors.Is(err, errQueueFull) {
		t.Errorf("bytes: %v", err)
	}
	data, _ := os.ReadFile(filepath.Join(q.dir, queueFile))
	if string(data) != "{}\n" {
		t.Errorf("queue: %q", data)
	}
}

// review 2026-10-27: the limit holds when many submissions arrive at once
func TestQueueLimitHoldsUnderConcurrency(t *testing.T) {
	q := &queue{dir: t.TempDir()}
	var wg sync.WaitGroup
	start := make(chan struct{})
	for range 200 {
		wg.Go(func() {
			<-start
			q.add([]byte(`{}`), 1e6, 5)
		})
	}
	close(start) // all at once, so that without the lock several see room for one more
	wg.Wait()
	data, _ := os.ReadFile(filepath.Join(q.dir, queueFile))
	if lines := len(nonBlankLines(data)); lines != 5 {
		t.Errorf("%d records, want 5", lines)
	}
}
