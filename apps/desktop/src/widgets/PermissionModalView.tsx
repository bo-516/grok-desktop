/**
 * Permission modal for session/request_permission outcomes.
 * Options: allow once / always / deny / deny and stop.
 * Single-submit guard prevents double-click from sending two replies.
 */

import { useEffect, useRef, useState } from "react";
import { FadeContent } from "@/components/react-bits";
import { useSessionStore } from "../store/sessionStore";

export function PermissionModalView() {
  const pending = useSessionStore((s) => s.session.pendingPermission);
  const respondPermission = useSessionStore((s) => s.respondPermission);
  const [submitting, setSubmitting] = useState(false);
  const firstButtonRef = useRef<HTMLButtonElement | null>(null);

  // Focus primary action when a new permission arrives; reset submit guard.
  useEffect(() => {
    if (!pending) {
      setSubmitting(false);
      return;
    }
    setSubmitting(false);
    const id = requestAnimationFrame(() => {
      firstButtonRef.current?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [pending?.requestId]);

  if (!pending) {
    return null;
  }

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

  const onChoose = (optionId: string) => {
    if (submitting) {
      return;
    }
    setSubmitting(true);
    respondPermission(optionId);
  };

  return (
    <div className="overlay" role="presentation">
      <FadeContent immediate durationMs={240}>
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
            {options.map((opt, index) => {
              const danger =
                opt.optionId === "deny" || opt.optionId === "deny_and_stop";
              return (
                <button
                  key={opt.optionId}
                  ref={index === 0 ? firstButtonRef : undefined}
                  type="button"
                  className={danger ? "btn btn-danger" : "btn btn-primary"}
                  disabled={submitting}
                  onClick={() => onChoose(String(opt.optionId))}
                >
                  {opt.name ?? opt.optionId}
                </button>
              );
            })}
          </div>
        </div>
      </FadeContent>
    </div>
  );
}
