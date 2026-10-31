package main

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
)

type entry struct {
	name string
	body string
	mode int64
	kind byte
}

func archive(t *testing.T, entries ...entry) []byte {
	t.Helper()
	var out bytes.Buffer
	gz := gzip.NewWriter(&out)
	files := tar.NewWriter(gz)
	for _, e := range entries {
		kind := e.kind
		if kind == 0 {
			kind = tar.TypeReg
		}
		header := &tar.Header{Name: e.name, Mode: e.mode, Size: int64(len(e.body)), Typeflag: kind}
		if err := files.WriteHeader(header); err != nil {
			t.Fatal(err)
		}
		if _, err := files.Write([]byte(e.body)); err != nil {
			t.Fatal(err)
		}
	}
	if err := files.Close(); err != nil {
		t.Fatal(err)
	}
	if err := gz.Close(); err != nil {
		t.Fatal(err)
	}
	return out.Bytes()
}

func sum(payload []byte) string {
	got := sha256.Sum256(payload)
	return hex.EncodeToString(got[:])
}

func TestUnpackWritesFilesWithTheirModes(t *testing.T) {
	dir := t.TempDir()
	payload := archive(t,
		entry{name: "bun", body: "program", mode: 0o755},
		entry{name: "app/node_modules/a/b.js", body: "code", mode: 0o644})
	if err := unpack(bytes.NewReader(payload), dir); err != nil {
		t.Fatal(err)
	}
	body, err := os.ReadFile(filepath.Join(dir, "app", "node_modules", "a", "b.js"))
	if err != nil || string(body) != "code" {
		t.Fatalf("got %q, %v", body, err)
	}
	info, err := os.Stat(filepath.Join(dir, "bun"))
	if err != nil {
		t.Fatal(err)
	}
	if runtime.GOOS != "windows" && info.Mode().Perm() != 0o755 {
		t.Errorf("mode %v, not 0755", info.Mode().Perm())
	}
}

func TestUnpackRefusesWhatIsNotAPlainFileInItsDirectory(t *testing.T) {
	for _, bad := range []entry{
		{name: "../outside", body: "x", mode: 0o644},
		{name: "a/../../outside", body: "x", mode: 0o644},
		{name: "/outside", body: "x", mode: 0o644},
		{name: "link", mode: 0o777, kind: tar.TypeSymlink},
		{name: "directory/", mode: 0o755, kind: tar.TypeDir},
	} {
		parent := t.TempDir()
		dir := filepath.Join(parent, "dir")
		if err := os.Mkdir(dir, 0o755); err != nil {
			t.Fatal(err)
		}
		if err := unpack(bytes.NewReader(archive(t, bad)), dir); err == nil {
			t.Errorf("%s: no refusal", bad.name)
		}
		if _, err := os.Stat(filepath.Join(parent, "outside")); err == nil {
			t.Errorf("%s: wrote outside the directory", bad.name)
		}
	}
}

func TestInstallRefusesADamagedProgramAndLeavesNothing(t *testing.T) {
	parent := t.TempDir()
	payload := archive(t, entry{name: "bun", body: "program", mode: 0o755})
	err := install(payload, strings.Repeat("0", 64), filepath.Join(parent, "1"))
	if err == nil || !strings.Contains(err.Error(), "damaged") {
		t.Fatalf("got %v", err)
	}
	if left, _ := os.ReadDir(parent); len(left) != 0 {
		t.Errorf("left %v", left)
	}
}

func TestInstallLeavesNoHalfDirectory(t *testing.T) {
	parent := t.TempDir()
	payload := archive(t, entry{name: "bun", body: "program", mode: 0o755}, entry{name: "../bad", mode: 0o644})
	if err := install(payload, sum(payload), filepath.Join(parent, "1")); err == nil {
		t.Fatal("no refusal")
	}
	if left, _ := os.ReadDir(parent); len(left) != 0 {
		t.Errorf("left %v", left)
	}
}

func TestTwoFirstStartsAtOnceBothGetTheDirectory(t *testing.T) {
	parent := t.TempDir()
	dir := filepath.Join(parent, "1")
	payload := archive(t, entry{name: "bun", body: "program", mode: 0o755})
	var starts sync.WaitGroup
	failures := make(chan error, 8)
	for range 8 {
		starts.Go(func() {
			if err := install(payload, sum(payload), dir); err != nil {
				failures <- err
			}
		})
	}
	starts.Wait()
	close(failures)
	for err := range failures {
		t.Error(err)
	}
	left, err := os.ReadDir(parent)
	if err != nil {
		t.Fatal(err)
	}
	if len(left) != 1 || left[0].Name() != "1" {
		t.Errorf("left %v", left)
	}
}

func TestBunReadsNothingOfTheSite(t *testing.T) {
	got := strings.Join(bunArgs("/c", []string{"dev", "--port", "8000"}), " ")
	want := "bun --no-env-file --config=" + filepath.Join("/c", "app", "bunfig.toml") + " " +
		filepath.Join("/c", "app", "hadley.js") + " dev --port 8000"
	if got != want {
		t.Errorf("got %s", got)
	}
}
