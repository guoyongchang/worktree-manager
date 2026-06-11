#!/bin/bash
# worktree-manager bash init wrapper
# Sources user's rc files first, then loads shell integration

# Source system-wide bashrc if it exists
[ -f /etc/bash.bashrc ] && source /etc/bash.bashrc

# Source user's bashrc if it exists
[ -f "$HOME/.bashrc" ] && source "$HOME/.bashrc"

# Source shell integration
_WM_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$_WM_SCRIPT_DIR/bash-integration.sh"
