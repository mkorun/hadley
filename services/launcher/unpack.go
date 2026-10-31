package main

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	settleAttempts = 30
	settleWait     = 100 * time.Millisecond
	temporaryName  = ".unpack-"
	// Longer than any unpacking takes: what is older was left by a start that died.
	staleAfter = time.Hour
)

// install unpacks payload into the new directory dir, which appears whole or not at all: two first starts at once
// cannot see half of it.
func install(payload []byte, sum, dir string) error {
	got := sha256.Sum256(payload)
	if hex.EncodeToString(got[:]) != sum {
		return errors.New("the program is damaged: download it again")
	}
	parent := filepath.Dir(dir)
	if err := os.MkdirAll(parent, 0o700); err != nil {
		return err
	}
	removeStale(parent)
	temporary, err := os.MkdirTemp(parent, temporaryName)
	if err != nil {
		return err
	}
	defer os.RemoveAll(temporary)
	if err := unpack(bytes.NewReader(payload), temporary); err != nil {
		return err
	}
	return settle(temporary, dir)
}

// removeStale deletes what a start left that died while unpacking. It only frees space, so a failure does not matter.
func removeStale(parent string) {
	entries, err := os.ReadDir(parent)
	if err != nil {
		return
	}
	for _, entry := range entries {
		info, err := entry.Info()
		if err == nil && strings.HasPrefix(entry.Name(), temporaryName) && time.Since(info.ModTime()) > staleAfter {
			os.RemoveAll(filepath.Join(parent, entry.Name()))
		}
	}
}

// check refuses a directory hadley should not run from: what lies there runs as the user, so it must be the user's
// alone, and a part may be gone if something cleaned up the cache.
func check(dir string) error {
	for _, path := range []string{filepath.Dir(dir), dir} {
		info, err := os.Lstat(path)
		if err != nil {
			return err
		}
		if !info.IsDir() || !private(info) {
			return fmt.Errorf("%s is not a directory of this user alone; delete it and start again", path)
		}
	}
	parts := []string{
		executable(dir, "bun"),
		executable(dir, "pagefind"),
		filepath.Join(dir, "app", "hadley.js"),
		filepath.Join(dir, "app", "node_modules"),
	}
	for _, part := range parts {
		if _, err := os.Stat(part); err != nil {
			return fmt.Errorf("%s is incomplete; delete it and start again", dir)
		}
	}
	return nil
}

// settle moves the finished directory from to its place. Another start may have got there first, which is as good, and
// check looks at whatever stands there. Windows refuses the move while a virus scanner still reads a file just written,
// so it is tried for a few seconds.
func settle(from, to string) error {
	var err error
	for range settleAttempts {
		if err = os.Rename(from, to); err == nil {
			return nil
		}
		if _, statErr := os.Stat(to); statErr == nil {
			return nil
		}
		time.Sleep(settleWait)
	}
	return err
}

// unpack writes the regular files of a tar.gz into dir with their permissions. An archive holds nothing else, and no
// path out of dir: the payload is hadley's own, and anything else in it means it is not.
func unpack(archive io.Reader, dir string) error {
	gz, err := gzip.NewReader(archive)
	if err != nil {
		return err
	}
	files := tar.NewReader(gz)
	for {
		entry, err := files.Next()
		if errors.Is(err, io.EOF) {
			return nil
		}
		if err != nil {
			return err
		}
		name := filepath.FromSlash(entry.Name)
		if !filepath.IsLocal(name) {
			return fmt.Errorf("the archive names %q, outside its directory", entry.Name)
		}
		if entry.Typeflag != tar.TypeReg {
			return fmt.Errorf("the archive holds %q, which is no regular file", entry.Name)
		}
		if err := write(filepath.Join(dir, name), files, entry.FileInfo().Mode().Perm()); err != nil {
			return err
		}
	}
}

func write(path string, content io.Reader, mode os.FileMode) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	file, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, mode)
	if err != nil {
		return err
	}
	if _, err := io.Copy(file, content); err != nil {
		file.Close()
		return err
	}
	return file.Close()
}
