package main

import (
	"errors"
	"os"
	"os/exec"
	"os/signal"
)

// start runs program and ends with its exit status: Windows cannot replace a process. Ctrl+C reaches both, and hadley
// decides when it ends.
func start(program string, args, env []string) error {
	signal.Ignore(os.Interrupt)
	command := exec.Command(program, args[1:]...)
	command.Stdin, command.Stdout, command.Stderr = os.Stdin, os.Stdout, os.Stderr
	command.Env = env
	err := command.Run()
	if exit, ok := errors.AsType[*exec.ExitError](err); ok {
		os.Exit(exit.ExitCode())
	}
	if err != nil {
		return err
	}
	os.Exit(0)
	return nil
}
