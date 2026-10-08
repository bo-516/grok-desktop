package wsapi

import (
	"fmt"

	"github.com/xai-org/grok-desktop/apps/bridge-go/internal/gitops"
)

// dispatchGitCliCommand routes one git panel command (status / diff /
// commit / push / pull request) to internal/gitops; dispatchCliCommand sends
// every `git_*` id here.
// cwd is the session workspace resolved by handleCli (absolute); gitops
// validates it and every path argument against the work-tree root. args is
// the free-form bag from the UI and may be nil.
//
// Payloads:
//   - git_status: none → gitops.Status.
//   - git_diff: mode ("head" | "merge-base"), base, paths[], maxFileBytes,
//     maxTotalBytes → gitops.DiffResult.
//   - git_commit: message, paths[], all → gitops.CommitResult.
//   - git_push: remote → gitops.PushResult.
//   - git_pr_preflight: none → gitops.PRPreflight.
//   - git_pr_create: title, body, base, draft → gitops.PRResult.
//
// @param command A `git_*` command id listed above.
// @param args Optional args bag.
// @param cwd Session workspace.
// @returns Reply payload for cli_result.data, or the operation's error
//
//	(surfaced verbatim in cli_result.error).
func dispatchGitCliCommand(command string, args map[string]any, cwd string) (any, error) {
	switch command {
	case "git_status":
		return gitops.ReadStatus(cwd)
	case "git_diff":
		return gitops.ReadDiff(cwd, gitops.DiffRequest{
			Mode:          stringArg(args, "mode"),
			Base:          stringArg(args, "base"),
			Paths:         stringSliceArg(args, "paths"),
			MaxFileBytes:  intArg(args, "maxFileBytes"),
			MaxTotalBytes: intArg(args, "maxTotalBytes"),
		})
	case "git_commit":
		return gitops.Commit(cwd, gitops.CommitRequest{
			Message: stringArg(args, "message"),
			Paths:   stringSliceArg(args, "paths"),
			All:     boolArg(args, "all"),
		})
	case "git_push":
		return gitops.Push(cwd, gitops.PushRequest{Remote: stringArg(args, "remote")})
	case "git_pr_preflight":
		return gitops.PreflightPR(cwd)
	case "git_pr_create":
		return gitops.CreatePR(cwd, gitops.PRRequest{
			Title: stringArg(args, "title"),
			Body:  stringArg(args, "body"),
			Base:  stringArg(args, "base"),
			Draft: boolArg(args, "draft"),
		})
	default:
		return nil, fmt.Errorf("unknown git command: %s", command)
	}
}
