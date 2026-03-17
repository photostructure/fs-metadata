#!/bin/bash

# Claude Code wrapper: appends a project-specific system prompt to every session.
#
# Appends TPP instructions and mandatory guidelines via --append-system-prompt.
# See https://photostructure.com/coding/claude-code-tpp/ for details.
#
# Setup: add this function to your ~/.bashrc, ~/.bash_aliases, or ~/.zshrc:
#
#   cla() {
#     if [ -f "./claude.sh" ]; then ./claude.sh "$@"; else command claude "$@"; fi
#   }
#
# Usage:
#   cla               # Starts a TPP-aware session
#   cla --resume      # Resume with TPP context
#   claude update     # Vanilla claude still works for non-TPP use
#
# The --append-system-prompt below is also a good place to add brief,
# high-value instructions that Claude tends to ignore in CLAUDE.md.
# Keep it concise! Every token here reduces your available context window.

echo "Adding project system prompt..."

DATE=$(date +%Y-%m-%d)

command claude --append-system-prompt "$(
  cat <<EOF
# MANDATORY GUIDELINES
- **Study your CLAUDE.md** - Every conversation begins by studying CLAUDE.md
- **Always Start By Reading** - You must study the referenced codebase and related documentation before making any change. NEVER assume APIs or implementation details.
- **Assume Concurrent Edits** - if you encounter a compilation error that you don't think you caused, **STOP immediately**, do not try to fix it blindly, **describe the error** to the user clearly, and **use AskUserQuestion** with these options:
   - "Build is now fixed, continue"
   - "Please fix the build and then continue"

- **Validate your work** - Does your code compile? Can we clean up compilation warnings? Do the related tests pass?
- **Don't use git checkout to undo changes** - Instead, re-apply your diff in reverse. You have to assume that the git tree was not clean when you made edits.
- **Ask questions** - If anything is nebulous or unclear, it is IMPERATIVE that you ask clarifying questions to maximize velocity and avoid spurious work.
- **It's YOUR JOB to keep docs current** - If your edits change **any** behavior or type signatures, search and update both code comments and documentation and edit them to reflect those changes.
- **Do not delete files without asking** - If you need to delete a file, please ask for permission first, and provide a justification for why it should be deleted.
- The current date is $DATE -- it is not 2024.

# TECHNICAL PROJECT PLANS (TPPs)
This project uses Technical Project Plans (TPPs) in \`_todo/*.md\` to share research, design decisions, and next steps between sessions.

- When you exit plan mode, your first step should be to write or update a relevant TPP using the /handoff skill.
- When you run low on context and you are working on a TPP, run the /handoff skill.
- Check \`_todo/\` at the start of every session for active TPPs relevant to the current task.
EOF
)" "$@"
