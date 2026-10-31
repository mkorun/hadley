package forms

import (
	"os"
	"path/filepath"
	"sync"
	"testing"
)

func TestDevSecretsAreMadeOnceAndKept(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "forms")
	first, err := LoadDevSecrets(dir)
	if err != nil || len(first.AdminToken) != 64 || len(first.HMACSecret) != 64 || first.AdminToken == first.HMACSecret {
		t.Fatalf("%+v %v", first, err)
	}
	info, _ := os.Stat(filepath.Join(dir, DevSecretsFile))
	if info.Mode().Perm() != 0o600 {
		t.Errorf("mode %v", info.Mode().Perm())
	}
	if again, err := LoadDevSecrets(dir); err != nil || again != first {
		t.Errorf("second start: %+v %v", again, err)
	}
}

func TestDevSecretsRefuseABrokenFile(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, DevSecretsFile), []byte(`{"adminToken":""}`), 0o600)
	if _, err := LoadDevSecrets(dir); err == nil {
		t.Error("took a file without secrets")
	}
}

func TestDevSecretsRefuseAFileOthersCanRead(t *testing.T) {
	dir := t.TempDir()
	if _, err := LoadDevSecrets(dir); err != nil {
		t.Fatal(err)
	}
	os.Chmod(filepath.Join(dir, DevSecretsFile), 0o644)
	if _, err := LoadDevSecrets(dir); err == nil {
		t.Error("took a file others can read")
	}
}

// review 2026-10-27 (second): starts at the same time get the same secrets, never a half-written file
func TestDevSecretsMadeOnceUnderConcurrency(t *testing.T) {
	dir := t.TempDir()
	results := make([]DevSecrets, 20)
	errs := make([]error, 20)
	var wg sync.WaitGroup
	start := make(chan struct{})
	for i := range results {
		wg.Go(func() {
			<-start
			results[i], errs[i] = LoadDevSecrets(dir)
		})
	}
	close(start)
	wg.Wait()
	for i := range results {
		if errs[i] != nil || results[i] != results[0] {
			t.Errorf("start %d: %+v %v, first %+v", i, results[i], errs[i], results[0])
		}
	}
	entries, _ := os.ReadDir(dir)
	if len(entries) != 1 {
		t.Errorf("left in the directory: %v", entries)
	}
}
