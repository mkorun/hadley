package forms

import (
	"runtime"
	"testing"
)

// notOnWindows leaves out a test of the modes of the service's files or of how it replaces them: hadley-forms does
// not start on Windows (lock_other.go, docs/platforms.md), which keeps no such modes and replaces no file that is
// still open.
func notOnWindows(t *testing.T) {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("hadley-forms does not run on Windows (lock_other.go)")
	}
}
