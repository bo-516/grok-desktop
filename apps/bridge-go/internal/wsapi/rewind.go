package wsapi

import (
	"fmt"
	"strings"

	"github.com/xai-org/grok-desktop/apps/bridge-go/internal/acp"
	"github.com/xai-org/grok-desktop/apps/bridge-go/internal/rewind"
	"github.com/xai-org/grok-desktop/apps/bridge-go/internal/session"
)

// isRewindCliCommand reports whether a cli command id belongs to turn rewind
// (handled with pool access by dispatchRewindCliCommand, not dispatchCliCommand).
// @param command cli command id.
// @returns True for `rewind_points` / `rewind_files`.
func isRewindCliCommand(command string) bool {
	return command == "rewind_points" || command == "rewind_files"
}

// dispatchRewindCliCommand runs one turn-rewind command against the live
// grok-build session named by args.sessionId, through grok-build's own
// checkpoints (internal/rewind). The session must be resident in the pool —
// there is no fallback to the focused session, so a stale canvas cannot
// rewind someone else's files.
//
// Payloads:
//   - rewind_points: sessionId → []rewind.Point.
//   - rewind_files: sessionId, targetPromptIndex (≥ 0), force → rewind.Result.
//     Refused while the session is streaming or waiting on a permission.
//
// @param command `rewind_points` or `rewind_files`.
// @param args Args bag from the UI (nil-safe).
// @returns Reply payload, or an error surfaced verbatim in cli_result.error.
func (h *Handlers) dispatchRewindCliCommand(command string, args map[string]any) (any, error) {
	sessionID := strings.TrimSpace(stringArg(args, "sessionId"))
	if sessionID == "" {
		return nil, fmt.Errorf("sessionId is required")
	}
	rt, err := session.RequireSessionRuntime(h.Pool, "", sessionID)
	if err != nil {
		return nil, err
	}
	h.Pool.Touch(rt.SessionID)
	if rt.XaiRequest == nil {
		return nil, fmt.Errorf("rewind is not available for this session")
	}
	switch command {
	case "rewind_points":
		return rewind.ListPoints(rt.XaiRequest, rt.SessionID)
	case "rewind_files":
		if _, ok := args["targetPromptIndex"]; !ok {
			return nil, fmt.Errorf("targetPromptIndex is required")
		}
		if rt.GetStatus != nil {
			if st := rt.GetStatus(); st == acp.StatusStreaming || st == acp.StatusWaitingPermission {
				return nil, fmt.Errorf("wait for the current turn to finish before restoring files")
			}
		}
		return rewind.Execute(rt.XaiRequest, rewind.ExecuteOptions{
			SessionID:         rt.SessionID,
			Cwd:               rt.Cwd,
			SessionDir:        session.FindSessionDir(rt.SessionID, rt.Cwd, ""),
			TargetPromptIndex: intArg(args, "targetPromptIndex"),
			Force:             boolArg(args, "force"),
		})
	default:
		return nil, fmt.Errorf("unknown rewind command: %s", command)
	}
}
