package main

import "os/exec"

// execLookPath is os/exec.LookPath, isolated for testability of ResolveTsx.
func execLookPath(file string) (string, error) {
	return exec.LookPath(file)
}
