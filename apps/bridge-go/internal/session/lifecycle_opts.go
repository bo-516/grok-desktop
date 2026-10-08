package session

import (
	"github.com/xai-org/grok-desktop/apps/bridge-go/internal/acp"
	"github.com/xai-org/grok-desktop/apps/bridge-go/internal/pool"
	"github.com/xai-org/grok-desktop/apps/bridge-go/internal/worktree"
)

// StartOpts is one session start or resume.
// Worktree and ExistingWorktree are independent fields. A non-nil Worktree
// always creates a new checkout and ignores ExistingWorktree. Crash recovery
// and RestartSession set only ExistingWorktree so they do not create again.
type StartOpts struct {
	// Cwd is the workspace the user selected. For a worktree request this is
	// the source repository. Empty fails when Abs cannot resolve it.
	Cwd string
	// AlwaysApprove folds --always-approve into the agent spawn.
	AlwaysApprove bool
	// ResumeID loads an existing ACP session when ForceNew is false.
	// Combined with a Worktree request and ForceNew false, start fails
	// before any process is spawned.
	ResumeID string
	// Seed hydrates the client snapshot on resume. Cleared when a worktree
	// is created so the new checkout cannot resume the source session.
	Seed *acp.SessionState
	// ForceNew skips pool reuse and resume. A successful worktree create
	// sets this even if the caller left it false.
	ForceNew bool
	// SpawnConfig is the SPAWN flag bag. Worktree and Ref on this bag are
	// the older `grok agent --worktree` flags. They are stripped on the copy
	// used to spawn when a worktree was created or attached. Nil is allowed.
	SpawnConfig *pool.SessionSpawnConfig
	// Worktree asks the bridge to run `grok worktree create` before spawn.
	// Nil means do not create. An empty request (blank name and ref) still
	// creates, using the CLI defaults (HEAD plus uncommitted changes).
	Worktree *worktree.Request
	// ExistingWorktree is a checkout already created for this session.
	// Recovery and restart pass it so a second create does not run.
	// Ignored when Worktree is non-nil. Nil means a normal source checkout.
	ExistingWorktree *worktree.Info
}
