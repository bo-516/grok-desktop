/**
 * Permission modal for session/request_permission outcomes.
 * Options: allow once / always / deny / deny and stop.
 */

import { useSessionStore } from "../store/sessionStore";

export function PermissionModalView() {
  const pending = useSessionStore((s) => s.session.pendingPermission);
  const respondPermission = useSessionStore((s) => s.respondPermission);

  if (!pending) {return null;}

  const title =
    pending.toolCall?.title ??
    pending.toolCall?.kind ??
    "Agent permission request";

  const options = pending.options ?? [
    { optionId: "allow_once", name: "Allow once" },
    { optionId: "allow_always", name: "Always allow this tool" },
    { optionId: "deny", name: "Deny" },
    { optionId: "deny_and_stop", name: "Deny and stop" },
  ];

  return (
    <div className="overlay" role="presentation">
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="perm-title"
      >
        <h2 id="perm-title">Permission required</h2>
        <p>
          Agent wants to run: <strong>{title}</strong>
          {pending.toolCall?.kind ? ` (${pending.toolCall.kind})` : ""}
        </p>
        <div className="modal-actions">
          {options.map((opt) => {
            const danger =
              opt.optionId === "deny" || opt.optionId === "deny_and_stop";
            return (
              <button
                key={opt.optionId}
                type="button"
                className={danger ? "btn btn-danger" : "btn btn-primary"}
                onClick={() => respondPermission(String(opt.optionId))}
              >
                {opt.name ?? opt.optionId}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
