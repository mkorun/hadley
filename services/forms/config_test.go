package forms

import (
	"maps"
	"strings"
	"testing"
)

func lookupFrom(env map[string]string) func(string) (string, bool) {
	return func(key string) (string, bool) { v, ok := env[key]; return v, ok }
}

func TestConfigDefaultsAndOrigins(t *testing.T) {
	c, err := ConfigFrom(lookupFrom(map[string]string{
		"DATA_DIR": "d", "ADMIN_TOKEN": "a", "HMAC_SECRET": "h",
		"CORS_ORIGINS": " https://a , ,https://b", "DEV_ORIGIN": "https://c", "SITE_ORIGINS": "https://a",
	}))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(c.Origins, " ") != "https://a https://b https://a https://c" {
		t.Errorf("origins %q", c.Origins)
	}
	if c.Cost != 50_000 || c.KeyPrefix != "00" || c.Port != 9001 || c.Host != "127.0.0.1" || c.RateLimitMax != 10 ||
		c.RateLimitWindow != 900 || c.TokenTTL != 900 || c.MaxQueueEntries != 1000 || c.MaxQueueBytes != 10_485_760 {
		t.Errorf("defaults %+v", c)
	}
}

func TestConfigRefuses(t *testing.T) {
	base := map[string]string{"DATA_DIR": "d", "ADMIN_TOKEN": "a", "HMAC_SECRET": "h", "CORS_ORIGINS": "https://a"}
	for change, want := range map[string]string{
		"CORS_ORIGINS=":        "No CORS origins configured (set CORS_ORIGINS, SITE_ORIGINS, or DEV_ORIGIN)",
		"DATA_DIR=":            "Missing required env variable: DATA_DIR",
		"HMAC_SECRET=":         "Missing required env variable: HMAC_SECRET",
		"PORT=abc":             "Env variable PORT must be a number, got: abc",
		"RATE_LIMIT_MAX=1e999": "Env variable RATE_LIMIT_MAX must be a number, got: 1e999",
		"PBKDF2_COST=1.5":      "Env variable PBKDF2_COST must be a whole number from 1 to 2147483647, got: 1.5",
		"PORT=70000":           "Env variable PORT must be a whole number from 0 to 65535, got: 70000",
		"PBKDF2_KEY_PREFIX=0g": "Env variable PBKDF2_KEY_PREFIX must be hexadecimal digits, got: 0g",
	} {
		env := map[string]string{}
		maps.Copy(env, base)
		key, value, _ := strings.Cut(change, "=")
		env[key] = value
		if _, err := ConfigFrom(lookupFrom(env)); err == nil || err.Error() != want {
			t.Errorf("%s: %v, want %q", change, err, want)
		}
	}
}

func TestConfigTakesAnEmptyPrefix(t *testing.T) {
	c, err := ConfigFrom(lookupFrom(map[string]string{
		"DATA_DIR": "d", "ADMIN_TOKEN": "a", "HMAC_SECRET": "h", "CORS_ORIGINS": "o", "PBKDF2_KEY_PREFIX": "", "PORT": "0x10",
	}))
	if err != nil || c.KeyPrefix != "" || c.Port != 16 {
		t.Errorf("%+v %v", c, err)
	}
}
