/**
 * grok CLI onboarding (login gate steps) and the custom grok path form.
 * Colors resolve through defineColor tokens via theme color names only.
 */

export const onboardingShortcuts: Record<string, string> = {
  /*
   * Wider gate column for steps that show commands and output; the sign-in
   * step keeps the narrow `login-gate` width.
   */
  "login-gate-wide": "w-[min(560px,92vw)] max-h-[calc(100vh-4rem)] overflow-y-auto",
  /* Small left-aligned caption above a command / form block. */
  "onboarding-label":
    "m-0 w-full text-left text-10px font-semibold uppercase tracking-wide text-fg-muted",
  /* Copyable command row: monospace line + Copy / Run buttons. */
  "onboarding-command":
    "w-full flex items-center gap-2 rounded-card border border-line-subtle bg-white-faint px-3 py-2 text-left",
  "onboarding-command-text":
    "flex-1 min-w-0 m-0 font-mono text-12px leading-snug text-fg break-all",
  /* "This will run" confirmation before a setup step executes. */
  "onboarding-confirm":
    "w-full flex flex-col gap-2 rounded-card border border-line-muted bg-white-soft px-3 py-2.5 text-left text-12px leading-snug text-fg",
  "onboarding-argv":
    "m-0 font-mono text-12px leading-snug text-fg whitespace-pre-wrap break-all",
  /* Live installer output. */
  "onboarding-log":
    "w-full max-h-48 overflow-auto m-0 rounded-card border border-line-subtle bg-white-code px-3 py-2 text-left font-mono text-11px leading-snug text-fg-secondary whitespace-pre-wrap break-all",
  "onboarding-status": "m-0 w-full text-left text-12px leading-snug text-fg-secondary",
  "onboarding-status-error": "text-danger",
  "onboarding-actions": "w-full flex flex-wrap items-center justify-center gap-2",
  "onboarding-row-actions": "flex shrink-0 items-center gap-1.5",
  /* Custom grok path form (Settings section and the gate). */
  "grok-bin-form": "w-full flex flex-col gap-2 text-left",
  "grok-bin-row": "flex items-center gap-2",
  "grok-bin-current": "m-0 text-11px leading-snug text-fg-secondary break-all",
  "grok-bin-error": "m-0 text-11px leading-snug text-danger break-all",
};
