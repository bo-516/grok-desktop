//go:build !windows

package reverse

import "os/exec"

// shellCommand runs a full command line via bash -lc (Node shell:true on unix).
func shellCommand(command, cwd string) *exec.Cmd {
	cmd := exec.Command("/bin/bash", "-lc", command)
	cmd.Dir = cwd
	return cmd
}
