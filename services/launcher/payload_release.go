//go:build release

package main

import _ "embed"

// payload is written beside this file by scripts/build-binary.ts, which builds with the tag release.
//
//go:embed payload.tar.gz
var payload []byte
