/** @type {import('npm-check-updates').RunOptions} */
module.exports = {
  removeRange: true,
  cooldown: 14,
  // Jest 30.5.1's source-map formatter resolves ts-jest's absolute Windows
  // source paths as relative paths (src/D:/a/...). Keep the working pair until
  // a Windows CJS + ESM run verifies an upstream fix.
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
