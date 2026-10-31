// Command hadley is the program of a release (scripts/build-binary.ts). It carries Bun, Pagefind and the package,
// unpacks them once into the user's cache directory and runs hadley with them. That directory can be deleted at any
// time; the next start unpacks it again.
package main

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// firstStart is also how install/install.sh tells a program of hadley from any other file, without running it.
const firstStart = "hadley: first start, unpacking (this happens once and takes a moment)"

// Set by scripts/build-binary.ts.
var (
	version    = "devel"
	payloadSum = ""
)

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintf(os.Stderr, "hadley: %v\n", err)
		os.Exit(1)
	}
}

func run(args []string) error {
	if len(payload) == 0 {
		return errors.New("this build carries no package; scripts/build-binary.ts builds the program")
	}
	cache, err := os.UserCacheDir()
	if err != nil {
		return err
	}
	cache = filepath.Join(cache, "hadley")
	program, err := os.Executable()
	if err != nil {
		return err
	}
	if program, err = filepath.EvalSymlinks(program); err != nil {
		return err
	}
	removeOld(program)
	if len(args) == 1 && args[0] == "upgrade" {
		return upgrade(github(), program, cache)
	}
	dir := filepath.Join(cache, version+"-"+payloadSum[:12])
	if _, err := os.Lstat(dir); errors.Is(err, fs.ErrNotExist) {
		fmt.Fprintln(os.Stderr, firstStart)
		if err := install(payload, payloadSum, dir); err != nil {
			return fmt.Errorf("unpacking into %s: %w", dir, err)
		}
	} else if err != nil {
		return err
	}
	if err := check(dir); err != nil {
		return err
	}
	return start(executable(dir, "bun"), bunArgs(dir, args), bunEnv(os.Environ(), dir))
}

func executable(dir, name string) string {
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	return filepath.Join(dir, name)
}

// bunArgs is the command line of Bun, its own name first. Bun would read a .env file and a bunfig.toml from the working
// directory, which is the user's site, and would download a package it does not find; hadley runs on what it carries.
func bunArgs(dir string, args []string) []string {
	app := filepath.Join(dir, "app")
	return append([]string{
		"bun",
		"--no-env-file",
		"--no-install",
		"--config=" + filepath.Join(app, "bunfig.toml"),
		filepath.Join(app, "hadley.js"),
	}, args...)
}

// bunEnv is the environment of Bun: the user's, without the variables that give Bun options, of which BUN_OPTIONS would
// load code from the working directory before hadley.
func bunEnv(environ []string, dir string) []string {
	var env []string
	for _, variable := range environ {
		if !strings.HasPrefix(strings.ToUpper(variable), "BUN_") {
			env = append(env, variable)
		}
	}
	return append(env, "PAGEFIND_BINARY_PATH="+executable(dir, "pagefind"))
}
