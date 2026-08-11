/**
 * Root React error boundary — prevents a render throw from leaving a pure
 * black WebView with no recovery affordance. Logs via reportCrash and shows
 * the message + log directory hint.
 */

import { Component, type ErrorInfo, type ReactNode } from "react";
import { logDirHint, reportCrash } from "@/lib/crashLog";

type Props = {
  /** App tree to protect. */
  children: ReactNode;
};

type State = {
  /** Last caught error message, or null when healthy. */
  errorMessage: string | null;
  /** Optional component stack from React. */
  componentStack: string | null;
};

/**
 * Class boundary required by React (hooks cannot catch render errors).
 * Stateful presentation only — no store.
 */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { errorMessage: null, componentStack: null };

  /**
   * Derive UI state from the thrown value.
   * @param error Anything thrown during render (usually Error).
   */
  static getDerivedStateFromError(error: unknown): Partial<State> {
    const message =
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : "Unknown render error";
    return { errorMessage: message };
  }

  /**
   * Side-effect log after a child render failure.
   * @param error Thrown value.
   * @param info React component stack.
   */
  componentDidCatch(error: unknown, info: ErrorInfo): void {
    const message =
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : "Unknown render error";
    const stack =
      (error instanceof Error ? error.stack : undefined) ||
      info.componentStack ||
      undefined;
    reportCrash("error", message, {
      stack,
      source: "react.boundary",
    });
    this.setState({
      componentStack: info.componentStack ?? null,
    });
  }

  render(): ReactNode {
    const { errorMessage, componentStack } = this.state;
    if (!errorMessage) {
      return this.props.children;
    }
    const dir = logDirHint();
    return (
      <div
        className="min-h-screen flex flex-col items-start justify-center gap-3 p-8 bg-app text-fg"
        role="alert"
      >
        <h1 className="text-lg font-semibold m-0">Grok Desktop hit a render error</h1>
        <p className="m-0 text-fg-muted text-sm">
          The shell is still running; the UI tree failed. Details were written to
          the app log{dir ? ` under ${dir}` : ""} (ui-*.log / shell-*.log).
        </p>
        <pre className="m-0 p-3 rounded-8px bg-surface border border-line text-sm max-w-full overflow-auto whitespace-pre-wrap">
          {errorMessage}
        </pre>
        {componentStack ? (
          <pre className="m-0 p-3 rounded-8px bg-surface border border-line text-xs text-fg-muted max-w-full overflow-auto whitespace-pre-wrap max-h-48">
            {componentStack}
          </pre>
        ) : null}
        <button
          type="button"
          className="btn-ghost"
          onClick={() => {
            this.setState({ errorMessage: null, componentStack: null });
            window.location.reload();
          }}
        >
          Reload
        </button>
      </div>
    );
  }
}
