// Command re2check reads regular expressions as JSON from standard input and reports those that RE2 does not
// accept. scripts/check-regex.ts extracts them from the TypeScript sources and runs it.
//
// Input: [{"where": "file:line", "pattern": "...", "flags": "gimsuy"}]. A JavaScript `\uXXXX` or `\u{X}` escape is
// read as RE2's `\x{X}`, and the flags i, m and s become a leading `(?ims)`; the other flags do not change syntax.
//
// Exit status: 0 all accepted, 1 some rejected, 2 the input could not be read.
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"regexp"
	"regexp/syntax"
	"strings"
)

type pattern struct {
	Where   string `json:"where"`
	Pattern string `json:"pattern"`
	Flags   string `json:"flags"`
}

var unicodeEscape = regexp.MustCompile(`\\u\{([0-9a-fA-F]+)\}|\\u([0-9a-fA-F]{4})`)

func toRE2(p pattern) string {
	re := unicodeEscape.ReplaceAllString(p.Pattern, `\x{$1$2}`)
	var modes strings.Builder
	for _, flag := range "ims" {
		if strings.ContainsRune(p.Flags, flag) {
			modes.WriteRune(flag)
		}
	}
	if modes.Len() > 0 {
		re = "(?" + modes.String() + ")" + re
	}
	return re
}

func main() {
	var patterns []pattern
	if err := json.NewDecoder(os.Stdin).Decode(&patterns); err != nil {
		fmt.Fprintf(os.Stderr, "re2check: cannot read the patterns: %v\n", err)
		os.Exit(2)
	}
	rejected := 0
	for _, p := range patterns {
		if _, err := syntax.Parse(toRE2(p), syntax.Perl); err != nil {
			rejected++
			fmt.Printf("%s: /%s/%s is not RE2: %v\n", p.Where, p.Pattern, p.Flags, err)
		}
	}
	if rejected > 0 {
		os.Exit(1)
	}
}
