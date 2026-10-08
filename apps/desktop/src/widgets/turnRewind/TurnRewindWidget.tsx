/**
 * Stateful "Restore files to before this turn" trigger + dialog. Mounted next
 * to a turn's change summary and in the git change panel's turn filter; each
 * mount owns its own flow (useTurnRewindWidget), so no global dialog state.
 */

import cs from "classnames";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TurnRewindDialogView } from "./TurnRewindDialogView";
import { useTurnRewindWidget } from "./useTurnRewindWidget";

export type TurnRewindWidgetProps = {
  /** TurnUnit.id of the turn whose start is the restore point. */
  turnId: string;
  /**
   * "summary": outline button beside the turn's "Edited N files" row.
   * "filter": compact ghost button in the git panel's turn-filter row.
   */
  variant: "summary" | "filter";
  /** Optional trigger label (default "Restore"). */
  label?: string;
};

/**
 * Trigger button plus the dialog while open.
 * @param props Turn id, placement variant and label.
 * @returns Trigger (and dialog).
 */
export function TurnRewindWidget(props: TurnRewindWidgetProps) {
  const flow = useTurnRewindWidget(props.turnId);
  const title = flow.disabledReason || "Restore files to how they were before this turn";
  const summary = props.variant === "summary";
  return (
    <>
      {/* The span carries the tooltip: a disabled Button ignores the pointer. */}
      <span className={cs("inline-flex", { "turn-rewind-trigger-wrap": summary })} title={title}>
        <Button
          type="button"
          variant={summary ? "outline" : "ghost"}
          size={summary ? "default" : "xs"}
          className={cs({ "turn-rewind-trigger": summary })}
          disabled={flow.disabledReason !== ""}
          data-kind="turn-rewind-trigger"
          onClick={flow.open}
        >
          <RotateCcw aria-hidden="true" />
          {props.label ?? "Restore"}
        </Button>
      </span>
      {flow.phase !== "closed" ? (
        <TurnRewindDialogView
          phase={flow.phase}
          plan={flow.plan}
          result={flow.result}
          error={flow.error}
          confirm={flow.confirm}
          force={flow.force}
          close={flow.close}
        />
      ) : null}
    </>
  );
}
