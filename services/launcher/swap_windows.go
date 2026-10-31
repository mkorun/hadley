package main

import (
	"errors"
	"os"
)

// swap moves program aside first: Windows lets a running program be renamed, not replaced.
func swap(file, program string) error {
	old := program + ".old"
	os.Remove(old)
	if err := os.Rename(program, old); err != nil {
		return err
	}
	if err := os.Rename(file, program); err != nil {
		return errors.Join(err, os.Rename(old, program))
	}
	return nil
}

// removeOld deletes the program an upgrade moved aside, which could not delete it while it ran.
func removeOld(program string) {
	os.Remove(program + ".old")
}
