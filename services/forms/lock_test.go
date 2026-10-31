//go:build unix

package forms

import (
	"runtime"
	"strings"
	"testing"
)

func TestASecondServiceOnTheSameDataDoesNotStart(t *testing.T) {
	dir := t.TempDir()
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
