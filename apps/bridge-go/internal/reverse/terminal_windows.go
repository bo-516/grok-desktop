//go:build windows

package reverse

import "os/exec"

// shellCommand runs a full command line via cmd /C (Node shell:true on windows).
func shellCommand(command, cwd string) *exec.Cmd {
	cmd := exec.Command("cmd", "/C", command)
	cmd.Dir = cwd
	return cmd
}
