/**
 * shadcn/ui Dialog (Radix) with app-token chrome.
 *
 * Purpose: modal forms (git commit / pull request). Radix traps focus,
 * restores it on close, closes on Escape / overlay click and sets
 * aria-modal + labelling from DialogTitle / DialogDescription.
 *
 * Source: `npx shadcn@latest add dialog` (new-york). Behavior and exports
 * follow upstream; colors map to the confirm-modal family (`bg-overlay`,
 * elevated surface, `shadow-modal`, `rounded-modal`). z-110 matches the
 * app's modal layer — above menus (z-105) and the off-canvas rail (z-100).
 */

import { XIcon } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/**
 * Root; pass `open` + `onOpenChange` to control it.
 * @param props Radix Root props.
 * @returns Context provider only.
 */
function Dialog(props: ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

/**
 * Element that opens the dialog (use `asChild` to reuse a button).
 * @param props Radix Trigger props.
 * @returns Trigger.
 */
function DialogTrigger(props: ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

/**
 * Portal into document.body (DialogContent already uses it).
 * @param props Radix Portal props.
 * @returns Portal.
 */
function DialogPortal(props: ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

/**
 * Element that closes the dialog.
 * @param props Radix Close props.
 * @returns Close control.
 */
function DialogClose(props: ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

/**
 * Full-window dimmer behind the panel.
 * @param props Radix Overlay props + className.
 * @returns Overlay.
 */
function DialogOverlay({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 z-110 bg-overlay data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
        className,
      )}
      {...props}
    />
  );
}

/**
 * Centered panel (portal + overlay included).
 * @param props Radix Content props; `showCloseButton` (default true) adds the ✕.
 * @returns Portaled dialog surface.
 */
function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> & {
  /** Render the top-right close glyph. */
  showCloseButton?: boolean;
}) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          "fixed top-[50%] left-[50%] z-110 grid w-[min(480px,92vw)] max-h-[86vh] translate-x-[-50%] translate-y-[-50%] gap-4 overflow-y-auto rounded-modal border border-line-subtle bg-elevated px-5 pt-5 pb-4 text-fg shadow-modal outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton ? (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            className="absolute top-4 right-4 flex size-[24px] items-center justify-center rounded-control border-none bg-transparent text-fg-muted cursor-pointer transition-colors duration-fast hover:bg-white-soft hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-line-focus [&_svg]:size-[14px]"
          >
            <XIcon aria-hidden />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        ) : null}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

/**
 * Title + description stack.
 * @param props div props.
 * @returns Header block.
 */
function DialogHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-1.5 pr-8 text-left", className)}
      {...props}
    />
  );
}

/**
 * Right-aligned action row.
 * @param props div props.
 * @returns Footer block.
 */
function DialogFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn("flex flex-row flex-wrap items-center justify-end gap-2 pt-1", className)}
      {...props}
    />
  );
}

/**
 * Accessible dialog title.
 * @param props Radix Title props.
 * @returns Heading.
 */
function DialogTitle({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("m-0 text-15px font-medium leading-snug tracking-tight text-fg", className)}
      {...props}
    />
  );
}

/**
 * Accessible dialog description.
 * @param props Radix Description props.
 * @returns Paragraph.
 */
function DialogDescription({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("m-0 text-12px leading-snug text-fg-secondary", className)}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
