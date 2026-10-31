package forms

import (
	"bufio"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

// The nonces of solved challenges, until their challenges expire (CONTRACT.md C9): in memory, and appended to
// DATA_DIR/used-nonces.txt (a line "<nonce> <expiry in Unix seconds>") so that a restart keeps them. The file is
// rewritten without the expired ones at startup and whenever a purge removes some.

const replayFile = "used-nonces.txt"

type replayStore struct {
	mu   sync.Mutex
	path string
	used map[string]float64 // nonce → expiry in Unix seconds
}

func openReplayStore(dataDir string, now time.Time) (*replayStore, error) {
	s := &replayStore{path: filepath.Join(dataDir, replayFile), used: map[string]float64{}}
	file, err := os.Open(s.path)
	if err != nil && !os.IsNotExist(err) {
		return nil, err
	}
	if err == nil {
		defer file.Close()
		lines := bufio.NewScanner(file)
		for lines.Scan() {
			nonce, expiry, ok := strings.Cut(lines.Text(), " ")
			at, parseErr := strconv.ParseFloat(expiry, 64)
			if !ok || parseErr != nil {
				return nil, fmt.Errorf("%s: not a line \"<nonce> <expiry>\": %q", s.path, lines.Text())
			}
			s.used[nonce] = at
		}
		if err := lines.Err(); err != nil {
			return nil, err
		}
	}
	if err := s.purge(now); err != nil {
		return nil, err
	}
	return s, s.rewrite() // the file exists from here on, writable, or the service does not start
}

// seen reports whether nonce was used by a challenge that has not expired.
func (s *replayStore) seen(nonce string, now time.Time) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.live(nonce, now)
}

func (s *replayStore) live(nonce string, now time.Time) bool {
	at, ok := s.used[nonce]
	return ok && at > float64(now.Unix())
}

// taking is what use decided for a nonce.
type taking int

const (
	taken       taking = iota // recorded as used now
	usedAlready               // used by an earlier submission
	expired                   // its challenge has expired
)

// use records nonce as used until expiry. It decides at one moment, now, under the store's lock: a challenge expired
// by then is not taken, and one not expired is either used already (its record is live until that same expiry) or
// taken here; so no solution is taken twice, also when two arrive around the expiry. The nonce counts as used from
// here on even when writing it fails, which is an error.
func (s *replayStore) use(nonce string, expiry float64, now time.Time) (taking, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if expiry <= float64(now.UnixMilli())/1000 {
		return expired, nil
	}
	if _, ok := s.used[nonce]; ok {
		return usedAlready, nil
	}
	s.used[nonce] = expiry
	file, err := os.OpenFile(s.path, os.O_APPEND|os.O_WRONLY|os.O_CREATE, 0o600)
	if err != nil {
		return taken, err
	}
	_, err = fmt.Fprintf(file, "%s %s\n", nonce, strconv.FormatFloat(expiry, 'f', -1, 64))
	if err == nil {
		err = file.Sync()
	}
	return taken, errors.Join(err, file.Close())
}

// purge forgets the nonces whose challenges have expired, and logs how many if any.
func (s *replayStore) purge(now time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	removed := 0
	for nonce, at := range s.used {
		if at <= float64(now.Unix()) {
			delete(s.used, nonce)
			removed++
		}
	}
	if removed == 0 {
		return nil
	}
	log.Printf("[replay-store] %d abgelaufene Nonce(s) gelöscht", removed)
	return s.rewriteLocked()
}

func (s *replayStore) rewrite() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.rewriteLocked()
}

// rewriteLocked replaces the file with the nonces in memory, through a temporary file renamed over it.
func (s *replayStore) rewriteLocked() error {
	temp, err := os.CreateTemp(filepath.Dir(s.path), replayFile+".*")
	if err != nil {
		return err
	}
	defer os.Remove(temp.Name()) // gone after the rename; only left over when something failed
	w := bufio.NewWriter(temp)
	for nonce, at := range s.used {
		fmt.Fprintf(w, "%s %s\n", nonce, strconv.FormatFloat(at, 'f', -1, 64))
	}
	err = w.Flush()
	if err == nil {
		err = temp.Sync()
	}
	if closeErr := temp.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		return err
	}
	return os.Rename(temp.Name(), s.path)
}
