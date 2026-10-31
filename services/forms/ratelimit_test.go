package forms

import (
	"testing"
	"time"
)

func TestSubnet(t *testing.T) {
	for address, want := range map[string]string{
		"192.0.2.42": "192.0.2", "unknown": "unknown", "": "", "2001:db8::1": "2001:db8:0",
		"2001:db8:0:5::1": "2001:db8:0", "::1": "0:0:0", "2001:DB8:1:2:3:4:5:6": "2001:DB8:1", "fe80::1::2": "fe80:0:0",
	} {
		if got, err := subnet(address); err != nil || got != want {
			t.Errorf("subnet(%q) = %q, %v, want %q", address, got, err, want)
		}
	}
	if _, err := subnet("1:2:3:4:5:6:7:8::9"); err == nil {
		t.Error("subnet of nine groups around :: succeeded")
	}
}

func TestRateLimit(t *testing.T) {
	l, now := newRateLimiter(), time.Unix(1000, 0)
	for i, want := range []bool{true, true, false, false} {
		if got, _ := l.allow("192.0.2.1", 2, 60_000, now); got != want {
			t.Errorf("request %d: %v, want %v", i, got, want)
		}
	}
	if got, _ := l.allow("192.0.2.9", 2, 60_000, now.Add(time.Minute)); !got {
		t.Error("a new window refused")
	}
	if got, _ := l.allow("10.0.0.1", 0, 60_000, now); !got {
		t.Error("the first request of a network refused with a maximum of 0")
	}
}
