# SSH Bot Setup for GitHub Actions

This document explains how to set up SSH commit signing for the GitHub Actions release workflow. SSH signing is newer and simpler than GPG signing, with full GitHub support.

## 0. Create Bot Account (Recommended)

For professional projects, create a dedicated bot account rather than using your personal account:

### Create the Bot Account
1. Sign out of your personal GitHub account
2. Go to https://github.com/join
3. Create account with username like `photostructure-bot`
4. Use email: `photostructure-bot@users.noreply.github.com`
5. Verify the email address

### Add Bot as Repository Collaborator
1. Go to your repo: `https://github.com/photostructure/fs-metadata`
2. Click **Settings** tab
3. Click **Collaborators** in the left sidebar
4. Click **Add people**
5. Search for your bot account username
6. Select **Write** permission level (needed for pushes and releases)
7. Send invitation

### Bot Accepts Invitation
1. Sign in as the bot account
2. Check notifications or email for repository invitation
3. Accept the invitation

## 1. Generate SSH Signing Key

Generate an Ed25519 SSH key specifically for commit signing:

```bash
# Generate the key pair
ssh-keygen -t ed25519 -f ~/.ssh/photostructure-bot-signing -N "" -C "photostructure-bot"

# Display the public key (you'll need this for GitHub)
cat ~/.ssh/photostructure-bot-signing.pub
```

## 2. Add SSH Key to GitHub Bot Account

**Important**: Add the key to the **bot account**, not your personal account.

1. Sign in as `photostructure-bot`
2. Go to Settings → SSH and GPG keys
3. Click **New SSH key**
4. **Critical**: For "Key type", select **"Signing Key"** (not "Authentication Key")
5. Title: `fs-metadata Release Signing Key`
6. Key: Paste the contents of `~/.ssh/photostructure-bot-signing.pub`
7. Click **Add SSH key**

## 3. Configure Repository Secrets

Add the private key to your repository secrets:

### Copy the Private Key

```bash
# Copy private key to clipboard (macOS)
cat ~/.ssh/photostructure-bot-signing | pbcopy

# Copy private key to clipboard (Linux with xclip)
cat ~/.ssh/photostructure-bot-signing | xclip -selection clipboard

# Copy private key to clipboard (Windows with clip)
cat ~/.ssh/photostructure-bot-signing | clip
```

### Add Repository Secrets

1. Go to your repository settings
2. Navigate to Settings → Secrets and variables → Actions
3. Add these secrets:

| Secret Name | Value |
|-------------|-------|
| `SSH_SIGNING_KEY` | Paste the private key content |
| `GIT_USER_NAME` | `photostructure-bot` |
| `GIT_USER_EMAIL` | `bot@photostructure.com` |
| `NPM_TOKEN` | Your npm authentication token |

## 4. How SSH Signing Works in Actions

The SSH signing setup uses two composite actions:

### setup-ssh-bot
- Installs the SSH private key
- Configures Git to use SSH signing format
- Sets up commit and tag signing
- Creates allowed signers file for verification

### cleanup-ssh-bot
- Removes SSH keys from the runner
- Clears Git signing configuration
- Ensures no secrets remain after workflow

## 5. Using SSH Signing in Workflows

### Basic Workflow Example

```yaml
jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
          persist-credentials: false

      - uses: ./.github/actions/setup-ssh-bot
        with:
          ssh-signing-key: ${{ secrets.SSH_SIGNING_KEY }}
          git-user-name: ${{ secrets.GIT_USER_NAME }}
          git-user-email: ${{ secrets.GIT_USER_EMAIL }}

      # Your build and release steps here
      - run: npm ci
      - run: npm version patch
      - run: git push origin main --follow-tags

      - uses: ./.github/actions/cleanup-ssh-bot
        if: always()
```

## 6. Testing SSH Signing

Test your setup before using it in production:

```bash
# Run the SSH signing test workflow
gh workflow run test-ssh-actions.yml

# Check the workflow status
gh run list --workflow=test-ssh-actions.yml
```

## 7. Pre-Release Checklist

Before triggering a release:

- [ ] **SSH_SIGNING_KEY** secret is configured in repository
- [ ] **GIT_USER_NAME** and **GIT_USER_EMAIL** secrets are set
- [ ] **NPM_TOKEN** is valid with publish permissions
- [ ] SSH public key is added to bot's GitHub account as **Signing Key**
- [ ] Bot account has **write access** to the repository
- [ ] Test workflow passes: `gh workflow run test-ssh-actions.yml`
- [ ] You're on the main branch with latest changes

## 8. Advantages of SSH Signing

| Feature | SSH Signing | GPG Signing |
|---------|-------------|-------------|
| Setup complexity | Simple | Complex |
| Key generation | One command | Multiple steps |
| Passphrase handling | Not required | Required |
| Wrapper scripts | Not needed | Required |
| GitHub verification | ✓ Supported | ✓ Supported |
| Maintenance | Minimal | Higher |

## 9. Security Best Practices

1. **Use Ed25519 keys**: Most secure and efficient algorithm
2. **Dedicated signing keys**: Don't reuse authentication keys for signing
3. **Bot accounts**: Use dedicated accounts for automation
4. **Rotate keys**: Consider rotating every 2-3 years
5. **Secure storage**: Never commit private keys to repositories

## 10. Cleanup

After setting up, securely remove local key copies:

```bash
# Remove the local key files
rm ~/.ssh/photostructure-bot-signing
rm ~/.ssh/photostructure-bot-signing.pub

# Or move to secure backup location
mv ~/.ssh/photostructure-bot-signing* ~/secure-backup/
```

## 11. Troubleshooting

### Commits show as "Unverified"
- Ensure the SSH key is added as a **Signing Key** (not Authentication Key)
- Verify the email in Git config matches the GitHub account email
- Check that the bot account owns the key

### "error: Load key failed"
- Verify SSH_SIGNING_KEY secret contains the complete private key
- Check for extra newlines or spaces in the secret

### Permission denied on push
- Ensure bot account has write access to the repository
- Check that `persist-credentials: false` is set in checkout action

## References

- [GitHub SSH Commit Verification](https://docs.github.com/en/authentication/managing-commit-signature-verification/about-commit-signature-verification#ssh-commit-signature-verification)
- [Git SSH Signing Documentation](https://git-scm.com/docs/git-config#Documentation/git-config.txt-gpgformat)
- [GitHub Actions Encrypted Secrets](https://docs.github.com/en/actions/security-guides/encrypted-secrets)