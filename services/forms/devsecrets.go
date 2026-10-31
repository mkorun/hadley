package forms

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

// DevSecretsFile holds the secrets of a service started with -dev, in its data directory; the moderation CLI reads
// the admin token from it (CONTRACT.md C10, C11).
const DevSecretsFile = "dev-secrets.json"

// DevSecrets are the secrets of a local service: made at random on its first start, kept for the next.
type DevSecrets struct {
	AdminToken string `json:"adminToken"`
	HMACSecret string `json:"hmacSecret"`
}

// LoadDevSecrets creates dataDir if it is missing and returns the secrets in it, making them first if there are none.
// A file of secrets others can read is refused.
func LoadDevSecrets(dataDir string) (DevSecrets, error) {
	var secrets DevSecrets
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		return secrets, err
	}
	path := filepath.Join(dataDir, DevSecretsFile)
	switch made, err := publishNew(path); {
	case err != nil:
		return secrets, err
	case made != nil:
		return *made, nil
	}
	info, err := os.Stat(path)
	if err != nil {
		return secrets, err
	}
	if info.Mode().Perm()&0o077 != 0 {
		return secrets, fmt.Errorf("%s can be read by others (%v): chmod 600 it, or delete it to make new ones", path,
			info.Mode().Perm())
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return secrets, err
	}
	if err := json.Unmarshal(data, &secrets); err != nil || secrets.AdminToken == "" || secrets.HMACSecret == "" {
		return secrets, fmt.Errorf("%s: not the secrets of a local service; delete it to make new ones", path)
	}
	return secrets, nil
}

// publishNew makes secrets and puts them at path, written whole before they appear there; nil when path exists
// already, made by another start at the same time or before.
func publishNew(path string) (*DevSecrets, error) {
	temp, err := os.CreateTemp(filepath.Dir(path), DevSecretsFile+".*") // mode 0600
	if err != nil {
		return nil, err
	}
	defer os.Remove(temp.Name())
	secrets := DevSecrets{AdminToken: randomHex(), HMACSecret: randomHex()}
	data, _ := json.Marshal(secrets)
	_, err = temp.Write(append(data, '\n'))
	if err := errors.Join(err, temp.Sync(), temp.Close()); err != nil {
		return nil, err
	}
	if err := os.Link(temp.Name(), path); err != nil { // fails if path exists: it is never replaced
		if errors.Is(err, os.ErrExist) {
			return nil, nil
		}
		return nil, err
	}
	return &secrets, nil
}

func randomHex() string {
	b := make([]byte, 32)
	rand.Read(b) // never returns an error (crypto/rand)
	return hex.EncodeToString(b)
}
