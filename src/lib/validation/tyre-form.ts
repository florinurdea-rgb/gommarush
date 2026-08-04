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

// Real tyre width/profile markings are always multiples of 5; rim diameters
// (inches) are whole numbers. Bounds match the realistic range seen on
// passenger and light-commercial tyres.
export const WIDTH_RANGE = { min: 115, max: 335, step: 5 };
export const PROFILE_RANGE = { min: 20, max: 85, step: 5 };
export const RIM_RANGE = { min: 10, max: 24, step: 1 };

export type TyreDimensionCheck = "empty" | "invalid" | "ok";

function checkDimension(
  value: string,
  { min, max, step }: { min: number; max: number; step: number }
): TyreDimensionCheck {
  const trimmed = value.trim();
  if (!trimmed) return "empty";
  if (!/^[0-9]+$/.test(trimmed)) return "invalid";
  const n = parseInt(trimmed, 10);
  if (n < min || n > max || n % step !== 0) return "invalid";
  return "ok";
}

export function checkWidth(value: string): TyreDimensionCheck {
  return checkDimension(value, WIDTH_RANGE);
}

export function checkProfile(value: string): TyreDimensionCheck {
  return checkDimension(value, PROFILE_RANGE);
}

export function checkRim(value: string): TyreDimensionCheck {
  return checkDimension(value, RIM_RANGE);
}

export const QUANTITY_RANGE = { min: 1, max: 100 };

export function isValidQuantity(value: string): boolean {
  const trimmed = value.trim();
  if (!/^[0-9]+$/.test(trimmed)) return false;
  const n = parseInt(trimmed, 10);
  return n >= QUANTITY_RANGE.min && n <= QUANTITY_RANGE.max;
}
