/**
 * Composer voice-dictation state (F-MEDIA-04).
 * Owns the Web Speech session, listening flag, and draft prefix so interim
 * transcripts do not double-append. Parent wires Mic chip + input chrome from
 * `dictating` and calls `stopDictation` on send / unmount-adjacent paths.
 * Does not own status-row copy — listening text lives only in composerStatus.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type RefObject,
} from "react";
import {
  createDictation,
  joinDictationDraft,
  type DictationHandle,
} from "../../lib/voiceDictation";
import type { ComposerNoticeTone } from "./composerStatus";

export type UseComposerDictationConfig = {
  /** Current draft; frozen as prefix when listening starts. */
  draft: string;
  /** Whether the composer can accept input (bridge connected). */
  canType: boolean;
  /** True while a permission modal owns the turn. */
  waitingPermission: boolean;
  /** Programmatic draft write that also moves the caret (speech updates). */
  setDraftWithCaret: (value: string, caret: number) => void;
  /** Textarea focus target after starting. */
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  /**
   * Surface gate failures and engine errors on the shared notice channel.
   * Listening status is NOT written here — the status resolver owns that copy.
   */
  showNotice: (text: string, tone: ComposerNoticeTone) => void;
  /** Underlying completion onChange; wrapped so typing stops the mic. */
  onDraftChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
};

export type UseComposerDictationResult = {
  /** True while the speech engine is capturing. */
  dictating: boolean;
  /** Toggle start/stop; no-ops with a warn notice when typing is blocked. */
  toggleDictation: () => void;
  /** Stop without wiping draft; safe when idle. */
  stopDictation: () => void;
  /**
   * onChange for the textarea: stops dictation if the user types so the next
   * interim result cannot overwrite keystrokes.
   */
  handleDraftChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
};

/**
 * Local mic lifecycle for the composer bar + input listening chrome.
 * @param config Draft, gates, and notice/caret writers from the parent widget.
 * @returns Listening flag and handlers; missing setDraftWithCaret leaves speech updates no-ops.
 */
export function useComposerDictation(
  config: UseComposerDictationConfig,
): UseComposerDictationResult {
  const {
    draft,
    canType,
    waitingPermission,
    setDraftWithCaret,
    textareaRef,
    showNotice,
    onDraftChange,
  } = config;

  const [dictating, setDictating] = useState(false);
  const dictationRef = useRef<DictationHandle | null>(null);
  /** Draft snapshot when listening started; each speech update is prefix + session transcript. */
  const dictationPrefixRef = useRef("");

  /**
   * End the active dictation session and clear listening chrome.
   * Safe when no session is running; does not wipe draft text or notices.
   */
  const stopDictation = useCallback(() => {
    const handle = dictationRef.current;
    dictationRef.current = null;
    setDictating(false);
    handle?.stop();
  }, []);

  /**
   * Toggle voice dictation via Web Speech API when available.
   * First click freezes the current draft as prefix and starts listening;
   * second click (or engine end/error) stops. Gate failures are warn notices only.
   */
  const toggleDictation = useCallback(() => {
    if (dictationRef.current) {
      stopDictation();
      return;
    }
    if (!canType || waitingPermission) {
      showNotice(
        waitingPermission
          ? "Resolve the permission request before dictating"
          : "Connect the bridge before dictating",
        "warn",
      );
      return;
    }
    const handle = createDictation(
      (text) => {
        const next = joinDictationDraft(dictationPrefixRef.current, text);
        setDraftWithCaret(next, next.length);
      },
      (err) => {
        dictationRef.current = null;
        setDictating(false);
        showNotice(`Dictation: ${err}`, "warn");
      },
      () => {
        // Engine ended (browser stop, silence, or our stop()).
        if (dictationRef.current) {
          dictationRef.current = null;
          setDictating(false);
        }
      },
    );
    if (!handle.supported) {
      showNotice(handle.reason, "warn");
      return;
    }
    dictationPrefixRef.current = draft;
    dictationRef.current = handle;
    setDictating(true);
    handle.start();
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });
  }, [
    canType,
    draft,
    setDraftWithCaret,
    showNotice,
    stopDictation,
    textareaRef,
    waitingPermission,
  ]);

  /**
   * Manual typing while the mic is open takes ownership of the draft:
   * stop the engine so the next interim result does not overwrite keystrokes.
   */
  const handleDraftChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      if (dictationRef.current) {
        stopDictation();
      }
      onDraftChange(event);
    },
    [onDraftChange, stopDictation],
  );

  /** Drop the mic session on unmount so the browser stops capturing audio. */
  useEffect(() => {
    return () => {
      dictationRef.current?.stop();
      dictationRef.current = null;
    };
  }, []);

  return {
    dictating,
    toggleDictation,
    stopDictation,
    handleDraftChange,
  };
}
