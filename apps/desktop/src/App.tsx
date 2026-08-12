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
 * @returns Full app chrome wired via useAppShellWidget + live session store.
 */
export function App() {
  const shell = useAppShellWidget();
  const deletePrompt =
    shell.confirm?.kind === "session_delete"
      ? buildConfirmPrompt("session_delete", { label: shell.confirm.title })
      : null;
  const rewindPrompt =
    shell.confirm?.kind === "rewind" ? rewindConfirm(true) : null;

  return (
    <div className="app-shell">
      <SessionRailWidget
        open={shell.railOpen}
        onClose={() => shell.setRailOpen(false)}
        onRequestDelete={shell.requestDelete}
        liveCount={shell.liveCount}
      />

      <div
        className="main-column"
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
          railOpen={shell.railOpen}
          onToggleRail={() => shell.setRailOpen((o) => !o)}
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
              queueLength={
                shell.promptQueue.filter(
                  (item) =>
                    item.sessionId === shell.session.id ||
                    item.sessionId === shell.viewingSessionId,
                ).length
              }
              waitingPermission={
                shell.session.status === "waiting_permission"
              }
              onLogin={() => void shell.runCli("auth_login")}
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
      <CommandPaletteWidget
        open={shell.paletteOpen}
        onClose={() => shell.setPaletteOpen(false)}
      />
      {deletePrompt && shell.confirm?.kind === "session_delete" ? (
        <ConfirmDialogView
          open
          title={deletePrompt.title}
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
