package session

import (
	"fmt"
	"strings"

	"github.com/xai-org/grok-desktop/apps/bridge-go/internal/pool"
	"github.com/xai-org/grok-desktop/apps/bridge-go/internal/worktree"
)

// prepareWorktreeStart decides the agent cwd for one StartOrResume call.
// A request creates a worktree in sourceCwd and forces a brand-new session
// so pool reuse cannot ignore the request. Create runs before BeginSpawn:
// a failure returns without reserving a pool slot and without spawning the
// agent in the source checkout. An existing info (recovery or restart)
// keeps that directory and strips agent --worktree/--ref so grok does not
// nest another checkout. No request and no existing info leaves the source
// cwd and the caller's spawn flags unchanged.
//
// @param sourceCwd Absolute source checkout from the start frame. Create
// rejects it when it is not a git repository.
// @param opts Mutated on success when a worktree is created: ForceNew becomes
// true, ResumeID and Seed are cleared, and SpawnConfig is replaced with a
// copy whose Worktree and Ref are empty. Nil opts is an error. The caller's
// original SpawnConfig pointer is not modified.
// @returns Agent cwd, info to store on the runtime (nil when this session
// is not a worktree), created true only when this call ran
// `grok worktree create`, and an error that must abort start. created is
// false whenever err is non-nil. A created worktree is left on disk when
// a later handshake fails; the caller mentions its path in that error.
func prepareWorktreeStart(sourceCwd string, opts *StartOpts) (string, *worktree.Info, bool, error) {
	if opts == nil {
		return "", nil, false, fmt.Errorf("missing start options")
	}
	if opts.Worktree == nil {
		if opts.ExistingWorktree == nil {
			return sourceCwd, nil, false, nil
		}
		opts.SpawnConfig = withoutAgentWorktree(opts.SpawnConfig)
		agentCwd := sourceCwd
		if opts.ExistingWorktree.Path != "" {
			agentCwd = opts.ExistingWorktree.Path
		}
		return agentCwd, opts.ExistingWorktree, false, nil
	}
	if strings.TrimSpace(opts.ResumeID) != "" && !opts.ForceNew {
		return "", nil, false, fmt.Errorf("worktree create cannot resume session %s", opts.ResumeID)
	}
	created, err := worktree.Create(worktree.Request{
		Cwd:  sourceCwd,
		Name: opts.Worktree.Name,
		Ref:  opts.Worktree.Ref,
	})
	if err != nil {
		return "", nil, false, err
	}
	opts.ForceNew = true
	opts.ResumeID = ""
	opts.Seed = nil
	opts.SpawnConfig = withoutAgentWorktree(opts.SpawnConfig)
	return created.Path, &created, true, nil
}

// worktreeStartError attaches the created path when this call created a
// worktree and a later spawn or insert failed. The directory is not removed.
// Recovery and restart pass created false, so their errors stay unchanged.
//
// @param err Spawn or insert error. Nil returns nil.
// @param info Created identity. Nil or an empty path leaves err unchanged.
// @param created True only when prepareWorktreeStart created the directory
// on this call.
// @returns err, or err wrapped with the leftover path.
func worktreeStartError(err error, info *worktree.Info, created bool) error {
	if err == nil || !created || info == nil || info.Path == "" {
		return err
	}
	return fmt.Errorf("%w (worktree left at %s)", err, info.Path)
}

// withoutAgentWorktree returns a spawn-config copy whose Worktree and Ref
// are cleared. Those flags would make `grok agent` create a nested worktree
// after the bridge already created one. Model and every other flag stay.
// Slice and map fields share their backing storage with cfg; only Worktree
// and Ref are cleared, and those are not aliased. Nil in yields nil. The
// input pointer is not modified.
//
// @param cfg Spawn config from the client or a previous runtime. May be nil.
// @returns A new config, or nil when cfg is nil.
func withoutAgentWorktree(cfg *pool.SessionSpawnConfig) *pool.SessionSpawnConfig {
	if cfg == nil {
		return nil
	}
	next := *cfg
	next.Worktree = nil
	next.Ref = ""
	return &next
}
