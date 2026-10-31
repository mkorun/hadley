package forms

import (
	"regexp"
	"strings"
	"unicode"

	"golang.org/x/text/unicode/norm"
)

// The fields of a submission (CONTRACT.md C7). The patterns are ASCII-only on purpose: JavaScript's case-insensitive
// patterns do not match \u017f or K (Kelvin) for s or k, Go's (?i) would.
var (
	articlePattern  = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)
	languagePattern = regexp.MustCompile(`^[A-Za-z]{2}(-[A-Za-z0-9_-]+)?$`)
	uuidPattern     = regexp.MustCompile(`^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$`)
)

// cleanField is a name or text as it is stored: NFC, without control, zero-width, bidi-override and invisible
// operator characters, trimmed.
func cleanField(s string) string {
	s = strings.Map(func(r rune) rune {
		switch {
		case r <= 0x1F, r == 0x7F, 0x200B <= r && r <= 0x200D, 0x202A <= r && r <= 0x202E,
			0x2060 <= r && r <= 0x2064, r == 0xFEFF:
			return -1
		}
		return r
	}, norm.NFC.String(s))
	return strings.TrimFunc(s, isSpaceJS)
}

// cleanEmail is an email as it is stored: without C0 control characters and DEL, trimmed, lower case. Lower case is
// Unicode's simple mapping plus \u0130 → i\u0307, as JavaScript's toLowerCase; its rule for a final Σ is not followed.
func cleanEmail(s string) string {
	s = strings.Map(func(r rune) rune {
		if r <= 0x1F || r == 0x7F {
			return -1
		}
		return r
	}, s)
	s = strings.TrimFunc(s, isSpaceJS)
	return strings.Map(unicode.ToLower, strings.ReplaceAll(s, "\u0130", "i\u0307"))
}

// validEmail checks what /^[^@\s]{1,64}@[^@\s]{1,255}$/ checks in JavaScript: one @, 1 to 64 UTF-16 code units
// before it, 1 to 255 after it, no white space.
func validEmail(s string) bool {
	local, domain, ok := strings.Cut(s, "@")
	if !ok || strings.Contains(domain, "@") || strings.IndexFunc(s, isSpaceJS) >= 0 {
		return false
	}
	return 1 <= lengthUTF16(local) && lengthUTF16(local) <= 64 && 1 <= lengthUTF16(domain) && lengthUTF16(domain) <= 255
}
