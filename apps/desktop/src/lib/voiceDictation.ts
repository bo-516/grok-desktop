/**
 * Browser SpeechRecognition wrapper for voice dictation (F-MEDIA-04).
 * Returns null when API unavailable (honest degradation).
 */

export type DictationHandle = {
  /** Start listening; appends interim/final text via onText. */
  start: () => void;
  stop: () => void;
  supported: true;
};

/**
 * Create a dictation session if Web Speech API exists.
 * @param onText Called with cumulative transcript.
 * @param onError Called on recognition errors.
 */
export function createDictation(
  onText: (text: string) => void,
  onError?: (message: string) => void,
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
  rec.onresult = (ev: SpeechRecognitionEvent) => {
    let interim = "";
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const r = ev.results[i]!;
      if (r.isFinal) {
        finalText += r[0]?.transcript ?? "";
      } else {
        interim += r[0]?.transcript ?? "";
      }
    }
    onText((finalText + interim).trim());
  };
  rec.onerror = (ev: SpeechRecognitionErrorEvent) => {
    onError?.(ev.error || "speech error");
  };
  return {
    supported: true,
    start: () => {
      try {
        rec.start();
      } catch (e) {
        onError?.(e instanceof Error ? e.message : String(e));
      }
    },
    stop: () => {
      try {
        rec.stop();
      } catch {
        /* ignore */
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
};
type SpeechRecognitionEvent = {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0?: { transcript: string } }>;
};
type SpeechRecognitionErrorEvent = { error: string };
