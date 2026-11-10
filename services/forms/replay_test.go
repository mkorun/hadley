package forms

import (
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

func TestReplayStoreSurvivesARestartAndForgetsExpired(t *testing.T) {
	dir, now := t.TempDir(), time.Unix(1_000, 0)
	s, err := openReplayStore(dir, now)
	if err != nil {
		t.Fatal(err)
	}
	for nonce, expiry := range map[string]float64{"live": 2_000, "expired": 1_100} {
		if got, err := s.use(nonce, expiry, now); got != taken || err != nil {
			t.Fatalf("use(%s) = %v, %v", nonce, got, err)
		}
	}
	later := time.Unix(1_500, 0)
	s, err = openReplayStore(dir, later)
	if err != nil {
		t.Fatal(err)
	}
	if !s.seen("live", later) || s.seen("expired", later) {
		t.Errorf("after a restart: live %v, expired %v", s.seen("live", later), s.seen("expired", later))
	}
	data, _ := os.ReadFile(filepath.Join(dir, replayFile))
	if string(data) != "live 2000\n" {
		t.Errorf("file after the restart: %q", data)
	}
}

func TestReplayStoreTakesANonceOnce(t *testing.T) {
	s, err := openReplayStore(t.TempDir(), time.Unix(1_000, 0))
	if err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	var mu sync.Mutex
	count := 0
	for range 20 {
		wg.Go(func() {
			if got, _ := s.use("same", 2_000, time.Unix(1_000, 0)); got == taken {
				mu.Lock()
				count++
				mu.Unlock()
			}
		})
	}
	wg.Wait()
	if count != 1 {
		t.Errorf("taken %d times", count)
	}
}

func TestReplayStoreRefusesAFileItCannotRead(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, replayFile), []byte("no expiry here\n"), 0o600)
	if _, err := openReplayStore(dir, time.Unix(0, 0)); err == nil {
		t.Error("opened a file with a broken line")
	}
}

// review 2026-10-27: a nonce whose record could not be written is used all the same
func TestReplayStoreFailsClosed(t *testing.T) {
	dir := t.TempDir()
	s, err := openReplayStore(dir, time.Unix(1_000, 0))
	if err != nil {
		t.Fatal(err)
	}
	os.Remove(filepath.Join(dir, replayFile))
	os.Mkdir(filepath.Join(dir, replayFile), 0o700) // the file cannot be opened for writing now
	if _, err := s.use("n", 2_000, time.Unix(1_000, 0)); err == nil {
		t.Fatal("use succeeded without its file")
	}
	if !s.seen("n", time.Unix(1_000, 0)) {
		t.Error("a nonce that could not be written is usable again")
	}
}

// review 2026-10-27 (second): a solution sent again around its challenge's expiry is never taken a second time
func TestReplayStoreDecidesAtOneMoment(t *testing.T) {
	s, err := openReplayStore(t.TempDir(), time.Unix(0, 0))
	if err != nil {
		t.Fatal(err)
	}
	at := func(ms int64) time.Time { return time.UnixMilli(ms) }
	for _, step := range []struct {
		now  time.Time
		want taking
	}{
		{at(1_000_400), taken},       // before the expiry at 1000.5 s
		{at(1_000_499), usedAlready}, // still before it
		{at(1_000_500), expired},     // at it: its record no longer counts, the challenge does not either
		{at(1_001_000), expired},
	} {
		if got, _ := s.use("n", 1_000.5, step.now); got != step.want {
			t.Errorf("use at %v: %v, want %v", step.now.UnixMilli(), got, step.want)
		}
	}
	s.purge(at(1_002_000))
	if got, _ := s.use("n", 1_000.5, at(1_002_000)); got != expired {
		t.Errorf("after a purge: %v, want expired", got)
	}
}
