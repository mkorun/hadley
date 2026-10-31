package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLatestTakesAPrereleaseOnlyForAPrerelease(t *testing.T) {
	releases := []release{
		{Tag: "v9.0.0", Draft: true},
		{Tag: "v2.0.0-rc.1", Prerelease: true},
		{Tag: "v1.0.0"},
	}
	for current, want := range map[string]string{"1.0.0": "1.0.0", "2.0.0-rc.0": "2.0.0-rc.1", "0.9.0": "1.0.0"} {
		got, err := latest(releases, current)
		if err != nil || got != want {
			t.Errorf("%s: got %s, %v", current, got, err)
		}
	}
}

func TestLatestRefusesWhatIsNoVersion(t *testing.T) {
	for _, tag := range []string{"v1/../../x", "latest", "v1.2"} {
		if got, err := latest([]release{{Tag: tag}}, "1.0.0"); err == nil {
			t.Errorf("%s: got %s", tag, got)
		}
	}
	if _, err := latest(nil, "1.0.0"); err == nil {
		t.Error("no refusal without a release")
	}
}

func TestChecksumOfReadsTheLineOfTheName(t *testing.T) {
	sums := []byte("aaa  hadley-1-linux-amd64\nbbb  hadley-1-linux-arm64\n")
	if got, err := checksumOf(sums, "hadley-1-linux-arm64"); err != nil || got != "bbb" {
		t.Errorf("got %s, %v", got, err)
	}
	if _, err := checksumOf(sums, "hadley-1-plan9-amd64"); err == nil {
		t.Error("no refusal")
	}
}

// serve answers as GitHub does for a release newest, whose program has the bytes body and SHA256SUMS names checksum.
func serve(t *testing.T, newest, body, checksum string) source {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("/releases", func(w http.ResponseWriter, _ *http.Request) {
		json.NewEncoder(w).Encode([]release{{Tag: "v" + newest}})
	})
	mux.HandleFunc("/download/v"+newest+"/SHA256SUMS", func(w http.ResponseWriter, _ *http.Request) {
		fmt.Fprintf(w, "%s  %s\n", checksum, programName(newest))
	})
	mux.HandleFunc("/download/v"+newest+"/"+programName(newest), func(w http.ResponseWriter, _ *http.Request) {
		fmt.Fprint(w, body)
	})
	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)
	return source{server.URL + "/releases", server.URL + "/download", server.Client()}
}

// installed makes a program and a cache with a version in it, and returns their paths.
func installed(t *testing.T) (program, cache string) {
	t.Helper()
	dir := t.TempDir()
	program = filepath.Join(dir, "hadley")
	cache = filepath.Join(dir, "cache")
	if err := os.WriteFile(program, []byte("old"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(cache, "1.0.0-abc"), 0o700); err != nil {
		t.Fatal(err)
	}
	return program, cache
}

func read(t *testing.T, path string) string {
	t.Helper()
	body, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return string(body)
}

func TestUpgradePutsTheNewProgramInPlaceAndEmptiesTheCache(t *testing.T) {
	program, cache := installed(t)
	if err := upgrade(serve(t, "2.0.0", "new", sum([]byte("new"))), program, cache); err != nil {
		t.Fatal(err)
	}
	if got := read(t, program); got != "new" {
		t.Errorf("program is %q", got)
	}
	if left, _ := os.ReadDir(cache); len(left) != 0 {
		t.Errorf("left %v", left)
	}
	if left, _ := os.ReadDir(filepath.Dir(program)); len(left) != 2 {
		t.Errorf("beside the program: %v", left)
	}
}

func TestUpgradeKeepsTheProgramWhenTheChecksumDiffers(t *testing.T) {
	program, cache := installed(t)
	err := upgrade(serve(t, "2.0.0", "new", sum([]byte("other"))), program, cache)
	if err == nil || !strings.Contains(err.Error(), "checksum differs") {
		t.Fatalf("got %v", err)
	}
	if got := read(t, program); got != "old" {
		t.Errorf("program is %q", got)
	}
	if left, _ := os.ReadDir(cache); len(left) != 1 {
		t.Errorf("the cache went: %v", left)
	}
}

func TestUpgradeLeavesTheLatestVersionAlone(t *testing.T) {
	version = "2.0.0"
	t.Cleanup(func() { version = "devel" })
	program, cache := installed(t)
	if err := upgrade(serve(t, "2.0.0", "new", sum([]byte("new"))), program, cache); err != nil {
		t.Fatal(err)
	}
	if got := read(t, program); got != "old" {
		t.Errorf("program is %q", got)
	}
	if left, _ := os.ReadDir(cache); len(left) != 1 {
		t.Errorf("the cache went: %v", left)
	}
}
