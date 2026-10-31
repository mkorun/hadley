//go:build unix

package forms

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"syscall"
)

// held keeps the lock files open: one closed by the garbage collector would release its lock.
var held []*os.File

// LockDataDir takes dataDir for this process, so that a second service on the same data does not start: the replay
// store and the queue are kept consistent by one process. The lock lasts until the process ends.
func LockDataDir(dataDir string) error {
	path := filepath.Join(dataDir, "hadley-forms.lock")
	file, err := os.OpenFile(path, os.O_RDWR|os.O_CREATE, 0o600)
	if err != nil {
		return err
	}
	if err := syscall.Flock(int(file.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		file.Close()
		if errors.Is(err, syscall.EWOULDBLOCK) {
			return fmt.Errorf("%s is in use by another hadley-forms", dataDir)
		}
		return err
	}
	held = append(held, file)
	return nil
}
