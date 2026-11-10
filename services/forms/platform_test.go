package forms

import (
	"runtime"
	"testing"
)

// unixModesOnly leaves out a test of Unix permission bits, which Windows does not keep.
func unixModesOnly(t *testing.T) {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("Windows does not keep Unix permission bits")
	}
}
