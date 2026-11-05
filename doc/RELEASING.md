# Releasing `@photostructure/fs-metadata`

Releases start from a tested `main` commit. A maintainer approves the npm stage
with 2FA, and once npm serves the version, the workflow creates the immutable
GitHub release with the version's `CHANGELOG.md` section at the top of its
notes. Do not create or move a version tag manually, and do not run direct
npm publishing from a workstation.

## Before a release

Verify these conditions:

- The intended source commit is on `main`.
- The ordinary CI run for that commit is green.
- Any command that resolves or updates `package-lock.json` uses npm 11.10 or
  later. Compatibility tests may use an older bundled npm only for `npm ci`.
- `CHANGELOG.md` has the release notes under a heading that names the version
  bump: `## [Unreleased (patch)]`, `## [Unreleased (minor)]`, or
  `## [Unreleased (major)]`. The release job renames it to
  `## [X.Y.Z] - YYYY-MM-DD`, and those notes become the GitHub release notes.
- npm Trusted Publisher identifies `photostructure/fs-metadata` and
  `publish.yaml`, with only staged publishing allowed.
- GitHub Actions can read `SSH_SIGNING_KEY`, `GIT_USER_NAME`, and
  `GIT_USER_EMAIL`.

## Start and approve a release

1. Open the repository's **Build & Prepare Release** workflow.
2. Select **Run workflow** on `main`. It takes no input: the version bump comes
   from the `CHANGELOG.md` heading.
3. Wait for the lint, native prebuild, functional, memory, and TSan jobs.
4. Confirm that the release job creates one signed commit and one signed
   `vMAJOR.MINOR.PATCH` annotated tag.
5. In the tag-bound **Stage npm Release** workflow, wait for the **Stage
   package on npm** job to finish. Leave the workflow running: its **Create
   immutable GitHub release** job waits for your npm approval.
6. Download the one-day `npm-package-vMAJOR.MINOR.PATCH` artifact. Inspect
   `CONTENTS.txt` and `PACK.json`, and confirm the embedded
   `package/package.json` name and version match the tag.
7. Open **Staged Packages** from the npm user menu. Verify the package name,
   version, files, repository, source commit, workflow, and provenance.
8. Approve the stage with a maintainer's 2FA key.
9. Confirm that npm shows the version as public.
10. Wait for the **Create immutable GitHub release** job to finish, then
    confirm that GitHub shows an immutable release for the same tag, with the
    version's `CHANGELOG.md` section at the top of its notes.

## How the release works

- `build.yml` (**Build & Prepare Release**) reads the version bump from the
  `## [Unreleased (patch|minor|major)]` heading in `CHANGELOG.md` while the
  test matrix runs, and fails with instructions if that heading is missing,
  names no bump, or has no notes under it. Once both pass, it bumps the
  version, renames the heading to `## [X.Y.Z] - YYYY-MM-DD` with a new empty
  `## [Unreleased]` above it, adds the version's `[X.Y.Z]: <url>` link
  definition, pushes a signed release commit and annotated tag, and starts
  `publish.yaml` at that tag.
  [`photostructure/changelog-release-action`](https://github.com/photostructure/changelog-release-action)
  does the `CHANGELOG.md` work and the npm wait below.
- `publish.yaml` (**Stage npm Release**) validates the tag, rebuilds all eight
  prebuilds from it, packs one tarball, tests that tarball on every supported
  platform, and stages it with `npm stage publish`. npm trusts only this
  workflow file, by name, to stage the package, so renaming it means changing
  the package's trusted-publisher settings on npmjs.com.
- npm validates a staged package, which takes 5 to 20 minutes, then holds it
  until a maintainer approves it with 2FA.
- The **Create immutable GitHub release** job checks npm every 5 minutes, for up to
  5 hours 45 minutes.
  Any npm error other than "not found" (E404) ends the job early. Once npm
  serves the version, it re-verifies the signed tag and creates the immutable
  GitHub release. Its notes are the version's `CHANGELOG.md` section, followed
  by GitHub's generated notes. GitHub emails the release to the repository's
  watchers at that moment, so the email always announces a version they can
  install. If the npm stage is rejected, the job runs out of checks without
  creating a release; preserve the tag and use a new version for the
  correction.

## What the workflows enforce

- `build.yml` runs the full pre-tag test gate and verifies that every test job
  leaves tracked source unchanged. It also packs a tarball and installs and
  loads it on Linux, macOS, Windows, and Alpine, so `publish.yaml` never runs
  that procedure for the first time at a tag — a workflow file is frozen at its
  tag, so a defect there costs a version.
- The release job changes only `package.json`, `package-lock.json`, and
  `CHANGELOG.md`, signs the commit and tag, and pushes them atomically.
- `publish.yaml` accepts only a signed `vMAJOR.MINOR.PATCH` annotated tag whose
  package version and target commit match the workflow ref.
- All eight native binaries are rebuilt from that tag. Immediately before
  packaging, the workflow requires `prebuilds/` to contain exactly the expected
  paths — no missing or extra files. Platform and architecture are encoded in
  each `prebuilds/<platform>-<arch>/` path, with Linux libc in the filename.
- After packing, the tarball inventory must contain every expected native binary
  exactly once. This separately catches a `package.json` `files` allowlist
  regression.
- Artifact transport integrity comes from the pinned
  `actions/download-artifact` v8 action. GitHub records a SHA-256 digest when an
  artifact is uploaded; every download recalculates it and fails on a mismatch.
  The package carries no same-channel checksum as a substitute for that control.
- The staging job has no checkout, cache, project dependency installation,
  repository secret, third-party Action, or artifact executable. It alone has
  `id-token: write`.
- npm holds the package until a maintainer approves it with 2FA.

## Failure recovery

| Failure                                        | Response                                                                                      |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------- |
| A pre-tag job fails                            | Fix `main` and dispatch a new release run. No tag should exist.                               |
| `main` moves during the run                    | Dispatch again from the new head.                                                             |
| Tag validation or signature verification fails | Correct the release identity. Do not bypass validation.                                       |
| The tag exists but publisher dispatch fails    | Rerun only the dispatch job, or dispatch `publish.yaml` at that exact tag. Do not bump again. |
| A tagged build or package test fails           | Fix the workflow or source and release a new version. Do not move the tag.                    |
| The npm stage is wrong                         | Reject the stage and release a new version.                                                   |
| The GitHub release job fails before releasing  | Approve the stage if needed, then re-run the failed job, as described below.                  |
| An approved package is bad                     | Deprecate it or publish a corrected version. Never overwrite it.                              |

When a failure above calls for a new version after the tag exists, the release
commit has already moved the notes under `## [X.Y.Z] - YYYY-MM-DD` in
`CHANGELOG.md`, and the next release run fails until `## [Unreleased]` names a
bump and has notes. Rename that empty heading to
`## [Unreleased (patch|minor|major)]`, move the unpublished version's notes
under it, leave a line under `## [X.Y.Z]` saying that version was never
published, and then start the new release.

If the **Create immutable GitHub release** job fails before it creates the
release (its checks ran out before you approved the stage, or `npm view` failed
with an error other than E404), approve the stage if you have not, then use
**Re-run failed jobs** on that **Stage npm Release** run. GitHub allows re-runs
for 30 days. Do not start a new release.

## Patch-release drill evidence

For the first release after a workflow change, record:

- both workflow run URLs;
- the signed tag and target commit SHA;
- the staged-package approval time;
- the npm package and immutable GitHub release URLs;
- the provenance source repository, workflow, ref, and commit; and
- `npm view PACKAGE@VERSION version gitHead dist.integrity --json`.

When npm reports `gitHead`, it must equal the release tag's target commit.
