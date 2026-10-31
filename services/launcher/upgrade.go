package main

import (
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
	"strings"
	"time"
)

const (
	releasesURL = "https://api.github.com/repos/mkorun/hadley/releases?per_page=30"
	downloadURL = "https://github.com/mkorun/hadley/releases/download"
	// Far more than a program, and a limit on what a wrong answer can fill the memory with.
	maxDownload    = 512 << 20
	upgradeTimeout = 15 * time.Minute
)

var releaseVersion = regexp.MustCompile(`^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$`)

type release struct {
	Tag        string `json:"tag_name"`
	Draft      bool   `json:"draft"`
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

// latest is the version a program of version current upgrades to: the newest of the releases, which GitHub lists newest
// first, a prerelease only for a prerelease.
func latest(releases []release, current string) (string, error) {
	for _, r := range releases {
		if r.Draft || (r.Prerelease && !strings.Contains(current, "-")) {
			continue
		}
		found := strings.TrimPrefix(r.Tag, "v")
		if !releaseVersion.MatchString(found) {
			return "", fmt.Errorf("the release %q has no version", r.Tag)
		}
		return found, nil
	}
	return "", errors.New("there is no release yet")
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

// upgrade puts the program of the latest release in the place of program, once its checksum fits, and deletes what the
// versions before it unpacked below cache.
func upgrade(from source, program, cache string) error {
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
	if newest == version {
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
	removeVersions(cache)
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

// removeVersions deletes what is in cache. It only frees space: a directory another hadley still runs from may stay,
// and a directory that is gone is unpacked again.
func removeVersions(cache string) {
	entries, err := os.ReadDir(cache)
	if err != nil {
		return
	}
	for _, entry := range entries {
		os.RemoveAll(filepath.Join(cache, entry.Name()))
	}
}
