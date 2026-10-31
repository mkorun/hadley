package forms

import (
	"strings"
	"testing"
)

func TestCleanField(t *testing.T) {
	for in, want := range map[string]string{
		"  Nora ":                         "Nora",
		"No\u200bra\u0007":                "Nora",
		"line\nnext\ttab":                 "linenexttab",
		"a\u202eb\u2066c":                 "ab\u2066c", // U+2066 is outside the stripped ranges, as in the replaced service
		"e\u0301":                         "é",         // NFC
		"\u00a0\u3000x\u2028\xef\xbb\xbf": "x",
		"\u200e kept \u200f":              "\u200e kept \u200f",
	} {
		if got := cleanField(in); got != want {
			t.Errorf("cleanField(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestCleanEmail(t *testing.T) {
	for in, want := range map[string]string{
		" NORA@Example.NET ": "nora@example.net",
		"a\u0007b@c":         "ab@c",
		"\u0130@x":           "i\u0307@x",
	} {
		if got := cleanEmail(in); got != want {
			t.Errorf("cleanEmail(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestValidEmail(t *testing.T) {
	valid := []string{"a@b", strings.Repeat("l", 64) + "@" + strings.Repeat("d", 255), "\U0001F600@x"}
	invalid := []string{"", "a", "@b", "a@", "a@b@c", "a b@c", "a@b\u3000c", strings.Repeat("l", 65) + "@d",
		strings.Repeat("\U0001F600", 33) + "@d"} // 66 UTF-16 code units before the @
	for _, s := range valid {
		if !validEmail(s) {
			t.Errorf("validEmail(%q) = false", s)
		}
	}
	for _, s := range invalid {
		if validEmail(s) {
			t.Errorf("validEmail(%q) = true", s)
		}
	}
}

func TestPatternsAreASCII(t *testing.T) {
	for _, s := range []string{"\u017f", "\u212a"} {
		if articlePattern.MatchString(s) {
			t.Errorf("articlePattern matches %q", s)
		}
	}
	if !languagePattern.MatchString("de-AT_x") || languagePattern.MatchString("deu") {
		t.Error("languagePattern")
	}
}
