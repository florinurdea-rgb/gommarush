"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Handheld barcode scanner input.
 *
 * A warehouse scanner behaves as a HID keyboard: it "types" the token very
 * quickly and finishes with Enter. So the reliable approach is an always-focused
 * input that the operator never has to click into — they just scan, and the next
 * scan works too.
 *
 * Two details that matter on a real floor:
 *   * focus is re-asserted on blur (a stray tap elsewhere must not break the
 *     station), on an interval, and on window focus
 *   * a burst-speed heuristic distinguishes a scanner from a human typing, so a
 *     manually typed token still works but is flagged as such
 */

/** A scanner emits characters far faster than a person can type. */
const SCANNER_MAX_INTERVAL_MS = 35;
const MIN_TOKEN_LENGTH = 4;

interface UseScannerInputOptions {
  onScan: (value: string, meta: { fromScanner: boolean }) => void;
  /** Pause capture, e.g. while a modal has focus. */
  disabled?: boolean;
}

export function useScannerInput({ onScan, disabled = false }: UseScannerInputOptions) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);

  const keyTimesRef = useRef<number[]>([]);

  const focus = useCallback(() => {
    if (disabled) return;
    inputRef.current?.focus();
  }, [disabled]);

  // Keep the hidden input focused so a scan always lands somewhere.
  useEffect(() => {
    if (disabled) return;
    focus();
    const interval = window.setInterval(focus, 1500);
    window.addEventListener("focus", focus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", focus);
    };
  }, [disabled, focus]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key !== "Enter") {
        keyTimesRef.current.push(Date.now());
        // Only the recent tail matters for the speed heuristic.
        if (keyTimesRef.current.length > 40) keyTimesRef.current.shift();
        return;
      }

      event.preventDefault();
      const token = value.trim();
      setValue("");

      const times = keyTimesRef.current;
      keyTimesRef.current = [];

      if (token.length < MIN_TOKEN_LENGTH) return;

      // Median inter-key gap: robust against one slow keystroke at the start.
      let fromScanner = false;
      if (times.length >= 4) {
        const gaps: number[] = [];
        for (let i = 1; i < times.length; i += 1) gaps.push(times[i] - times[i - 1]);
        gaps.sort((a, b) => a - b);
        fromScanner = gaps[Math.floor(gaps.length / 2)] <= SCANNER_MAX_INTERVAL_MS;
      }

      onScan(token, { fromScanner });
    },
    [onScan, value]
  );

  /**
   * Props for the hidden input. It is visually hidden but NOT `display:none` and
   * NOT `disabled` — either would make it unfocusable, and an unfocusable input
   * cannot receive a scan.
   */
  const inputProps = {
    ref: inputRef,
    value,
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => setValue(event.target.value),
    onKeyDown: handleKeyDown,
    onFocus: () => setFocused(true),
    onBlur: () => {
      setFocused(false);
      // Re-assert after the click that stole focus has settled.
      window.setTimeout(focus, 120);
    },
    autoComplete: "off",
    autoCorrect: "off",
    autoCapitalize: "off",
    spellCheck: false,
    "aria-label": "Câmp de scanare cod de bare",
  };

  return { inputProps, focus, focused, value, setValue };
}
