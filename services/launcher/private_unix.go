//go:build !windows

package main

import (
	"io/fs"
	"os"
	"syscall"
)

// private says whether only this user can change what lies in a directory.
func private(info fs.FileInfo) bool {
	stat, ok := info.Sys().(*syscall.Stat_t)
	return ok && int(stat.Uid) == os.Geteuid() && info.Mode().Perm()&0o022 == 0
}
