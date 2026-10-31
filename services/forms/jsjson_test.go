package forms

import (
	"math"
	"testing"
)

func TestNumberJS(t *testing.T) {
	for f, want := range map[float64]string{
		0: "0", math.Copysign(0, -1): "0", 1: "1", -5: "-5", 50000: "50000", 0.1: "0.1", 1.5: "1.5",
		1e21: "1e+21", 1e20: "100000000000000000000", 123e-20: "1.23e-18", 0.000001: "0.000001", 1e-7: "1e-7",
		1792757700: "1792757700", math.Inf(1): "null", math.NaN(): "null",
	} {
		if got := numberJS(f); got != want {
			t.Errorf("numberJS(%v) = %q, want %q", f, got, want)
		}
	}
}

func TestStringToNumber(t *testing.T) {
	for s, want := range map[string]float64{
		"": 0, "  12 ": 12, "0x10": 16, "0b11": 3, "0o17": 15, "1e3": 1000, ".5": 0.5, "5.": 5, "+7": 7, "-7": -7,
		"Infinity": math.Inf(1), "-Infinity": math.Inf(-1),
	} {
		if got := stringToNumber(s); got != want {
			t.Errorf("stringToNumber(%q) = %v, want %v", s, got, want)
		}
	}
	for _, s := range []string{"abc", "1_000", "0x", "-0x10", "inf", "NaN", "1e", ".", "++1", "0x1g", "infinity"} {
		if got := stringToNumber(s); !math.IsNaN(got) {
			t.Errorf("stringToNumber(%q) = %v, want NaN", s, got)
		}
	}
}

func TestParseAndStringifyKeepJavaScriptsOrder(t *testing.T) {
	v, err := parseJSON([]byte("\xEF\xBB\xBF" + `{"b":1,"2":"x","a":{"z":[1,2.5,"<&>\u2028"]},"1":true,"b":null}`))
	if err != nil {
		t.Fatal(err)
	}
	if got, want := string(stringifyJS(v)), "{\"1\":true,\"2\":\"x\",\"b\":null,\"a\":{\"z\":[1,2.5,\"<&>\u2028\"]}}"; got != want {
		t.Errorf("stringifyJS = %s, want %s", got, want)
	}
	if got, want := string(canonicalJS(v)), "{\"1\":true,\"2\":\"x\",\"a\":{\"z\":[1,2.5,\"<&>\u2028\"]},\"b\":null}"; got != want {
		t.Errorf("canonicalJS = %s, want %s", got, want)
	}
}

func TestParseRefusesWhatJSONParseRefuses(t *testing.T) {
	for _, text := range []string{"", "{", `{"a":1} x`, "[1,]", "'a'", "NaN"} {
		if _, err := parseJSON([]byte(text)); err == nil {
			t.Errorf("parseJSON(%q) succeeded", text)
		}
	}
}

func TestStringEscapes(t *testing.T) {
	if got, want := string(stringifyJS("\"\\\b\f\n\r\t\x01\x1f é")), `"\"\\\b\f\n\r\t\u0001\u001f é"`; got != want {
		t.Errorf("stringifyJS = %s, want %s", got, want)
	}
}

func TestToUint32(t *testing.T) {
	for f, want := range map[float64]uint32{0: 0, 1.9: 1, -1: math.MaxUint32, 4294967296: 0, 4294967297: 1, math.NaN(): 0} {
		if got := toUint32(f); got != want {
			t.Errorf("toUint32(%v) = %d, want %d", f, got, want)
		}
	}
}

// review 2026-10-27: altcha-lib's sortKeys leaves arrays as they are, objects inside them too
func TestCanonicalLeavesArraysAlone(t *testing.T) {
	v, _ := parseJSON([]byte(`{"b":[{"z":1,"a":2}],"a":{"d":1,"c":2}}`))
	if got, want := string(canonicalJS(v)), `{"a":{"c":2,"d":1},"b":[{"z":1,"a":2}]}`; got != want {
		t.Errorf("canonicalJS = %s, want %s", got, want)
	}
}

// review 2026-10-27: a counter of [38] is 38 to DataView.setUint32
func TestToNumberOfArrays(t *testing.T) {
	for text, want := range map[string]float64{`[]`: 0, `[38]`: 38, `["7"]`: 7, `[[2]]`: 2, `[null]`: 0, `[true]`: math.NaN(), `[1,2]`: math.NaN(), `{}`: math.NaN()} {
		v, _ := parseJSON([]byte(text))
		if got := toNumber(v); got != want && !(math.IsNaN(got) && math.IsNaN(want)) {
			t.Errorf("toNumber(%s) = %v, want %v", text, got, want)
		}
	}
}
