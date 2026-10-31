package forms

import (
	"errors"
	"log"
	"strings"
	"sync"
	"time"
)

// The rate limit of the token route (CONTRACT.md C4): a count per network, by the text of the client's address.

const rateLimitWarning = 10_000 // buckets beyond which every new one is logged

type bucket struct {
	count   float64
	resetAt float64 // milliseconds
}

type rateLimiter struct {
	mu      sync.Mutex
	buckets map[string]*bucket
}

func newRateLimiter() *rateLimiter { return &rateLimiter{buckets: map[string]*bucket{}} }

// clear forgets every bucket; the service calls it every six hours.
func (l *rateLimiter) clear() {
	l.mu.Lock()
	defer l.mu.Unlock()
	clear(l.buckets)
}

// allow counts a request from address and reports whether it is within max requests per window milliseconds.
func (l *rateLimiter) allow(address string, max, window float64, now time.Time) (bool, error) {
	key, err := subnet(address)
	if err != nil {
		return false, err
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	ms := float64(now.UnixMilli())
	b := l.buckets[key]
	if b == nil || b.resetAt <= ms {
		if len(l.buckets) >= rateLimitWarning {
			log.Printf("[rate-limit] SIZE_CAP (%d) erreicht — ungewöhnlicher Traffic", rateLimitWarning)
		}
		l.buckets[key] = &bucket{count: 1, resetAt: ms + window}
		return true, nil
	}
	if b.count >= max {
		return false, nil
	}
	b.count++
	return true, nil
}

// subnet is the key of an address: the first three dot-separated parts of an IPv4 address, the first three groups of
// an IPv6 address after one :: is expanded with zero groups to eight. It works on the text, as the service it
// replaces does, and fails where that one does: on an IPv6 text with more than eight groups around ::.
func subnet(address string) (string, error) {
	if !strings.Contains(address, ":") {
		return strings.Join(first(strings.Split(address, "."), 3), "."), nil
	}
	groups := strings.Split(address, ":")
	if parts := strings.Split(address, "::"); len(parts) > 1 {
		var left, right []string
		if parts[0] != "" {
			left = strings.Split(parts[0], ":")
		}
		if parts[1] != "" {
			right = strings.Split(parts[1], ":")
		}
		missing := 8 - len(left) - len(right)
		if missing < 0 {
			return "", errors.New("an IPv6 address with more than eight groups")
		}
		groups = append(append(left, strings.Split(strings.Repeat("0:", missing), ":")[:missing]...), right...)
	}
	return strings.Join(first(groups, 3), ":"), nil
}

func first(list []string, n int) []string {
	return list[:min(n, len(list))]
}
