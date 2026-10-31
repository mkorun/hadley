package main

import (
	"cmp"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"time"
)

const (
	releasesURL = "https://api.github.com/repos/mkorun/hadley/releases?per_page=100"
	downloadURL = "https://github.com/mkorun/hadley/releases/download"
	wingetID    = "mkorun.hadley"
	// Far more than a program, and a limit on what a wrong answer can fill the memory with.
	maxDownload    = 512 << 20
	upgradeTimeout = 15 * time.Minute
)

// releaseTag is the tag release.yml requires. A release under another name is none, and its version goes into a URL.
var releaseTag = regexp.MustCompile(`^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$`)

type release struct {
	Tag        string `json:"tag_name"`
	Prerelease bool   `json:"prerelease"`
}

// source is where upgrade finds a release.
type source struct {
	releases, downloads string
	client              *http.Client
}

func github() source {
	return source{releasesURL, downloadURL, &http.Client{
		Timeout: upgradeTimeout,
		CheckRedirect: func(request *http.Request, _ []*http.Request) error {
			if request.URL.Scheme != "https" {
				return errors.New("a redirect to an address without https")
			}
			return nil
		},
	}}
}

func (s source) fetch(url string) ([]byte, error) {
	request, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("User-Agent", "hadley/"+version)
	response, err := s.client.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("%s: %s", url, response.Status)
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, maxDownload+1))
	if err != nil {
		return nil, err
	}
	if len(body) > maxDownload {
		return nil, fmt.Errorf("%s: more than a program can be", url)
	}
	return body, nil
}

// latest is the highest version of the releases, a prerelease only for a program of a prerelease.
func latest(releases []release, current string) (string, error) {
	found := ""
	for _, r := range releases {
		if !releaseTag.MatchString(r.Tag) || (r.Prerelease && !strings.Contains(current, "-")) {
			continue
		}
		if candidate := r.Tag[1:]; found == "" || older(found, candidate) {
			found = candidate
		}
	}
	if found == "" {
		return "", errors.New("there is no release yet")
	}
	return found, nil
}

// older says whether version a comes before version b, by the order of Semantic Versioning: numbers as numbers, and a
// prerelease before its release.
func older(a, b string) bool {
	aCore, aPre, aIsPre := strings.Cut(a, "-")
	bCore, bPre, bIsPre := strings.Cut(b, "-")
	if order := compareFields(strings.Split(aCore, "."), strings.Split(bCore, ".")); order != 0 {
		return order < 0
	}
	if aIsPre != bIsPre {
		return aIsPre
	}
	return compareFields(strings.Split(aPre, "."), strings.Split(bPre, ".")) < 0
}

// compareFields compares dotted fields in turn: numbers by value and before words, and a shorter list before a longer.
func compareFields(a, b []string) int {
	for i := range min(len(a), len(b)) {
		aNumber, aErr := strconv.Atoi(a[i])
		bNumber, bErr := strconv.Atoi(b[i])
		var order int
		switch {
		case aErr == nil && bErr == nil:
			order = cmp.Compare(aNumber, bNumber)
		case aErr == nil:
			order = -1
		case bErr == nil:
			order = 1
		default:
			order = cmp.Compare(a[i], b[i])
		}
		if order != 0 {
			return order
		}
	}
	return cmp.Compare(len(a), len(b))
}

// checksumOf reads the line of name in SHA256SUMS.
func checksumOf(sums []byte, name string) (string, error) {
	for line := range strings.SplitSeq(string(sums), "\n") {
		if checksum, file, ok := strings.Cut(line, "  "); ok && file == name {
			return checksum, nil
		}
	}
	return "", fmt.Errorf("SHA256SUMS does not name %s: no program for this system", name)
}

func programName(version string) string {
	name := "hadley-" + version + "-" + runtime.GOOS + "-" + runtime.GOARCH
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	return name
}

// underWinget says whether winget put program in place: a user's install and a machine's both end in this folder, and
// winget would go on listing the version it installed.
func underWinget(program string) bool {
	return strings.Contains(strings.ToLower(program), `\winget\packages\`)
}

// upgrade puts the program of the latest release in the place of program, once its checksum fits, and deletes what
// older versions unpacked below cache; running is what this one unpacked.
func upgrade(from source, program, cache, running string) error {
	if underWinget(program) {
		return fmt.Errorf("winget installed this program; update it with: winget upgrade %s", wingetID)
	}
	list, err := from.fetch(from.releases)
	if err != nil {
		return err
	}
	var releases []release
	if err := json.Unmarshal(list, &releases); err != nil {
		return fmt.Errorf("the list of releases: %w", err)
	}
	newest, err := latest(releases, version)
	if err != nil {
		return err
	}
	if !older(version, newest) {
		fmt.Printf("hadley %s is the latest version\n", version)
		return nil
	}
	base := from.downloads + "/v" + newest + "/"
	sums, err := from.fetch(base + "SHA256SUMS")
	if err != nil {
		return err
	}
	name := programName(newest)
	want, err := checksumOf(sums, name)
	if err != nil {
		return err
	}
	fmt.Printf("Downloading hadley %s\n", newest)
	body, err := from.fetch(base + name)
	if err != nil {
		return err
	}
	got := sha256.Sum256(body)
	if hex.EncodeToString(got[:]) != want {
		return errors.New("the download is not the program of the release: its checksum differs")
	}
	if err := replace(program, body); err != nil {
		return err
	}
	removeVersions(cache, running)
	fmt.Printf("hadley %s is now %s\n", version, newest)
	return nil
}

// replace writes body beside program, so that the move into its place cannot fail halfway across file systems.
func replace(program string, body []byte) error {
	file, err := os.CreateTemp(filepath.Dir(program), ".hadley-upgrade-")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	if _, err := file.Write(body); err != nil {
		file.Close()
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	if err := os.Chmod(file.Name(), 0o755); err != nil {
		return err
	}
	return swap(file.Name(), program)
}

// removeVersions deletes the versions in cache other than running, which another hadley may still run from, as may a
// first start from its unpacking. It only frees space, so a failure does not matter.
func removeVersions(cache, running string) {
	entries, err := os.ReadDir(cache)
	if err != nil {
		return
	}
	for _, entry := range entries {
		if entry.Name() != running && !strings.HasPrefix(entry.Name(), temporaryName) {
			os.RemoveAll(filepath.Join(cache, entry.Name()))
		}
	}
}
