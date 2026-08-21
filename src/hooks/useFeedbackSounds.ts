"use client";

import { useCallback, useRef } from "react";

/**
 * Warehouse audio feedback via the Web Audio API.
 *
 * WHY SYNTHESISED, NOT AUDIO FILES: no network fetch, no decode delay, no
 * asset to 404. A scan sound that arrives late is worse than none, because the
 * operator has already moved on to the next tyre.
 *
 * WHY IT MUST BE UNLOCKED ON A USER GESTURE: browsers (iOS Safari especially)
 * create the AudioContext in a "suspended" state until a real user gesture
 * resumes it. The driver screen therefore calls `unlock()` inside the
 * "Începe scanarea" click handler — that click is the gesture that buys the
 * ability to beep later, when the match actually succeeds.
 *
 * The three cues are deliberately distinguishable without looking at the
 * screen: rising two-tone for success, single mid blip for a warning/duplicate,
 * low buzzing triple for an error.
 */

type Cue = "success" | "warning" | "error";

interface ToneStep {
  frequency: number;
  durationMs: number;
  gapMs?: number;
  type?: OscillatorType;
  gain?: number;
}

const CUES: Record<Cue, ToneStep[]> = {
  // Bright, rising, unmistakably positive.
  success: [
    { frequency: 880, durationMs: 90 },
    { frequency: 1320, durationMs: 140 },
  ],
  // Single flat blip: something happened, but not a new success.
  warning: [{ frequency: 620, durationMs: 180, type: "triangle" }],
  // Low and repeated: impossible to mistake for a success.
  error: [
    { frequency: 220, durationMs: 150, type: "square", gain: 0.18 },
    { frequency: 180, durationMs: 150, type: "square", gain: 0.18, gapMs: 60 },
    { frequency: 150, durationMs: 250, type: "square", gain: 0.18, gapMs: 60 },
  ],
};

export function useFeedbackSounds() {
  const contextRef = useRef<AudioContext | null>(null);

  /**
   * Must be called from inside a user-gesture handler (e.g. the click that
   * starts scanning). Safe to call repeatedly.
   */
  const unlock = useCallback(async () => {
    try {
      if (!contextRef.current) {
        const AudioContextCtor =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AudioContextCtor) return false;
        contextRef.current = new AudioContextCtor();
      }
      if (contextRef.current.state === "suspended") {
        await contextRef.current.resume();
      }
      return contextRef.current.state === "running";
    } catch {
      // Audio is a nicety; never let it break the scanning flow.
      return false;
    }
  }, []);

  const play = useCallback((cue: Cue) => {
    const context = contextRef.current;
    // Not unlocked yet: stay silent rather than throwing. Visual feedback on
    // the driver screen always carries the same information.
    if (!context || context.state !== "running") return;

    let startAt = context.currentTime;

    for (const step of CUES[cue]) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();

      oscillator.type = step.type ?? "sine";
      oscillator.frequency.setValueAtTime(step.frequency, startAt);

      const peak = step.gain ?? 0.22;
      const duration = step.durationMs / 1000;

      // Short attack/release ramps: a raw square edge clicks unpleasantly.
      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(peak, startAt + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(startAt);
      oscillator.stop(startAt + duration + 0.02);

      startAt += duration + (step.gapMs ?? 0) / 1000;
    }
  }, []);

  /** Short haptic pulse where supported. Pairs with, never replaces, the sound. */
  const vibrate = useCallback((cue: Cue) => {
    if (typeof navigator === "undefined" || !navigator.vibrate) return;
    if (cue === "success") navigator.vibrate(60);
    else if (cue === "warning") navigator.vibrate([40, 60, 40]);
    else navigator.vibrate([80, 60, 80, 60, 120]);
  }, []);

  const feedback = useCallback(
    (cue: Cue) => {
      play(cue);
      vibrate(cue);
    },
    [play, vibrate]
  );

  return { unlock, play, vibrate, feedback };
}
