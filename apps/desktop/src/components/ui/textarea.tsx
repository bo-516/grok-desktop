/**
 * shadcn/ui Textarea with app-token chrome.
 *
 * Source: `npx shadcn@latest add textarea` (new-york); colors bridged to the
 * field tokens like ./input, sizes in px (13px root font). Keeps upstream's
 * `field-sizing-content` so the box grows with its text up to max-height.
 */

import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/**
 * Multi-line text field.
 * @param props Native textarea props; `aria-invalid` paints the danger border.
 * @returns `<textarea data-slot="textarea">`.
 */
function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-[64px] w-full rounded-control border border-field bg-white-faint px-2.5 py-2 text-12px leading-snug text-fg outline-none transition-colors duration-fast ease-soft placeholder:text-fg-faint focus-visible:outline-none focus-visible:border-field-focus disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
