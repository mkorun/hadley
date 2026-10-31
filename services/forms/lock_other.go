//go:build !unix

package forms

import "errors"

// LockDataDir needs flock, which this system lacks; the service runs on Linux and macOS.
func LockDataDir(string) error {
	return errors.New("hadley-forms runs on Linux and macOS (on Windows: in WSL)")
}
