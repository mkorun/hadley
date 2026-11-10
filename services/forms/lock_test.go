//go:build unix || windows

package forms

import (
	"runtime"
	"strings"
	"testing"
)

func TestASecondServiceOnTheSameDataDoesNotStart(t *testing.T) {
	dir := t.TempDir()
	releaseTestLocks(t)
	if err := LockDataDir(dir); err != nil {
		t.Fatal(err)
	}
	if err := LockDataDir(dir); err == nil || !strings.Contains(err.Error(), "in use by another hadley-forms") {
		t.Errorf("second lock: %v", err)
	}
}

// review 2026-10-27 (second): the lock outlasts a garbage collection, which closes files nothing refers to
func TestTheLockOutlastsAGarbageCollection(t *testing.T) {
	dir := t.TempDir()
	releaseTestLocks(t)
	if err := LockDataDir(dir); err != nil {
		t.Fatal(err)
	}
	for range 3 {
		runtime.GC()
	}
	if err := LockDataDir(dir); err == nil {
		t.Error("the lock was gone after a garbage collection")
	}
}

// Windows cannot remove an open lock file when TempDir cleans up.
func releaseTestLocks(t *testing.T) {
	t.Helper()
	before := len(held)
	t.Cleanup(func() {
		for _, file := range held[before:] {
			if err := file.Close(); err != nil {
				t.Error(err)
			}
		}
		held = held[:before]
	})
}
