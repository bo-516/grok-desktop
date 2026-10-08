/**
 * Stateless "Restore files to before this turn" dialog. Every phase that can
 * write shows the file list first; outside edits get their own explicit
 * overwrite step. Copy is honest about scope: later turns are undone too,
 * the conversation is kept, and shell-made changes are not tracked.
 */

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { conflictLabel } from "@/lib/turnRewind";
import type { TurnRewindModel } from "./useTurnRewindWidget";

export type TurnRewindDialogViewProps = Pick<
  TurnRewindModel,
  "phase" | "plan" | "result" | "error" | "confirm" | "force" | "close"
>;

/**
 * Bordered path list.
 * @param props Paths and optional per-path note.
 * @returns List element.
 */
function FileList(props: { paths: readonly string[]; note?: (path: string) => string }) {
  return (
    <ul className="turn-rewind-files" aria-label="Files">
      {props.paths.map((p) => (
        <li key={p} className="turn-rewind-file">
          <span className="min-w-0 flex-1 truncate" title={p}>
            {p}
          </span>
          {props.note ? <span className="turn-rewind-file-note">{props.note(p)}</span> : null}
        </li>
      ))}
    </ul>
  );
}

/**
 * Title + description per phase.
 * @param props Dialog props.
 * @returns [title, description].
 */
function headingFor(props: TurnRewindDialogViewProps): [string, string] {
  const later = props.plan.laterTurns;
  const laterText =
    later > 0 ? ` Edits from the ${later} later turn${later === 1 ? "" : "s"} that changed files are undone too.` : "";
  switch (props.phase) {
    case "loading":
      return ["Restore files to before this turn?", "Reading grok-build's checkpoints…"];
    case "conflicts":
      return [
        "Files changed outside the agent",
        "These files changed after the agent last edited them. Restoring overwrites those changes. Nothing has been written yet.",
      ];
    case "working":
      return ["Restoring files…", "grok-build is restoring the files."];
    case "done":
      return ["Files restored", "The conversation is unchanged; tell the agent if it should know."];
    case "error":
      return ["Could not restore files", ""];
    default:
      return [
        "Restore files to before this turn?",
        `grok-build puts these files back the way they were before this turn and removes files it created.${laterText} The conversation stays as it is.`,
      ];
  }
}

/**
 * Body for the current phase.
 * @param props Dialog props.
 * @returns Phase body.
 */
function PhaseBody(props: TurnRewindDialogViewProps) {
  const { phase, plan, result } = props;
  if (phase === "confirm" || phase === "loading") {
    return plan.files.length > 0 ? (
      <FileList paths={plan.files} />
    ) : (
      <p className="turn-rewind-note">The timeline shows no file edits for this turn; grok-build restores whatever it recorded.</p>
    );
  }
  if (phase === "conflicts" && result) {
    const kinds = new Map(result.conflicts.map((c) => [c.path, c.type]));
    return (
      <>
        <FileList paths={result.conflicts.map((c) => c.path)} note={(p) => conflictLabel(kinds.get(p) ?? "")} />
        {result.cleanFiles.length > 0 ? (
          <p className="turn-rewind-note">
            {result.cleanFiles.length} other file{result.cleanFiles.length === 1 ? "" : "s"} would restore cleanly.
          </p>
        ) : null}
      </>
    );
  }
  if (phase === "done" && result) {
    const deleted = new Set(result.deletedFiles);
    return (
      <>
        <FileList paths={result.revertedFiles} note={(p) => (deleted.has(p) ? "removed" : "restored")} />
        {result.warnings.map((w) => (
          <p key={w} className="turn-rewind-note">
            {w}
          </p>
        ))}
      </>
    );
  }
  if (phase === "error") {
    return <pre className="git-dialog-error">{props.error}</pre>;
  }
  return null;
}

/**
 * Footer buttons for the current phase.
 * @param props Dialog props.
 * @returns Footer.
 */
function PhaseFooter(props: TurnRewindDialogViewProps) {
  const { phase } = props;
  const finished = phase === "done" || phase === "error";
  return (
    <DialogFooter>
      <Button type="button" variant="outline" disabled={phase === "working"} onClick={props.close}>
        {finished ? "Close" : "Cancel"}
      </Button>
      {phase === "confirm" || phase === "loading" ? (
        <Button type="button" disabled={phase !== "confirm"} onClick={props.confirm}>
          Restore files
        </Button>
      ) : null}
      {phase === "conflicts" ? (
        <Button type="button" variant="destructive" onClick={props.force}>
          Overwrite and restore
        </Button>
      ) : null}
    </DialogFooter>
  );
}

/**
 * Restore dialog.
 * @param props Phase data and handlers from useTurnRewindWidget.
 * @returns Open dialog (render only while phase !== "closed").
 */
export function TurnRewindDialogView(props: TurnRewindDialogViewProps) {
  const [title, description] = headingFor(props);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        // A restore in flight cannot be abandoned half-way.
        if (!open && props.phase !== "working") {
          props.close();
        }
      }}
    >
      <DialogContent aria-describedby="turn-rewind-desc">
        <div className="flex flex-col gap-3.5" data-kind="turn-rewind-dialog" data-phase={props.phase}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription id="turn-rewind-desc">{description}</DialogDescription>
          </DialogHeader>
          <PhaseBody {...props} />
          {props.phase === "confirm" ? (
            <p className="turn-rewind-note">
              Only edits made by the agent&apos;s file tools are tracked; changes from shell commands are not restored.
            </p>
          ) : null}
          <PhaseFooter {...props} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
