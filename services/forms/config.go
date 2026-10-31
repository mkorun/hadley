package forms

import (
	"encoding/hex"
	"fmt"
	"math"
	"strings"
)

// Config is the service's configuration (CONTRACT.md C3), read once from the environment at startup.
type Config struct {
	DataDir         string
	AdminToken      string
	HMACSecret      string
	Origins         []string // CORS_ORIGINS, SITE_ORIGINS, DEV_ORIGIN, in this order
	Cost            int      // PBKDF2 iterations of a challenge
	KeyPrefix       string   // hexadecimal digits a solution's derived key must begin with
	Host            string   // the address the listener binds to
	Port            int
	RateLimitMax    float64
	RateLimitWindow float64 // seconds
	TokenTTL        float64 // seconds
	MaxQueueEntries float64
	MaxQueueBytes   float64
	NtfyURL         string
	NtfyToken       string
	SiteMeta        string // the site's meta.json, which names an article in a notification (notify.go)
}

// ConfigFrom reads the configuration from lookup (os.LookupEnv). Its checks and messages are the replaced service's,
// in its order; beyond them, a value the service cannot run with stops it here, not at the first request:
// PBKDF2_COST must be a whole number from 1, PORT one from 0 to 65535, PBKDF2_KEY_PREFIX hexadecimal digits.
func ConfigFrom(lookup func(string) (string, bool)) (Config, error) {
	value := func(key string) string {
		v, _ := lookup(key)
		return v
	}
	origins := func(key string) []string {
		var list []string
		for origin := range strings.SplitSeq(value(key), ",") {
			if origin = strings.TrimFunc(origin, isSpaceJS); origin != "" {
				list = append(list, origin)
			}
		}
		return list
	}
	var c Config
	c.Origins = append(append(origins("CORS_ORIGINS"), origins("SITE_ORIGINS")...), origins("DEV_ORIGIN")...)
	if len(c.Origins) == 0 {
		return c, fmt.Errorf("No CORS origins configured (set CORS_ORIGINS, SITE_ORIGINS, or DEV_ORIGIN)")
	}

	var err error
	required := func(key string) string {
		v := value(key)
		if v == "" && err == nil {
			err = fmt.Errorf("Missing required env variable: %s", key)
		}
		return v
	}
	number := func(key string, fallback float64) float64 {
		v := value(key)
		if v == "" || err != nil {
			return fallback
		}
		n := stringToNumber(v)
		if math.IsNaN(n) || math.IsInf(n, 0) {
			err = fmt.Errorf("Env variable %s must be a number, got: %s", key, v)
		}
		return n
	}
	whole := func(key string, n float64, low, high int) int {
		if err == nil && (n != math.Trunc(n) || n < float64(low) || n > float64(high)) {
			err = fmt.Errorf("Env variable %s must be a whole number from %d to %d, got: %s", key, low, high, value(key))
		}
		return int(n)
	}

	c.DataDir = required("DATA_DIR")
	c.AdminToken = required("ADMIN_TOKEN")
	c.HMACSecret = required("HMAC_SECRET")
	c.Cost = whole("PBKDF2_COST", number("PBKDF2_COST", 50_000), 1, math.MaxInt32)
	c.KeyPrefix = "00"
	if prefix, ok := lookup("PBKDF2_KEY_PREFIX"); ok {
		c.KeyPrefix = prefix
	}
	c.Port = whole("PORT", number("PORT", 9001), 0, 65535)
	c.RateLimitMax = number("RATE_LIMIT_MAX", 10)
	c.RateLimitWindow = number("RATE_LIMIT_WINDOW_SEC", 900)
	c.TokenTTL = number("TOKEN_TTL_SEC", 900)
	c.MaxQueueEntries = number("MAX_QUEUE_ENTRIES", 1000)
	c.MaxQueueBytes = number("MAX_QUEUE_BYTES", 10_485_760)
	c.NtfyURL = value("NTFY_URL")
	c.NtfyToken = value("NTFY_TOKEN")
	c.SiteMeta = value("SITE_META")
	if err != nil {
		return c, err
	}
	if _, hexErr := hex.DecodeString(c.KeyPrefix + strings.Repeat("0", len(c.KeyPrefix)%2)); hexErr != nil {
		return c, fmt.Errorf("Env variable PBKDF2_KEY_PREFIX must be hexadecimal digits, got: %s", c.KeyPrefix)
	}
	c.Host = "127.0.0.1"
	if host := value("HOST"); host != "" {
		c.Host = host
	}
	return c, nil
}
