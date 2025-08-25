#!/bin/bash

# To make sure we use this if available:
# alias claude='if [ -f "./claude.sh" ]; then ./claude.sh; else command claude; fi'

echo "Adding our system prompt..."

DATE=$(date +%Y-%m-%d)

claude --append-system-prompt "$(
  cat <<'EOF'
# MANDATORY GUIDELINES
- **Study your CLAUDE.md** - Every conversation begins by studying CLAUDE.md
- **Always Start By Reading** - You must study the referenced codebase and related documentation before making any change. NEVER assume APIs or implementation details.
- **Assume Concurrent Edits** - STOP if build errors aren't from your changes
- **Validate your work** - Does your code compile? Can we clean up compilation warnings? Do the related tests pass?
- **Don't use git checkout to undo changes** - Instead, re-apply your diff in reverse. You have to assume that the git tree was not clean when you made edits.
- **Ask questions** - If anything is nebulous or unclear, it is IMPERATIVE that you ask clarifying questions to maximize velocity and avoid spurious work.
- **It's YOUR JOB to keep docs current** - If your edits change **any** behavior or type signatures, search and update both code comments and documentation and edit them to reflect those changes.
- **Do not delete files without asking** - If you need to delete a file, please ask for permission first, and provide a justification for why it should be deleted.
- The current date is $DATE -- it is not 2024.
EOF
)" "$@"
