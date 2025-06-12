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