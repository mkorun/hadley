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

func TestLatestIsTheHighestAPrereleaseOnlyForAPrerelease(t *testing.T) {
	releases := []release{
		{Tag: "v1.0.0"},
		{Tag: "v2.0.0-rc.2", Prerelease: true},
		{Tag: "v2.0.0-rc.10", Prerelease: true},
		{Tag: "v0.9.0"},
	}
	for current, want := range map[string]string{"1.0.0": "1.0.0", "2.0.0-rc.1": "2.0.0-rc.10", "0.9.0": "1.0.0"} {
		got, err := latest(releases, current)
		if err != nil || got != want {
			t.Errorf("%s: got %s, %v", current, got, err)
		}
	}
}

func TestLatestTakesOnlyTheTagOfARelease(t *testing.T) {
	for _, tag := range []string{"1.0.0", "v1/../../x", "latest", "v1.2"} {
		if got, err := latest([]release{{Tag: tag}}, "1.0.0"); err == nil {
			t.Errorf("%s: got %s", tag, got)
		}
	}
	if _, err := latest(nil, "1.0.0"); err == nil {
		t.Error("no refusal without a release")
	}
}

func TestOlderKeepsTheOrderOfVersions(t *testing.T) {
	inOrder := []string{"0.1.0-rc.2", "0.1.0-rc.10", "0.1.0", "0.2.0", "0.10.0", "1.0.0-alpha", "1.0.0-alpha.1",
		"1.0.0-beta", "1.0.0"}
	for i, a := range inOrder {
		for j, b := range inOrder {
			if got, want := older(a, b), i < j; got != want {
				t.Errorf("older(%s, %s) is %v", a, b, got)
			}
		}
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

// running names the directory of the version the tests run as.
const running = "1.0.0-abc"

// installed makes a program, and a cache with its version, an older one and an unpacking, and returns their paths.
func installed(t *testing.T) (program, cache string) {
	t.Helper()
	dir := t.TempDir()
	program = filepath.Join(dir, "hadley")
	cache = filepath.Join(dir, "cache")
	if err := os.WriteFile(program, []byte("old"), 0o755); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{running, "0.9.0-abc", temporaryName + "x"} {
		if err := os.MkdirAll(filepath.Join(cache, name), 0o700); err != nil {
			t.Fatal(err)
		}
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

func TestUpgradePutsTheNewProgramInPlaceAndKeepsTheVersionThatRuns(t *testing.T) {
	version = "1.0.0"
	program, cache := installed(t)
	if err := upgrade(serve(t, "2.0.0", "new", sum([]byte("new"))), program, cache, running); err != nil {
		t.Fatal(err)
	}
	if got := read(t, program); got != "new" {
		t.Errorf("program is %q", got)
	}
	left, err := os.ReadDir(cache)
	if err != nil {
		t.Fatal(err)
	}
	if len(left) != 2 || left[0].Name() != temporaryName+"x" || left[1].Name() != running {
		t.Errorf("left %v, not the version that runs and an unpacking", left)
	}
	beside, err := filepath.Glob(filepath.Join(filepath.Dir(program), ".hadley-upgrade-*"))
	if err != nil || len(beside) != 0 {
		t.Errorf("beside the program: %v, %v", beside, err)
	}
}

func TestUpgradeKeepsTheProgramWhenTheChecksumDiffers(t *testing.T) {
	version = "1.0.0"
	program, cache := installed(t)
	err := upgrade(serve(t, "2.0.0", "new", sum([]byte("other"))), program, cache, running)
	if err == nil || !strings.Contains(err.Error(), "checksum differs") {
		t.Fatalf("got %v", err)
	}
	if got := read(t, program); got != "old" {
		t.Errorf("program is %q", got)
	}
	if left, _ := os.ReadDir(cache); len(left) != 3 {
		t.Errorf("the cache went: %v", left)
	}
}

func TestUpgradeLeavesAProgramOfWingetToWingetWithoutAsking(t *testing.T) {
	program := `C:\Users\me\AppData\Local\Microsoft\WinGet\Packages\mkorun.hadley__DefaultSource\hadley.exe`
	// a source without a client: any request would panic
	err := upgrade(source{}, program, t.TempDir(), running)
	if err == nil || !strings.Contains(err.Error(), "winget upgrade mkorun.hadley") {
		t.Fatalf("got %v", err)
	}
}

func TestUnderWingetIsTheFolderOfItsPackages(t *testing.T) {
	for program, want := range map[string]bool{
		`C:\Users\me\AppData\Local\Microsoft\WinGet\Packages\mkorun.hadley__DefaultSource\hadley.exe`:     true,
		`C:\Program Files\WinGet\Packages\mkorun.hadley_Microsoft.Winget.Source_8wekyb3d8bbwe\hadley.exe`: true,
		`c:\users\me\appdata\local\microsoft\winget\packages\x\hadley.exe`:                                true,
		`C:\Users\me\Downloads\winget\hadley.exe`:                                                         false,
		`C:\Users\me\Packages\hadley.exe`:                                                                 false,
		`/home/me/.local/bin/hadley`:                                                                      false,
	} {
		if got := underWinget(program); got != want {
			t.Errorf("%s: got %v", program, got)
		}
	}
}

func TestUpgradeLeavesAVersionAsNewAsTheLatestOrNewerAlone(t *testing.T) {
	for _, current := range []string{"2.0.0", "3.0.0"} {
		version = current
		t.Cleanup(func() { version = "1.0.0" })
		program, cache := installed(t)
		if err := upgrade(serve(t, "2.0.0", "new", sum([]byte("new"))), program, cache, running); err != nil {
			t.Fatal(err)
		}
		if got := read(t, program); got != "old" {
			t.Errorf("%s: program is %q", current, got)
		}
		if left, _ := os.ReadDir(cache); len(left) != 3 {
			t.Errorf("%s: the cache went: %v", current, left)
		}
	}
}
