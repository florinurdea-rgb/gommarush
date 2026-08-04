const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Accepts phone numbers with digits, spaces, dashes, dots, parentheses, optional leading +
const PHONE_RE = /^\+?[0-9()\-.\s]{6,}$/;
const PHONE_DIGITS_MIN = 6;

export function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}

export function isValidPhone(value: string): boolean {
  const trimmed = value.trim();
  if (!PHONE_RE.test(trimmed)) return false;
  const digitCount = trimmed.replace(/[^0-9]/g, "").length;
  return digitCount >= PHONE_DIGITS_MIN;
}

export function isValidEmailOrPhone(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  return isValidEmail(trimmed) || isValidPhone(trimmed);
}

export function isValidTyreDimension(value: string): boolean {
  return /^[0-9]+$/.test(value.trim()) && value.trim().length > 0;
}
