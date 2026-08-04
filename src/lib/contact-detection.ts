import "server-only";
import type { ContactType } from "./types/offer-request";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Digits, spaces, dashes, dots, parentheses, optional leading +
const PHONE_RE = /^\+?[0-9()\-.\s]{6,}$/;
const PHONE_DIGITS_MIN = 6;
const PHONE_DIGITS_MAX = 15; // E.164 max

function isEmail(value: string): boolean {
  return EMAIL_RE.test(value);
}

function isPhone(value: string): boolean {
  if (!PHONE_RE.test(value)) return false;
  const digitCount = value.replace(/[^0-9]/g, "").length;
  return digitCount >= PHONE_DIGITS_MIN && digitCount <= PHONE_DIGITS_MAX;
}

/**
 * Collapses incidental whitespace (double spaces, tabs) without touching
 * the digits, parentheses, dashes, or a leading "+" international prefix.
 */
function normalizePhoneSpacing(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export type ContactDetectionResult = {
  contactType: ContactType;
  normalizedContact: string;
} | null;

export function detectContact(rawValue: string): ContactDetectionResult {
  const trimmed = rawValue.trim();
  if (!trimmed) return null;

  if (isEmail(trimmed)) {
    return { contactType: "email", normalizedContact: trimmed.toLowerCase() };
  }

  if (isPhone(trimmed)) {
    return { contactType: "phone", normalizedContact: normalizePhoneSpacing(trimmed) };
  }

  return null;
}
