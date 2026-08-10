/**
 * Optional mention chip: kind icon + token label on a tinted, hairline-ringed pill.
 *
 * Draft and timeline history intentionally do *not* use this — both use
 * `.composer-mention` accent text (see MentionTextView / ComposerInputView) so
 * caret metrics stay plain-text and the two surfaces never disagree. Keep this
 * chip for non-caret surfaces that want heavier chrome (e.g. future menus).
 */

import cs from "classnames";
import { mentionKindClass, type MentionKind } from "@/lib/mentionTokens";
import { MentionIconView, type MentionIconKind } from "./MentionIconView";

type MentionChipViewProps = {
  /** Token classification; drives both icon and tint. */
  kind: MentionIconKind;
  /** Visible label — the path or command name, already unquoted. */
  label: string;
  /** Full token for the native tooltip when the label truncates. */
  title?: string;
  className?: string;
};

/**
 * Renders one mention token as a chip.
 * @param props Kind, display label, optional tooltip and extra classes.
 * @returns An inline chip; an empty label still renders the icon so a malformed
 *   token stays visible instead of collapsing into invisible whitespace.
 */
export function MentionChipView(props: MentionChipViewProps) {
  const { kind, label, title, className } = props;
  const tintKind: MentionKind = kind === "skill" ? "command" : kind;

  return (
    <span
      className={cs("mention-chip", mentionKindClass(tintKind), className)}
      title={title ?? label}
      data-mention-kind={kind}
    >
      <MentionIconView kind={kind} className="mention-chip-icon" />
      <span className="mention-chip-label">{label}</span>
    </span>
  );
}
