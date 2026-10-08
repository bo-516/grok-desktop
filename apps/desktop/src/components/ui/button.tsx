/**
 * shadcn/ui Button with app-token chrome.
 *
 * Source: `npx shadcn@latest add button` (new-york). Variants and the
 * `asChild` Slot behavior follow upstream; colors are bridged from shadcn's
 * stone defaults to `--color-*` tokens (same family as `btn` /
 * `btn-primary` / `btn-ghost`), and sizes are px because the html root font
 * is 13px (rem utilities render smaller than their names suggest).
 */

import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/**
 * Class recipe per variant / size. Exported so links or Radix triggers can
 * borrow button chrome without rendering a Button.
 */
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-control border text-12px font-medium whitespace-nowrap cursor-pointer transition-colors duration-fast ease-soft outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-line-focus disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-[14px]",
  {
    variants: {
      variant: {
        default:
          "border-primary bg-primary text-on-primary hover:bg-accent-hover hover:border-accent-hover",
        destructive:
          "border-danger bg-danger-muted text-danger hover:bg-white-soft",
        outline:
          "border-line-subtle bg-white-faint text-fg hover:bg-white-soft hover:border-line-muted",
        secondary:
          "border-transparent bg-white-soft text-fg hover:bg-white-hover",
        ghost:
          "border-transparent bg-transparent text-fg-secondary hover:bg-white-soft hover:text-fg",
        link: "border-transparent bg-transparent text-accent underline-offset-4 hover:underline",
      },
      size: {
        default: "h-[30px] px-3",
        xs: "h-[22px] gap-1 px-1.5 text-11px [&_svg:not([class*='size-'])]:size-[12px]",
        sm: "h-[26px] px-2.5",
        lg: "h-[34px] px-4 text-13px",
        icon: "size-[30px] p-0",
        "icon-sm": "size-[26px] p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

/** Props: native button props + variant / size + optional asChild. */
export type ButtonProps = ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    /** Render the single child element with button props (Radix Slot). */
    asChild?: boolean;
  };

/**
 * Token-mapped button.
 * @param props Native props, `variant` (default primary fill), `size`, and
 *   `asChild` to merge onto a child element instead of rendering `<button>`.
 * @returns `<button>` (or the slotted child) with `data-variant` / `data-size`.
 */
function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button";
  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
