//go:build !unix && !windows

package forms

import "errors"

// LockDataDir needs flock or LockFileEx, which this system lacks.
func LockDataDir(string) error {
	return errors.New("hadley-forms runs on Linux, macOS and Windows")
}
