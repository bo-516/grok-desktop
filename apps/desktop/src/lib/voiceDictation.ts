/**
 * Browser SpeechRecognition wrapper for voice dictation (F-MEDIA-04).
 * Returns null-shaped unsupported when API unavailable (honest degradation).
 * Parent owns toggle UI: call start/stop and render listening chrome from onEnd/errors.
 */

export type DictationHandle = {
  /** Start listening; interim/final text arrives via onText. */
  start: () => void;
  /** Stop listening; may fire onEnd after the engine settles. */
  stop: () => void;
  supported: true;
};

/**
 * Join frozen draft prefix with the current session transcript.
 * Inserts a single space when the prefix does not already end in whitespace.
 * @param prefix Draft snapshot taken when listening started (or empty).
 * @param transcript Cumulative interim+final text from this session (may be empty while quiet).
 * @returns Draft string that should replace the composer value for this update.
 */
export function joinDictationDraft(prefix: string, transcript: string): string {
  const t = transcript.trim();
  if (!t) {
    return prefix;
  }
  if (!prefix) {
    return t;
  }
  if (/\s$/u.test(prefix)) {
    return `${prefix}${t}`;
  }
  return `${prefix} ${t}`;
}

/**
 * Create a dictation session if Web Speech API exists.
 * @param onText Called with cumulative session transcript (final + current interim).
 * @param onError Called on recognition errors; session should be treated as ended.
 * @param onEnd Called when the engine ends (browser stop, silence, or explicit stop).
 */
export function createDictation(
  onText: (text: string) => void,
  onError?: (message: string) => void,
  onEnd?: () => void,
): DictationHandle | { supported: false; reason: string } {
  const w = typeof window !== "undefined" ? window : undefined;
  const SR =
    w &&
    ((w as unknown as { SpeechRecognition?: new () => SpeechRecognition })
      .SpeechRecognition ||
      (w as unknown as { webkitSpeechRecognition?: new () => SpeechRecognition })
        .webkitSpeechRecognition);
  if (!SR) {
    return {
      supported: false,
      reason: "Web Speech API not available in this browser",
    };
  }
  const rec = new SR();
  rec.continuous = true;
  rec.interimResults = true;
  let finalText = "";
  let ended = false;
  const finish = () => {
    if (ended) {
      return;
    }
    ended = true;
    onEnd?.();
  };
  rec.onresult = (ev: SpeechRecognitionEvent) => {
    let interim = "";
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const r = ev.results[i];
      if (!r) {
        continue;
      }
      if (r.isFinal) {
        finalText += r[0]?.transcript ?? "";
      } else {
        interim += r[0]?.transcript ?? "";
      }
    }
    onText((finalText + interim).trim());
  };
  rec.onerror = (ev: SpeechRecognitionErrorEvent) => {
    // "aborted" is normal when we call stop(); treat as end, not a user-facing error.
    if (ev.error === "aborted") {
      finish();
      return;
    }
    onError?.(ev.error || "speech error");
    finish();
  };
  rec.onend = () => {
    finish();
  };
  return {
    supported: true,
    start: () => {
      try {
        rec.start();
      } catch (e) {
        onError?.(e instanceof Error ? e.message : String(e));
        finish();
      }
    },
    stop: () => {
      try {
        rec.stop();
      } catch {
        finish();
      }
    },
  };
}

// Minimal types for environments without DOM lib speech types
type SpeechRecognition = {
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((ev: SpeechRecognitionEvent) => void) | null;
  onerror: ((ev: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
};
type SpeechRecognitionEvent = {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0?: { transcript: string } }>;
};
type SpeechRecognitionErrorEvent = { error: string };
