/** @type {import('npm-check-updates').RunOptions} */
module.exports = {
  removeRange: true,
  cooldown: 14,
  // Jest is held at 30.4.2: 30.5.1 is broken, 30.5.2 is fixed. See
  // https://github.com/jestjs/jest/issues/16438 for details. This can be
  // removed in 15 days: 2026-10-03
  reject: ["jest", "jest-environment-node"],
  // Respect peer ranges of installed packages. Without this, ncu happily bumps
  // typescript past what typescript-eslint supports (it caps at <6.1.0 as of
  // 8.65.0), and the subsequent `npm install` dies with ERESOLVE.
  peer: true,
  // Only this checkout's manifest. Agent worktrees under .claude/worktrees are
  // full checkouts with their own package.json, and ncu has no path-ignore
  // option — `--deep` would rewrite theirs too.
  packageFile: "package.json",
};
