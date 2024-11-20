// src/number.ts

export function isNumber(value: unknown): value is number {
  return typeof value === "number" && isFinite(value);
}

export function toInt(value: unknown): number | undefined {
  try {
    const i = parseInt(String(value), 10);
    return isNumber(i) ? i : undefined;
  } catch {
    return;
  }
}

export function gt0(value: unknown): value is number {
  return isNumber(value) && value > 0;
}
