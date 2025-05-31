import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isHidden, isHiddenRecursive, setHidden } from "../index";

/**
 * This function exercises the hidden file functionality and is used by both
 * memory.test and hidden.test suites.
 */
export async function validateHidden(dir: string) {
  await mkdir(dir, { recursive: true });
  let file = join(dir, "test.txt");
  await writeFile(file, "test");
  expect(await isHidden(dir)).toBe(false);
  expect(await isHidden(file)).toBe(false);
  expect(await isHiddenRecursive(dir)).toBe(false);
  expect(await isHiddenRecursive(file)).toBe(false);
  const hiddenDir = (await setHidden(dir, true)).pathname;
  expect(await isHidden(hiddenDir)).toBe(true);

  file = join(hiddenDir, "test.txt");
  expect(await isHidden(file)).toBe(false);
  expect(await isHiddenRecursive(file)).toBe(true);

  // This should be a no-op:
  expect(await setHidden(hiddenDir, true)).toEqual(
    expect.objectContaining({
      pathname: hiddenDir,
    }),
  );
  const hiddenFile = (await setHidden(file, true)).pathname;
  expect(await isHidden(hiddenFile)).toBe(true);
  expect(await isHidden(hiddenDir)).toBe(true);
}
