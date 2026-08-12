/**
 * Agent environment sheet — wide two-pane modal for MCP / Skills / inspect domains.
 * Replaces the old Extensions JSON drawer. Stateful: one useEnvironmentWidget hook.
 */

import { useEffect, useId, useLayoutEffect, useRef } from "react";
import {
  focusInitialIn,
  restoreFocus,
  trapFocusTab,
} from "@/lib/focusTrap";
import type { EnvironmentPageId } from "@/store/environmentStore";
import { EnvironmentNavView } from "./EnvironmentNavView";
import { EnvironmentOverviewView } from "./EnvironmentOverviewView";
import { EnvironmentMcpView } from "./EnvironmentMcpView";
import { EnvironmentSkillsView } from "./EnvironmentSkillsView";
import { EnvironmentStubPageView } from "./EnvironmentStubPageView";
import { useEnvironmentWidget } from "./useEnvironmentWidget";

export type EnvironmentSheetWidgetProps = {
  /** Whether the modal is visible. */
  open: boolean;
  /** Dismiss handler (Close, backdrop, Escape). */
  onClose: () => void;
  /** Optional deep-link page applied when open becomes true. */
  initialPage?: EnvironmentPageId;
};

/**
 * Modal Environment catalog sheet.
 * @param props open/onClose/initialPage from App shell.
 * @returns null when closed; otherwise backdrop + two-pane dialog.
 */
export function EnvironmentSheetWidget(props: EnvironmentSheetWidgetProps) {
  const { open, onClose, initialPage } = props;
  const model = useEnvironmentWidget({ open, onClose, initialPage });
  const panelRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useLayoutEffect(() => {
    if (!open) {
      return;
    }
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    focusInitialIn(panelRef.current);
    return () => {
      restoreFocus(previousFocusRef.current);
      previousFocusRef.current = null;
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (document.querySelector('[role="alertdialog"][aria-modal="true"]')) {
          return;
        }
        e.preventDefault();
        onClose();
        return;
      }
      if (panelRef.current) {
        trapFocusTab(e, panelRef.current);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  const pageBody = renderPage(model);

  return (
    <>
      <button
        type="button"
        className="side-panel-backdrop"
        aria-label="Close environment"
        onClick={onClose}
      />
      <div className="fixed inset-0 z-95 flex items-center justify-center p-4 pointer-events-none">
        <div
          ref={panelRef}
          className="env-sheet pointer-events-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
        >
          <header className="env-sheet-head">
            <h2 id={titleId} className="env-sheet-title">
              Agent environment
            </h2>
            <button
              type="button"
              className="side-panel-close"
              onClick={onClose}
            >
              Close
            </button>
          </header>
          {model.error ? (
            <p className="panel-note panel-note-danger mx-3 mt-2" role="alert">
              {model.error}
              <button
                type="button"
                className="btn-ghost ml-2"
                onClick={model.clearError}
              >
                Dismiss
              </button>
            </p>
          ) : null}
          <div className="env-sheet-body">
            <EnvironmentNavView
              items={model.navItems}
              active={model.page}
              onSelect={model.setPage}
            />
            <div className="env-page min-w-0">{pageBody}</div>
          </div>
        </div>
      </div>
    </>
  );
}

/**
 * Pick the active page body for the sheet.
 * @param model Assembled widget model.
 */
function renderPage(model: ReturnType<typeof useEnvironmentWidget>) {
  switch (model.page) {
    case "overview":
      return (
        <EnvironmentOverviewView
          snapshot={model.snapshot}
          onOpenPage={model.setPage}
        />
      );
    case "mcp":
      return (
        <EnvironmentMcpView
          rows={model.mcpRows}
          workspace={model.workspace}
          onRefresh={model.refresh}
          loading={model.loading}
          loadedLabel={model.loadedLabel}
          onDoctor={model.onDoctor}
          pending={model.pending}
        />
      );
    case "skills":
      return (
        <EnvironmentSkillsView
          rows={model.skillRows}
          workspace={model.workspace}
          onRefresh={model.refresh}
          loading={model.loading}
          loadedLabel={model.loadedLabel}
        />
      );
    case "agents":
      return (
        <EnvironmentStubPageView
          page="agents"
          title="Agents"
          count={model.snapshot?.agents.length ?? 0}
          onRefresh={model.refresh}
          loading={model.loading}
          loadedLabel={model.loadedLabel}
        />
      );
    case "plugins":
      return (
        <EnvironmentStubPageView
          page="plugins"
          title="Plugins"
          count={model.snapshot?.plugins.length ?? 0}
          onRefresh={model.refresh}
          loading={model.loading}
          loadedLabel={model.loadedLabel}
        />
      );
    case "marketplaces":
      return (
        <EnvironmentStubPageView
          page="marketplaces"
          title="Marketplaces"
          count={model.snapshot?.marketplaces.length ?? 0}
          onRefresh={model.refresh}
          loading={model.loading}
          loadedLabel={model.loadedLabel}
        />
      );
    case "hooks":
      return (
        <EnvironmentStubPageView
          page="hooks"
          title="Hooks"
          count={model.snapshot?.hooks.length ?? 0}
          onRefresh={model.refresh}
          loading={model.loading}
          loadedLabel={model.loadedLabel}
        />
      );
    case "rules":
      return (
        <EnvironmentStubPageView
          page="rules"
          title="Rules"
          count={model.snapshot?.instructions.length ?? 0}
          onRefresh={model.refresh}
          loading={model.loading}
          loadedLabel={model.loadedLabel}
        />
      );
    case "compat":
      return (
        <EnvironmentStubPageView
          page="compat"
          title="Compatibility"
          count={model.snapshot?.compat.length ?? 0}
          onRefresh={model.refresh}
          loading={model.loading}
          loadedLabel={model.loadedLabel}
        />
      );
    default:
      return null;
  }
}
