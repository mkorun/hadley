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

func TestBunGetsItsOptionsFromTheProgramOnly(t *testing.T) {
	env := strings.Join(bunEnv([]string{"PATH=/bin", "BUN_OPTIONS=--preload ./hook.ts", "bun_config_x=1"}, "/c"), " ")
	if strings.Contains(strings.ToUpper(env), "BUN_") || !strings.Contains(env, "PATH=/bin") {
		t.Errorf("got %s", env)
	}
	if !strings.Contains(env, "PAGEFIND_BINARY_PATH=") {
		t.Errorf("no Pagefind in %s", env)
	}
	args := strings.Join(bunArgs("/c", []string{"dev"}), " ")
	for _, want := range []string{"--no-env-file", "--no-install", "--config=", "hadley.js dev"} {
		if !strings.Contains(args, want) {
			t.Errorf("no %s in %s", want, args)
		}
	}
}

// whole makes the directory of a version as install leaves it, and returns it.
func whole(t *testing.T) string {
	t.Helper()
	parent := filepath.Join(t.TempDir(), "hadley")
	dir := filepath.Join(parent, "1")
	for _, part := range []string{executable(dir, "bun"), executable(dir, "pagefind"),
		filepath.Join(dir, "app", "hadley.js"), filepath.Join(dir, "app", "node_modules", "a")} {
		if err := os.MkdirAll(filepath.Dir(part), 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(part, nil, 0o700); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Chmod(parent, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	return dir
}

func TestCheckTakesAWholeDirectory(t *testing.T) {
	if err := check(whole(t)); err != nil {
		t.Error(err)
	}
}

func TestCheckRefusesADirectoryWithAPartGone(t *testing.T) {
	dir := whole(t)
	if err := os.RemoveAll(filepath.Join(dir, "app", "node_modules")); err != nil {
		t.Fatal(err)
	}
	if err := check(dir); err == nil || !strings.Contains(err.Error(), "incomplete") {
		t.Errorf("got %v", err)
	}
}

func TestCheckRefusesALink(t *testing.T) {
	dir := whole(t)
	link := filepath.Join(filepath.Dir(dir), "2")
	if err := os.Symlink(dir, link); err != nil {
		t.Skip(err)
	}
	if err := check(link); err == nil || !strings.Contains(err.Error(), "not a directory") {
		t.Errorf("got %v", err)
	}
}

func TestCheckRefusesADirectoryOthersCanWriteTo(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows shows no such permissions")
	}
	dir := whole(t)
	for _, path := range []string{dir, filepath.Dir(dir)} {
		if err := os.Chmod(path, 0o777); err != nil {
			t.Fatal(err)
		}
		if err := check(dir); err == nil || !strings.Contains(err.Error(), "not a directory") {
			t.Errorf("%s: got %v", path, err)
		}
		if err := os.Chmod(path, 0o700); err != nil {
			t.Fatal(err)
		}
	}
}
