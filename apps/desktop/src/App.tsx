/**
 * Grok Desktop shell — region assembly only.
 * Chrome state lives in useAppShellWidget; composer draft stays local.
 * Live grok-build only (bridge → agent stdio).
 */

import { TimelineView } from "./widgets/TimelineView";
import { ComposerWidget } from "@/widgets/composer";
import { PermissionModalView } from "./widgets/PermissionModalView";
import { SessionRailView } from "./widgets/SessionRailView";
import { TopNavWidget } from "./widgets/TopNavWidget";
import { CommandPaletteWidget } from "./widgets/CommandPaletteWidget";
import { ExtensionsPanelWidget } from "./widgets/ExtensionsPanelWidget";
import { SettingsPanelWidget } from "./widgets/SettingsPanelWidget";
import { MultiSessionOverviewWidget } from "./widgets/MultiSessionOverviewWidget";
import { TasksPanelWidget } from "./widgets/TasksPanelWidget";
import { ConfirmDialogView } from "./widgets/ConfirmDialogView";
import { ContextRailWidget } from "./widgets/contextRail/ContextRailWidget";
import { ShellBannersView, useAppShellWidget } from "./widgets/shell";
import { buildConfirmPrompt } from "./lib/confirmAction";
import { buildRewindCommand, rewindConfirm } from "./lib/sessionActions";

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
      <SessionRailView
        open={shell.railOpen}
        onClose={() => shell.setRailOpen(false)}
        onRequestDelete={shell.requestDelete}
        liveCount={shell.liveCount}
      />

      <div className="main-column">
        <TopNavWidget
          title={shell.title}
          syncLabel={shell.syncLabel}
          live={shell.live}
          contextRailOpen={shell.contextRail === "plan"}
          planCount={shell.planCount}
          onToggleContextRail={shell.toggleContext}
          onRequestRewind={shell.requestRewind}
          onRequestDelete={shell.requestDelete}
          railOpen={shell.railOpen}
          onToggleRail={() => shell.setRailOpen((o) => !o)}
        />

        <div className="main-body">
          <section className="main">
            <ShellBannersView
              live={shell.live}
              envKnown={shell.envKnown}
              authOk={shell.authOk}
              authMessage={shell.environment?.message}
              restartNotice={shell.restartNotice}
              queueLength={shell.promptQueue.length}
              waitingPermission={
                shell.session.status === "waiting_permission"
              }
              onLogin={() => void shell.runCli("auth_login")}
              onDismissRestart={shell.clearRestartNotice}
            />
            <TimelineView />
            <ComposerWidget />
          </section>

          {shell.contextRail === "plan" ? (
            <ContextRailWidget
              plan={shell.session.plan}
              onClose={shell.closeContextRail}
            />
          ) : null}
          <ExtensionsPanelWidget
            open={shell.activePanel === "extensions"}
            onClose={shell.closePanel}
          />
          <SettingsPanelWidget
            open={shell.activePanel === "settings"}
            onClose={shell.closePanel}
          />
          <MultiSessionOverviewWidget
            open={shell.activePanel === "overview"}
            onClose={shell.closePanel}
          />
          <TasksPanelWidget
            open={shell.activePanel === "tasks"}
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
