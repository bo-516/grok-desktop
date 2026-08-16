/**
 * Grok Desktop shell — region assembly only.
 * Chrome state lives in useAppShellWidget; composer draft stays local.
 * Live grok-build only (bridge → agent stdio).
 */

import cs from "classnames";
import type { CSSProperties } from "react";
import { TimelineWidget } from "@/widgets/timeline";
import { ComposerWidget } from "@/widgets/composer";
import { PermissionModalView } from "./widgets/PermissionModalView";
import { SessionRailWidget } from "@/widgets/sessionRail";
import { TopNavWidget } from "./widgets/TopNavWidget";
import { CommandPaletteWidget } from "./widgets/CommandPaletteWidget";
import { EnvironmentSheetWidget } from "@/widgets/environment";
import { SettingsPanelWidget } from "./widgets/SettingsPanelWidget";
import { MultiSessionOverviewWidget } from "./widgets/MultiSessionOverviewWidget";
import { ConfirmDialogView } from "./widgets/ConfirmDialogView";
import { ContextDrawerWidget } from "@/widgets/contextRail";
import { PreviewDrawerWidget } from "@/widgets/preview";
import { LoginGateView, useLoginGateWidget } from "@/widgets/auth";
import { ShellBannersView, useAppShellWidget } from "./widgets/shell";
import { buildConfirmPrompt } from "./lib/confirmAction";
import { buildRewindCommand, rewindConfirm } from "./lib/sessionActions";
import type { ContextRailId } from "./widgets/shell/shellPanels";

/**
 * Active Plan|Agents tab for the shared context drawer.
 * Agents wins when both flags are somehow true (mutual exclusion is the norm).
 * @param agentsRailOpen Whether the agents context rail is selected.
 * @param planRailOpen Whether the plan context rail is selected.
 * @returns `"agents"` | `"plan"` | null when neither is open.
 */
function contextDrawerRail(
  agentsRailOpen: boolean,
  planRailOpen: boolean,
): Extract<ContextRailId, "plan" | "agents"> | null {
  if (agentsRailOpen) {
    return "agents";
  }
  if (planRailOpen) {
    return "plan";
  }
  return null;
}

/**
 * Root shell: rails, top bar, timeline, composer, drawers, palette.
 * `data-sidebar` / `data-drawer` mirror the three-tier layout so tests
 * and the inspector can see dock vs overlay without reading class soup.
 * Signed out, the login screen covers all of it and the shell goes `inert`:
 * it stays mounted only because it owns the connection and the 3s login poll
 * that will close the gate — nothing of it is visible or reachable.
 * @returns Full app chrome wired via useAppShellWidget + live session store.
 */
export function App() {
  const shell = useAppShellWidget();
  const gate = useLoginGateWidget();
  const deletePrompt =
    shell.confirm?.kind === "session_delete"
      ? buildConfirmPrompt("session_delete", { label: shell.confirm.title })
      : null;
  const rewindPrompt =
    shell.confirm?.kind === "rewind" ? rewindConfirm(true) : null;

  return (
    <div
      className="app-shell"
      data-sidebar={shell.sidebarDocked ? "docked" : "overlay"}
      data-drawer={shell.drawerEffectiveLayout}
      inert={gate.open}
    >
      <SessionRailWidget
        open={shell.railOpen}
        sidebarDocked={shell.sidebarDocked}
        onClose={() => shell.setRailOpen(false)}
        onCollapse={shell.collapseSidebar}
        onRequestDelete={shell.requestDelete}
        liveCount={shell.liveCount}
      />

      <div
        className={cs("main-column", {
          "main-column-flush": !shell.sidebarDocked,
        })}
        style={
          shell.contextRailOpen
            ? ({
                ["--rail-right-width" as string]: `${shell.railWidthPx}px`,
              } as CSSProperties)
            : undefined
        }
      >
        <TopNavWidget
          title={shell.title}
          syncLabel={shell.syncLabel}
          live={shell.live}
          contextRailOpen={shell.contextRailOpen}
          pushMode={shell.pushMode}
          planCount={shell.planCount}
          runningSubagents={shell.runningSubagents}
          onToggleContextRail={shell.toggleContext}
          onRequestRewind={shell.requestRewind}
          onRequestDelete={shell.requestDelete}
          sidebarDocked={shell.sidebarDocked}
          railOpen={shell.railOpen}
          onToggleRail={shell.toggleRail}
        />

        <div
          className={cs("main-body", {
            "main-body-railed": shell.pushMode,
          })}
        >
          <section className="main">
            <ShellBannersView
              live={shell.live}
              envKnown={shell.envKnown}
              authOk={shell.authOk}
              authMessage={shell.environment?.message}
              restartNotice={shell.restartNotice}
              waitingPermission={
                shell.session.status === "waiting_permission"
              }
              onLogin={() => void shell.authLogin()}
              onDismissRestart={shell.clearRestartNotice}
            />
            <TimelineWidget />
            <ComposerWidget />
          </section>

          <ContextDrawerWidget
            open={shell.planRailOpen || shell.agentsRailOpen}
            rail={contextDrawerRail(shell.agentsRailOpen, shell.planRailOpen)}
            plan={shell.session.plan}
            runningSubagents={shell.runningSubagents}
            effectiveLayout={shell.drawerEffectiveLayout}
            pushPreferred={shell.drawerLayoutPref === "push"}
            layoutClamped={shell.layoutClamped}
            onClose={shell.closeContextRail}
            onSelectTab={shell.selectContextTab}
            onLayoutChange={shell.setDrawerLayout}
          />
          <PreviewDrawerWidget
            open={shell.previewRailOpen}
            effectiveLayout={shell.drawerEffectiveLayout}
            onClose={shell.closeContextRail}
          />
          <EnvironmentSheetWidget
            open={shell.activePanel === "environment"}
            onClose={shell.closePanel}
            initialPage={shell.environmentPage}
          />
          <SettingsPanelWidget
            open={shell.activePanel === "settings"}
            onClose={shell.closePanel}
          />
          <MultiSessionOverviewWidget
            open={shell.activePanel === "overview"}
            onClose={shell.closePanel}
          />
        </div>
      </div>

      {shell.session.pendingPermission ? <PermissionModalView /> : null}
      {/* Signed-out gate — portaled to <body>, so the `inert` shell above it
          cannot swallow the one control the user still needs. */}
      <LoginGateView
        open={gate.open}
        busy={gate.busy}
        onLogin={gate.onLogin}
      />
      <CommandPaletteWidget
        open={shell.paletteOpen}
        onClose={() => shell.setPaletteOpen(false)}
      />
      {deletePrompt && shell.confirm?.kind === "session_delete" ? (
        <ConfirmDialogView
          open
          title={deletePrompt.title}
          subject={deletePrompt.subject}
          details={deletePrompt.details}
          confirmLabel={deletePrompt.confirmLabel}
          cancelLabel={deletePrompt.cancelLabel}
          danger
          onCancel={shell.clearConfirm}
          onConfirm={() => {
            const id = shell.confirm?.kind === "session_delete"
              ? shell.confirm.id
              : "";
            shell.clearConfirm();
            if (!id) {
              return;
            }
            void shell.runCli("sessions_delete", { sessionId: id }).finally(
              () => {
                shell.removeSession(id);
              },
            );
          }}
        />
      ) : null}
      {rewindPrompt ? (
        <ConfirmDialogView
          open
          title={rewindPrompt.title}
          details={rewindPrompt.details}
          confirmLabel={rewindPrompt.confirmLabel}
          cancelLabel={rewindPrompt.cancelLabel}
          danger
          onCancel={shell.clearConfirm}
          onConfirm={() => {
            shell.clearConfirm();
            void shell.sendPrompt(buildRewindCommand());
          }}
        />
      ) : null}
    </div>
  );
}
