# Releasing `@photostructure/fs-metadata`

Releases start from a tested `main` commit and end with a maintainer-approved
npm stage. Do not create or move a version tag manually, and do not run direct
npm publishing from a workstation.

## Before a release

Verify these conditions:

- The intended source commit is on `main`.
- The ordinary CI run for that commit is green.
- Any command that resolves or updates `package-lock.json` uses npm 11.10 or
  later. Compatibility tests may use an older bundled npm only for `npm ci`.
- `CHANGELOG.md` contains the intended release notes when a manual changelog
  entry is needed.
- npm Trusted Publisher identifies `photostructure/fs-metadata` and
  `publish.yaml`, with only staged publishing allowed.
- GitHub Actions can read `SSH_SIGNING_KEY`, `GIT_USER_NAME`, and
  `GIT_USER_EMAIL`.

## Start and approve a release

1. Open the repository's **Build & Prepare Release** workflow.
2. Select **Run workflow** on `main`.
3. Choose `patch`, `minor`, or `major`.
4. Wait for the lint, native prebuild, functional, memory, and TSan jobs.
5. Confirm that the release job creates one signed commit and one signed
   `vMAJOR.MINOR.PATCH` annotated tag.
6. Wait for **Stage npm Release**. It rebuilds all eight prebuilds from the tag,
   packs one tarball, and tests that tarball on every supported platform.
7. Download the one-day `npm-package-vMAJOR.MINOR.PATCH` artifact. Inspect
   `CONTENTS.txt` and `PACK.json`, and confirm the embedded
   `package/package.json` name and version match the tag.
8. Open **Staged Packages** from the npm user menu. Verify the package name,
   version, files, repository, source commit, workflow, and provenance.
9. Approve the stage with a maintainer's 2FA key.
10. Confirm that npm shows the version as public and GitHub shows an immutable
    release for the same tag.

The GitHub release is created when npm accepts the stage. It can therefore
exist before the maintainer approves the package for public access.

## What the workflows enforce

- `build.yml` runs the full pre-tag test gate and verifies that every test job
  leaves tracked source unchanged. It also packs a tarball and installs and
  loads it on Linux, macOS, Windows, and Alpine, so `publish.yaml` never runs
  that procedure for the first time at a tag — a workflow file is frozen at its
  tag, so a defect there costs a version.
- The release job changes only `package.json` and `package-lock.json`, signs the
  commit and tag, and pushes them atomically.
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
| An approved package is bad                     | Deprecate it or publish a corrected version. Never overwrite it.                              |

## Patch-release drill evidence

For the first release after a workflow change, record:

- both workflow run URLs;
- the signed tag and target commit SHA;
- the staged-package approval time;
- the npm package and immutable GitHub release URLs;
- the provenance source repository, workflow, ref, and commit; and
- `npm view PACKAGE@VERSION version gitHead dist.integrity --json`.

When npm reports `gitHead`, it must equal the release tag's target commit.
