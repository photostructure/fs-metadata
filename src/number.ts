// src/number.ts

export function isNumber(value: unknown): value is number {
  return typeof value === "number" && isFinite(value);
}

const INTEGER_REGEX = /^-?\d+$/;

export function toInt(value: unknown): number | undefined {
  try {
    if (value == null) return;
    const s = String(value).trim();
    return INTEGER_REGEX.test(s) ? parseInt(s) : undefined;
  } catch {
    return;
  }
}

export function gt0(value: unknown): value is number {
  return isNumber(value) && value > 0;
}
