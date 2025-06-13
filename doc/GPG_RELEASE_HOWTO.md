# GPG Bot Setup for GitHub Actions

This document explains how to set up GPG signing for the GitHub Actions release workflow using modern Ed25519 signing-only keys.

## 0. Create Bot Account (Recommended)

For professional projects, create a dedicated bot account rather than using your personal account:

### Create the Bot Account
1. Sign out of your personal GitHub account
2. Go to https://github.com/join
3. Create account with username like `fs-metadata-bot`
4. Use email: `fs-metadata-bot@users.noreply.github.com`
5. Verify the email address

### Add Bot as Repository Collaborator
1. Go to your repo: `https://github.com/photostructure/fs-metadata`
2. Click **Settings** tab
3. Click **Collaborators** in the left sidebar (or **Manage access** for organizations)
4. Click **Add people** (or **Invite a collaborator**)
5. Search for your bot account username
6. Select **Write** permission level (needed for pushes and releases)
7. Send invitation

### Bot Accepts Invitation
1. Sign in as the bot account
2. Check notifications or email for repository invitation
3. Accept the invitation

**Benefits of bot account:**
- Clear separation between human and automated commits
- Professional appearance in commit history
- Easier permission management
- Independent of any individual developer

## 1. Setup Terminal for Password Entry

Configure GPG to use terminal-based password entry for easy copy/paste:

```bash
export GPG_TTY=$(tty)
echo "pinentry-program /usr/bin/pinentry-curses" >> ~/.gnupg/gpg-agent.conf
gpgconf --reload gpg-agent
```

## 2. Generate Ed25519 Signing-Only GPG Key

### Option A: Quick Command Method (Recommended)
```bash
# Create master key for certification
gpg --quick-gen-key "fs-metadata-bot <fs-metadata-bot@users.noreply.github.com>" ed25519 default 3y

# Get the master key ID from the output, then add signing-only subkey
gpg --quick-add-key [MASTER_KEY_ID] ed25519 sign 3y
```

### Option B: Interactive Expert Mode
```bash
# Generate master key
gpg --expert --full-generate-key

# Follow the prompts:
# - Key type: (9) ECC and ECC
# - Curve: (1) Curve 25519 (Ed25519)
# - Expiration: 3y (3 years recommended)
# - Real name: fs-metadata-bot
# - Email: fs-metadata-bot@users.noreply.github.com
# - Comment: GitHub Actions release bot

# Then add signing-only subkey
gpg --expert --edit-key [YOUR_KEY_ID]
# At gpg> prompt: addkey
# Select (10) ECC (sign only)
# Select (1) Curve 25519
# Set expiration (3y recommended)
# At gpg> prompt: save
```

## 3. Export the GPG Key

```bash
# List keys to see the key structure
gpg --list-secret-keys --keyid-format=long

# You'll see output like:
# sec   ed25519/ABC123DEF456 2024-01-01 [SC] [expires: 2027-01-01]
# ssb   ed25519/789GHI012JKL 2024-01-01 [S]  [expires: 2027-01-01]
#
# Use the master key ID (ABC123DEF456) for export

# Export the private key (replace MASTER_KEY_ID with actual master key ID)
gpg --armor --export-secret-key MASTER_KEY_ID > bot-private-key.asc

# Export the public key for verification
gpg --armor --export MASTER_KEY_ID > bot-public-key.asc
```

**Note**: Export the master key, which includes both the master key and signing subkey. GitHub Actions will automatically use the signing subkey for commit signing.

## 4. Configure Repository Secrets

Add these secrets to your GitHub repository:

- `GPG_PRIVATE_KEY`: Content of `bot-private-key.asc`
- `GPG_PASSPHRASE`: The passphrase you set (or empty string if none)
- `GIT_USER_NAME`: The bot's display name (e.g., `fs-metadata-bot`)
- `GIT_USER_EMAIL`: The bot's email (e.g., `fs-metadata-bot@users.noreply.github.com`)
- `NPM_TOKEN`: Your npm authentication token

## 5. Add Public Key to GitHub

**Important**: Add the public key to the **bot account**, not your personal account.

1. Sign in as the bot account (`fs-metadata-bot`)
2. Copy the content of `bot-public-key.asc`
3. Go to GitHub Settings > SSH and GPG keys
4. Click **New GPG key**
5. Paste the public key content
6. Add the key

This ensures that commits signed by the bot show as "Verified" and are attributed to the bot account.

## 6. Security Notes

- The bot's private key should only be used for automated releases
- Store the key securely and never commit it to the repository
- Ed25519 keys are more secure and performant than RSA
- The signing subkey (marked with [S]) will be used for Git commits
- The passphrase (if any) should be strong and unique
- Consider setting a 3-year expiration and rotating keys before expiry

## 7. Testing

After setup, test the workflow:

1. Go to Actions tab in GitHub
2. Run "Build & Release" workflow manually
3. Choose a version bump type (patch recommended for testing)
4. Verify the release is created with verified commits

## 8. Cleanup

After exporting, securely delete the local key files:

```bash
rm bot-private-key.asc bot-public-key.asc
```

# HOWTO: Secure GPG Signing in GitHub Actions with Composite Sub-Actions

## Overview
This guide explains how to use the reusable composite actions for GPG signing in CI/CD workflows, how the sub-actions work internally, and how to configure your GitHub repository for secure, automated signing with proper cleanup.

---

## 1. What Are the Sub-Actions?

### setup-gpg-bot
Prepares the CI environment for GPG signing by:
- Importing a GPG private key
- Setting key trust level
- Creating a wrapper script for non-interactive signing
- Configuring git for commit/tag signing
- Validating email consistency between GPG key and git config

### cleanup-gpg-bot
Ensures no sensitive data remains after workflow completion by:
- Removing all GPG keys from the keyring
- Deleting GPG configuration directories
- Removing wrapper scripts

These actions are located in:
- `.github/actions/setup-gpg-bot/action.yml`
- `.github/actions/cleanup-gpg-bot/action.yml`

---

## 2. Required GitHub Secrets

Configure these repository secrets in Settings → Secrets and variables → Actions:

| Secret | Description | Example |
|--------|-------------|---------|
| `GPG_PRIVATE_KEY` | ASCII-armored GPG private key | Output of `gpg --armor --export-secret-key KEYID` |
| `GPG_PASSPHRASE` | Passphrase for the GPG key | Your secure passphrase |
| `GIT_USER_NAME` | Git user name for commits | `example-bot` |
| `GIT_USER_EMAIL` | Git user email (MUST match GPG key email) | `bot@example.com` |
| `NPM_TOKEN` | npm registry authentication token | `npm_xxx...` |

**Critical**: The `GIT_USER_EMAIL` must exactly match the email in your GPG key's UID, or signing will fail.

---

## 3. How to Use the Actions in Your Workflow

### Basic Usage Pattern

```yaml
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      # 1. Checkout code
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0  # Important for version bumps
          persist-credentials: true

      # 2. Setup GPG signing
      - uses: ./.github/actions/setup-gpg-bot
        with:
          gpg-private-key: ${{ secrets.GPG_PRIVATE_KEY }}
          gpg-passphrase: ${{ secrets.GPG_PASSPHRASE }}
          git-user-name: ${{ secrets.GIT_USER_NAME }}
          git-user-email: ${{ secrets.GIT_USER_EMAIL }}

      # 3. Your build/test steps here
      - run: npm ci
      - run: npm test

      # 4. Steps that require GPG signing
      - name: Version and tag release
        env:
          GPG_PASSPHRASE: ${{ secrets.GPG_PASSPHRASE }}  # REQUIRED!
        run: |
          npm version patch --message "release: %s"
          git push origin main --follow-tags

      # 5. Always cleanup
      - uses: ./.github/actions/cleanup-gpg-bot
        if: always()
```

### Important Environment Variable Requirements

**The `GPG_PASSPHRASE` environment variable MUST be set for any step that performs GPG signing operations.** This includes:
- `npm version` commands
- Direct `git commit -S` or `git tag -s` commands
- Any tool that internally uses git signing

Example:
```yaml
- name: Create signed commit
  env:
    GPG_PASSPHRASE: ${{ secrets.GPG_PASSPHRASE }}  # Required!
  run: |
    git commit -m "feat: new feature"
    git tag -s v1.0.0 -m "Version 1.0.0"
```

---

## 4. How the Sub-Actions Work Internally

### setup-gpg-bot Implementation Details

1. **GPG Directory Setup**
   ```bash
   mkdir -p ~/.gnupg
   chmod 700 ~/.gnupg
   echo "pinentry-mode loopback" >> ~/.gnupg/gpg.conf
   echo "allow-loopback-pinentry" >> ~/.gnupg/gpg-agent.conf
   ```

2. **Key Import**
   - Imports the private key from the `GPG_PRIVATE_KEY` secret
   - Restarts gpg-agent to ensure configuration is loaded

3. **Wrapper Script Creation**
   - Creates a unique wrapper script at `/tmp/gpg-wrapper-$$-$RANDOM.sh`
   - The wrapper automatically provides the passphrase to GPG
   - Exports `GPG_WRAPPER_PATH` to the environment for subsequent steps

4. **Trust Configuration**
   - Extracts the key ID and sets trust level to 5 (ultimate)
   - Validates that the key was imported successfully

5. **Email Validation** (NEW!)
   - Extracts email from the GPG key
   - Compares with `GIT_USER_EMAIL`
   - Fails fast if emails don't match, preventing confusing signing failures later

6. **Git Configuration**
   ```bash
   git config --global user.name "$GIT_USER_NAME"
   git config --global user.email "$GIT_USER_EMAIL"
   git config --global user.signingkey "$KEY_ID"
   git config --global gpg.program "$GPG_WRAPPER_PATH"
   git config --global commit.gpgsign true
   git config --global tag.gpgsign true
   npm config set sign-git-tag true
   ```

### cleanup-gpg-bot Implementation Details

1. Removes all secret keys from the keyring
2. Removes all public keys
3. Deletes the `~/.gnupg` directory
4. Removes the GPG wrapper script (if `GPG_WRAPPER_PATH` is set)
5. Cleans up any temporary files

---

## 5. Troubleshooting Guide

### Common Issues and Solutions

#### "GPG key email does not match Git user.email"
- **Cause**: The email in your GPG key doesn't match `GIT_USER_EMAIL`
- **Solution**: Ensure both emails are identical, or generate a new key with the correct email

#### "No secret key found after import"
- **Cause**: The GPG key wasn't imported correctly
- **Solution**: Verify your `GPG_PRIVATE_KEY` secret contains the full ASCII-armored private key

#### "error: gpg failed to sign the data"
- **Cause**: Usually missing `GPG_PASSPHRASE` environment variable
- **Solution**: Ensure `GPG_PASSPHRASE` is set in the environment for signing steps

#### "cannot allocate memory" or hanging operations
- **Cause**: GPG trying to use GUI pinentry in headless environment
- **Solution**: The actions handle this automatically; ensure you're using the setup action

### Debug Commands

Add this step to debug GPG configuration:
```yaml
- name: Debug GPG setup
  env:
    GPG_PASSPHRASE: ${{ secrets.GPG_PASSPHRASE }}
  run: |
    echo "=== GPG Configuration ==="
    gpg --version
    "$GPG_WRAPPER_PATH" --list-secret-keys --keyid-format LONG
    git config --list | grep -E "(gpg|user|sign)"
    echo "=== Test signing ==="
    echo "test" | "$GPG_WRAPPER_PATH" --clearsign
```

---

## 6. Security Best Practices

1. **Use Ed25519 Keys**: More secure and faster than RSA
   ```bash
   gpg --quick-gen-key "Bot Name <email>" ed25519 sign 3y
   ```

2. **Set Key Expiration**: Rotate keys every 2-3 years

3. **Use Strong Passphrases**: Generate with password manager

4. **Limit Repository Access**: Only give bot accounts write permission

5. **Audit Secret Access**: Regularly review who has access to repository secrets

6. **Never Commit Keys**: Even encrypted keys shouldn't be in the repository

---

## 7. Complete Setup Example

### Step 1: Generate GPG Key
```bash
# Generate Ed25519 signing key
gpg --quick-gen-key "fs-metadata-bot <fs-metadata-bot@users.noreply.github.com>" ed25519 sign 3y

# List keys to get the key ID
gpg --list-secret-keys --keyid-format=long

# Export the private key
gpg --armor --export-secret-key YOUR_KEY_ID > bot-private.asc

# Export the public key
gpg --armor --export YOUR_KEY_ID > bot-public.asc
```

### Step 2: Configure GitHub
1. Add secrets to repository (Settings → Secrets → Actions)
2. Add public key to bot's GitHub account (Settings → SSH and GPG keys)

### Step 3: Test the Setup
Use the test workflow:
```bash
gh workflow run test-gpg-actions.yml
```

---

## 8. Advanced Topics

### Using Different Wrapper Paths
The setup action exports `GPG_WRAPPER_PATH` to the environment. You can use this in custom scripts:

```yaml
- name: Custom signing operation
  env:
    GPG_PASSPHRASE: ${{ secrets.GPG_PASSPHRASE }}
  run: |
    # Use the wrapper path directly
    "$GPG_WRAPPER_PATH" --detach-sign myfile.tar.gz
```

### Conditional GPG Setup
Only setup GPG for release jobs:
```yaml
- uses: ./.github/actions/setup-gpg-bot
  if: github.event_name == 'workflow_dispatch' && github.event.inputs.version
  with:
    # ... parameters ...
```

### Multiple Signing Keys
For different environments:
```yaml
- uses: ./.github/actions/setup-gpg-bot
  with:
    gpg-private-key: ${{ github.ref == 'refs/heads/main' && secrets.PROD_GPG_KEY || secrets.DEV_GPG_KEY }}
    # ... other parameters ...
```

---

## 9. References
- [GitHub Actions: Environment files](https://docs.github.com/en/actions/using-workflows/workflow-commands-for-github-actions#environment-files)
- [GitHub Actions: Encrypted secrets](https://docs.github.com/en/actions/security-guides/encrypted-secrets)
- [GitHub Actions: Composite Actions](https://docs.github.com/en/actions/creating-actions/creating-a-composite-action)
- [GPG Best Practices](https://riseup.net/en/security/message-security/openpgp/best-practices)
- [npm version](https://docs.npmjs.com/cli/v10/commands/npm-version)
- [Git GPG signing](https://git-scm.com/book/en/v2/Git-Tools-Signing-Your-Work)