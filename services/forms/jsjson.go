// Package forms is hadley's comments service: what CONTRACT.md describes, in Go.
package forms

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"math"
	"slices"
	"strconv"
	"strings"
	"unicode/utf16"
)

// The service it replaces reads and writes JSON with JavaScript's JSON.parse and JSON.stringify. A value here is what
// JSON.parse gives: nil, bool, float64, string, []any or *object, which keeps its keys in JavaScript's order.

// object is a JSON object with JavaScript's key order: keys that are array indices first, ascending, then the others
// in the order they were first set. Setting a key again keeps its place and replaces its value.
type object struct {
	keys   []string
	values map[string]any
}

func newObject() *object { return &object{values: map[string]any{}} }

func (o *object) set(key string, value any) {
	if _, ok := o.values[key]; !ok {
		o.keys = append(o.keys, key)
	}
	o.values[key] = value
}

// get returns the value of key, and whether the object has it.
func (o *object) get(key string) (any, bool) {
	value, ok := o.values[key]
	return value, ok
}

// arrayIndex reports whether a key is an array index (a canonical decimal below 2³²−1), which JavaScript orders first.
func arrayIndex(key string) (uint64, bool) {
	if key == "" || (len(key) > 1 && key[0] == '0') {
		return 0, false
	}
	n, err := strconv.ParseUint(key, 10, 64)
	return n, err == nil && n < math.MaxUint32
}

func (o *object) orderedKeys() []string {
	var indices, others []string
	for _, key := range o.keys {
		if _, ok := arrayIndex(key); ok {
			indices = append(indices, key)
		} else {
			others = append(others, key)
		}
	}
	slices.SortFunc(indices, func(a, b string) int {
		x, _ := arrayIndex(a)
		y, _ := arrayIndex(b)
		return int(x) - int(y)
	})
	return append(indices, others...)
}

// parseJSON reads data as JSON.parse reads the text of a request: a leading byte order mark is dropped, anything but
// whitespace after the value is an error.
func parseJSON(data []byte) (any, error) {
	data = bytes.TrimPrefix(data, []byte{0xEF, 0xBB, 0xBF}) // UTF-8 byte order mark
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	value, err := parseValue(decoder)
	if err != nil {
		return nil, err
	}
	if _, err := decoder.Token(); err != io.EOF {
		return nil, errors.New("data after the JSON value")
	}
	return value, nil
}

func parseValue(decoder *json.Decoder) (any, error) {
	token, err := decoder.Token()
	if err != nil {
		return nil, err
	}
	switch token := token.(type) {
	case json.Delim:
		switch token {
		case '{':
			o := newObject()
			for decoder.More() {
				key, err := decoder.Token()
				if err != nil {
					return nil, err
				}
				value, err := parseValue(decoder)
				if err != nil {
					return nil, err
				}
				o.set(key.(string), value)
			}
			_, err := decoder.Token() // '}'
			return o, err
		case '[':
			list := []any{}
			for decoder.More() {
				value, err := parseValue(decoder)
				if err != nil {
					return nil, err
				}
				list = append(list, value)
			}
			_, err := decoder.Token() // ']'
			return list, err
		}
		return nil, errors.New("unexpected delimiter")
	case json.Number:
		// a number too large for a double is Infinity in JavaScript, which JSON.stringify writes as null
		f, err := strconv.ParseFloat(string(token), 64)
		if err != nil && !errors.Is(err, strconv.ErrRange) {
			return nil, err
		}
		return f, nil
	default: // nil, bool, string
		return token, nil
	}
}

// stringifyJS writes v as JSON.stringify does: no spaces, object keys in their order, strings escaped only where JSON
// requires it.
func stringifyJS(v any) []byte {
	var b bytes.Buffer
	writeJS(&b, v, false)
	return b.Bytes()
}

// canonicalJS writes v as JSON.stringify writes it after altcha-lib's sortKeys: the keys of every object sorted by
// UTF-16 code units, except inside arrays, which sortKeys leaves as they are (CONTRACT.md C5).
func canonicalJS(v any) []byte {
	var b bytes.Buffer
	writeJS(&b, v, true)
	return b.Bytes()
}

func writeJS(b *bytes.Buffer, v any, sorted bool) {
	switch v := v.(type) {
	case nil:
		b.WriteString("null")
	case bool:
		b.WriteString(strconv.FormatBool(v))
	case float64:
		b.WriteString(numberJS(v))
	case int:
		b.WriteString(strconv.Itoa(v))
	case string:
		writeStringJS(b, v)
	case []any:
		b.WriteByte('[')
		for i, item := range v {
			if i > 0 {
				b.WriteByte(',')
			}
			writeJS(b, item, false)
		}
		b.WriteByte(']')
	case *object:
		keys := v.orderedKeys()
		if sorted {
			keys = slices.Clone(v.keys)
			slices.SortFunc(keys, compareUTF16)
		}
		b.WriteByte('{')
		for i, key := range keys {
			if i > 0 {
				b.WriteByte(',')
			}
			writeStringJS(b, key)
			b.WriteByte(':')
			writeJS(b, v.values[key], sorted)
		}
		b.WriteByte('}')
	default:
		panic("stringifyJS: not a JSON value")
	}
}

func compareUTF16(a, b string) int {
	return slices.Compare(utf16.Encode([]rune(a)), utf16.Encode([]rune(b)))
}

// writeStringJS quotes s as JSON.stringify does: ", \ and the control characters escaped, everything else as it is.
func writeStringJS(b *bytes.Buffer, s string) {
	const hex = "0123456789abcdef"
	b.WriteByte('"')
	for _, r := range s {
		switch r {
		case '"':
			b.WriteString(`\"`)
		case '\\':
			b.WriteString(`\\`)
		case '\b':
			b.WriteString(`\b`)
		case '\f':
			b.WriteString(`\f`)
		case '\n':
			b.WriteString(`\n`)
		case '\r':
			b.WriteString(`\r`)
		case '\t':
			b.WriteString(`\t`)
		default:
			if r < 0x20 {
				b.WriteString(`\u00`)
				b.WriteByte(hex[r>>4])
				b.WriteByte(hex[r&0xF])
			} else {
				b.WriteRune(r)
			}
		}
	}
	b.WriteByte('"')
}

// numberJS writes f as JavaScript's Number::toString does (ECMA-262, Number::toString): integers below 10²¹ in full,
// shorter or longer ones with an exponent; NaN and the infinities as null, as JSON.stringify does.
func numberJS(f float64) string {
	if math.IsNaN(f) || math.IsInf(f, 0) {
		return "null"
	}
	if f == 0 {
		return "0"
	}
	sign := ""
	if f < 0 {
		sign, f = "-", -f
	}
	// the shortest digits that round-trip, and n, the position of the decimal point after the first digit
	mantissa, exponent, _ := strings.Cut(strconv.FormatFloat(f, 'e', -1, 64), "e")
	digits := strings.Replace(mantissa, ".", "", 1)
	e, _ := strconv.Atoi(exponent)
	k, n := len(digits), e+1
	switch {
	case k <= n && n <= 21:
		return sign + digits + strings.Repeat("0", n-k)
	case 0 < n && n <= 21:
		return sign + digits[:n] + "." + digits[n:]
	case -6 < n && n <= 0:
		return sign + "0." + strings.Repeat("0", -n) + digits
	}
	exp := strconv.Itoa(n - 1)
	if n-1 >= 0 {
		exp = "+" + exp
	}
	if k == 1 {
		return sign + digits + "e" + exp
	}
	return sign + digits[:1] + "." + digits[1:] + "e" + exp
}

// truthy reports whether JavaScript treats v as true in a condition.
func truthy(v any) bool {
	switch v := v.(type) {
	case nil:
		return false
	case bool:
		return v
	case float64:
		return v != 0 && !math.IsNaN(v)
	case string:
		return v != ""
	}
	return true // arrays and objects, even empty
}

// toNumber converts v as JavaScript's ToNumber does, for the values JSON.parse gives: an array by its text (so [] is
// 0, [38] is 38, [1,2] is NaN), an object is NaN.
func toNumber(v any) float64 {
	switch v := v.(type) {
	case nil:
		return 0
	case bool:
		if v {
			return 1
		}
		return 0
	case float64:
		return v
	case string:
		return stringToNumber(v)
	case []any:
		return stringToNumber(toStringJS(v))
	}
	return math.NaN()
}

// toStringJS converts v as JavaScript's ToString does, for the values JSON.parse gives; null inside an array is "".
func toStringJS(v any) string {
	switch v := v.(type) {
	case nil:
		return "null"
	case bool:
		return strconv.FormatBool(v)
	case float64:
		switch {
		case math.IsNaN(v):
			return "NaN"
		case math.IsInf(v, 1):
			return "Infinity"
		case math.IsInf(v, -1):
			return "-Infinity"
		}
		return numberJS(v)
	case string:
		return v
	case []any:
		parts := make([]string, len(v))
		for i, item := range v {
			if item != nil {
				parts[i] = toStringJS(item)
			}
		}
		return strings.Join(parts, ",")
	}
	return "[object Object]"
}

// stringToNumber converts s as JavaScript's Number(s) does: whitespace around it ignored, empty is 0, decimal with an
// optional exponent, 0x/0o/0b integers and Infinity; anything else is NaN.
func stringToNumber(s string) float64 {
	s = strings.TrimFunc(s, isSpaceJS)
	if s == "" {
		return 0
	}
	for prefix, base := range map[string]int{"0x": 16, "0X": 16, "0o": 8, "0O": 8, "0b": 2, "0B": 2} {
		if rest, ok := strings.CutPrefix(s, prefix); ok {
			if rest == "" || strings.ContainsAny(rest, "_+-") {
				return math.NaN()
			}
			n, err := strconv.ParseUint(rest, base, 64)
			if err != nil {
				if errors.Is(err, strconv.ErrRange) {
					f, _ := strconv.ParseFloat("0x"+rest, 64) // only hexadecimal can be this long in practice
					return f
				}
				return math.NaN()
			}
			return float64(n)
		}
	}
	unsigned := strings.TrimLeft(s, "+-")
	if len(s)-len(unsigned) > 1 {
		return math.NaN()
	}
	if unsigned == "Infinity" {
		if s[0] == '-' {
			return math.Inf(-1)
		}
		return math.Inf(1)
	}
	if !decimalLiteral(unsigned) {
		return math.NaN()
	}
	f, err := strconv.ParseFloat(s, 64)
	if err != nil && !errors.Is(err, strconv.ErrRange) {
		return math.NaN()
	}
	return f
}

// decimalLiteral reports whether s is digits with an optional fraction and exponent, the form JavaScript reads as a
// decimal number (strconv.ParseFloat also takes inf, nan, hexadecimal floats and underscores, which it does not).
func decimalLiteral(s string) bool {
	mantissa, exponent, hasExponent := strings.Cut(strings.ToLower(s), "e")
	whole, fraction, _ := strings.Cut(mantissa, ".")
	if whole == "" && fraction == "" || !allDigits(whole) || !allDigits(fraction) {
		return false
	}
	if hasExponent {
		exponent = strings.TrimPrefix(strings.TrimPrefix(exponent, "+"), "-")
		return exponent != "" && allDigits(exponent)
	}
	return true
}

func allDigits(s string) bool {
	for _, c := range s {
		if c < '0' || c > '9' {
			return false
		}
	}
	return true
}

// isSpaceJS reports whether r is white space or a line terminator to JavaScript (String.prototype.trim, \s).
func isSpaceJS(r rune) bool {
	switch r {
	case '\t', '\n', '\v', '\f', '\r', ' ', 0xA0, 0x1680, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF:
		return true
	}
	return 0x2000 <= r && r <= 0x200A
}

// lengthUTF16 is the length JavaScript gives s: its UTF-16 code units.
func lengthUTF16(s string) int {
	n := 0
	for _, r := range s {
		n += utf16.RuneLen(r)
	}
	return n
}
