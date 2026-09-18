/** @type {import('npm-check-updates').RunOptions} */
module.exports = {
  removeRange: true,
  cooldown: 14,
  // Respect peer ranges of installed packages. Without this, ncu happily bumps
  // typescript past what typescript-eslint supports (it caps at <6.1.0 as of
  // 8.65.0), and the subsequent `npm install` dies with ERESOLVE.
  peer: true,
  // Only this checkout's manifest. Agent worktrees under .claude/worktrees are
  // full checkouts with their own package.json, and ncu has no path-ignore
  // option — `--deep` would rewrite theirs too.
  packageFile: "package.json",
};
