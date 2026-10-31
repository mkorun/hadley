//go:build !windows

package main

import "syscall"

// start replaces this process, so that a signal to hadley reaches hadley.
func start(program string, args, env []string) error {
	return syscall.Exec(program, args, env)
}
