package main

import "io/fs"

// private holds on Windows: the cache directory lies in the user's profile, and Go shows no owner or permissions.
func private(fs.FileInfo) bool {
	return true
}
