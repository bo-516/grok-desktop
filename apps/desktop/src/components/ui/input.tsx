/**
 * shadcn/ui Input with app-token chrome.
 *
 * Source: `npx shadcn@latest add input` (new-york); stone colors are bridged
 * to the composer field tokens (`field` / `field-focus`) and sizes are px
 * (13px root font).
 */

import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/**
 * Single-line text field.
 * @param props Native input props; `aria-invalid` paints the danger border.
 * @returns `<input data-slot="input">`.
 */
function Input({ className, type, ...props }: ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-[30px] w-full min-w-0 rounded-control border border-field bg-white-faint px-2.5 text-12px text-fg outline-none transition-colors duration-fast ease-soft placeholder:text-fg-faint focus-visible:outline-none focus-visible:border-field-focus disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
