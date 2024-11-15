// src/number.ts

export function isNumber(value: unknown): value is number {
  return typeof value === "number" && !isNaN(value) && isFinite(value);
}

export function toInt(value: unknown): number | undefined {
  try {
    return parseInt(String(value), 10);
  } catch {
    return;
  }
}
