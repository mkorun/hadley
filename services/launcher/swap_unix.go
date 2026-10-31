//go:build !windows

package main

import "os"

func swap(file, program string) error {
	return os.Rename(file, program)
}

func removeOld(string) {}
