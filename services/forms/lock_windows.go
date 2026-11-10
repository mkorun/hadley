package forms

import (
	"fmt"
	"os"
	"path/filepath"
	"syscall"
	"unsafe"
)

var lockFileEx = syscall.NewLazyDLL("kernel32.dll").NewProc("LockFileEx")

// held keeps the lock files open: one closed by the garbage collector would release its lock.
var held []*os.File

// LockDataDir takes dataDir for this process, so that a second service on the same data does not start: the replay
// store and the queue are kept consistent by one process. The lock lasts until the process ends.
func LockDataDir(dataDir string) error {
	file, err := os.OpenFile(filepath.Join(dataDir, "hadley-forms.lock"), os.O_RDWR|os.O_CREATE, 0o600)
	if err != nil {
		return err
	}
	const (
		lockfileFailImmediately = 0x1
		lockfileExclusiveLock   = 0x2
		errorLockViolation      = syscall.Errno(33)
	)
	var overlapped syscall.Overlapped
	ok, _, err := lockFileEx.Call(file.Fd(), lockfileExclusiveLock|lockfileFailImmediately, 0, 1, 0,
		uintptr(unsafe.Pointer(&overlapped)))
	if ok == 0 {
		file.Close()
		if err == errorLockViolation {
			return fmt.Errorf("%s is in use by another hadley-forms", dataDir)
		}
		return err
	}
	held = append(held, file)
	return nil
}
