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
)

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
	dir := filepath.Join(cache, "hadley", version+"-"+payloadSum[:12])
	if _, err := os.Stat(dir); errors.Is(err, fs.ErrNotExist) {
		fmt.Fprintln(os.Stderr, "hadley: first start, unpacking (this happens once and takes a moment)")
		if err := install(payload, payloadSum, dir); err != nil {
			return fmt.Errorf("unpacking into %s: %w", dir, err)
		}
	} else if err != nil {
		return err
	}
	return start(executable(dir, "bun"), bunArgs(dir, args), append(os.Environ(),
		"PAGEFIND_BINARY_PATH="+executable(dir, "pagefind")))
}

func executable(dir, name string) string {
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	return filepath.Join(dir, name)
}

// bunArgs is the command line of Bun, its own name first. Bun would read a .env file and a bunfig.toml from the working
// directory, which is the user's site; hadley reads neither.
func bunArgs(dir string, args []string) []string {
	app := filepath.Join(dir, "app")
	return append([]string{
		"bun",
		"--no-env-file",
		"--config=" + filepath.Join(app, "bunfig.toml"),
		filepath.Join(app, "hadley.js"),
	}, args...)
}
