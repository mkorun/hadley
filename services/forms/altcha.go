package forms

import (
	"crypto/hmac"
	"crypto/pbkdf2"
	"crypto/sha256"
	"crypto/sha512"
	"crypto/subtle"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"hash"
	"io"
	"math"
	"strings"
	"time"
)

// Proof of work as altcha-lib 2.5.0 does it (CONTRACT.md C5): a challenge of PBKDF2 parameters signed with
// HMAC-SHA-256, solved by the first counter whose derived key begins with the prefix.

// newChallenge returns a challenge: random nonce and salt, the configured cost and prefix, and an expiry ttl seconds
// from now, signed with secret.
func newChallenge(c Config, now time.Time, random io.Reader) (*object, error) {
	nonce, salt := make([]byte, 16), make([]byte, 16)
	if _, err := io.ReadFull(random, nonce); err != nil {
		return nil, err
	}
	if _, err := io.ReadFull(random, salt); err != nil {
		return nil, err
	}
	parameters := newObject()
	parameters.set("algorithm", "PBKDF2/SHA-256")
	parameters.set("cost", float64(c.Cost))
	parameters.set("expiresAt", math.Floor((float64(now.UnixMilli())+c.TokenTTL*1000)/1000))
	parameters.set("keyLength", float64(32))
	parameters.set("keyPrefix", c.KeyPrefix)
	parameters.set("nonce", hex.EncodeToString(nonce))
	parameters.set("salt", hex.EncodeToString(salt))
	challenge := newObject()
	challenge.set("parameters", parameters)
	challenge.set("signature", sign(parameters, c.HMACSecret))
	return challenge, nil
}

func sign(parameters any, secret string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(canonicalJS(parameters))
	return hex.EncodeToString(mac.Sum(nil))
}

// errVerification is a challenge or solution the verifier cannot read, which altcha-lib throws on.
var errVerification = errors.New("verification error")

// Verification is altcha-lib's in two steps, so that the service can take a challenge between them: signed, the cheap
// one (not expired, signed, signature valid), then solves, the key derived with the challenge's cost.

// signed returns the parameters of challenge, as the client sent it, when this service signed them and they have not
// expired; nil otherwise.
func signed(challenge any, secret string, now time.Time) *object {
	parameters, _ := field(challenge, "parameters").(*object)
	if parameters == nil {
		return nil
	}
	expiresAt, _ := parameters.get("expiresAt")
	if truthy(expiresAt) && toNumber(expiresAt) < float64(now.UnixMilli())/1000 {
		return nil
	}
	signature, _ := field(challenge, "signature").(string)
	if signature == "" || !equalConstantTime(signature, sign(parameters, secret)) {
		return nil
	}
	return parameters
}

// solves reports whether solution solves the challenge of parameters, which this service signed (so hexadecimal
// nonce, salt and prefix, and numbers it chose): the key derived from the solution's counter equal to the solution's
// and beginning with the prefix.
func solves(parameters *object, solution any) (bool, error) {
	text := func(key string) string { v, _ := parameters.get(key); s, _ := v.(string); return s }
	number := func(key string) int { v, _ := parameters.get(key); return int(toNumber(v)) }
	nonce, err := hex.DecodeString(text("nonce"))
	if err != nil {
		return false, errVerification
	}
	salt, err := hex.DecodeString(text("salt"))
	if err != nil {
		return false, errVerification
	}
	password := binary.BigEndian.AppendUint32(nonce, toUint32(toNumber(field(solution, "counter"))))
	derived, err := pbkdf2.Key(digest(text("algorithm")), string(password), salt, number("cost"), number("keyLength"))
	if err != nil {
		return false, errVerification
	}
	derivedHex := hex.EncodeToString(derived)

	submitted := field(solution, "derivedKey")
	if submitted == nil {
		return false, errVerification // altcha-lib reads the length of undefined
	}
	submittedHex, _ := submitted.(string)
	prefix := text("keyPrefix")
	prefixMatches := strings.HasPrefix(derivedHex, prefix)
	if len(prefix)%2 == 0 {
		prefixMatches = strings.HasPrefix(derivedHex, strings.ToLower(prefix)) // compared as bytes
	}
	return equalConstantTime(derivedHex, submittedHex) && prefixMatches, nil
}

// field is v[key] in JavaScript for the values JSON.parse gives: undefined (nil) unless v is an object with key.
func field(v any, key string) any {
	if o, ok := v.(*object); ok {
		value, _ := o.get(key)
		return value
	}
	return nil
}

func digest(algorithm string) func() hash.Hash {
	switch algorithm {
	case "PBKDF2/SHA-512":
		return sha512.New
	case "PBKDF2/SHA-384":
		return sha512.New384
	}
	return sha256.New
}

func equalConstantTime(a, b string) bool {
	return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}

// toUint32 converts f as JavaScript's ToUint32 does: NaN and the infinities are 0, others are truncated modulo 2³².
func toUint32(f float64) uint32 {
	if math.IsNaN(f) || math.IsInf(f, 0) {
		return 0
	}
	return uint32(uint64(int64(math.Mod(math.Trunc(f), 1<<32)) + 1<<32))
}
