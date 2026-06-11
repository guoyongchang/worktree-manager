#!/bin/bash
# OSC 633 shell integration for bash

# Guard: only load once
[ -n "$_WM_SHELL_INTEGRATION_LOADED" ] && return
_WM_SHELL_INTEGRATION_LOADED=1

# Escape control characters, backslashes, and semicolons as \xHH for OSC 633 values.
_wm_escape_value() {
    local input="$1" output="" i ch val
    for (( i=0; i<${#input}; i++ )); do
        ch="${input:$i:1}"
        case "$ch" in
            \\) output+="\\\\" ;;
            \;) output+="\\x3b" ;;
            *)
                printf -v val '%d' "'$ch"
                if [ "$val" -lt 32 ] 2>/dev/null; then
                    printf -v val '\\x%02x' "$val"
                    output+="$val"
                else
                    output+="$ch"
                fi
                ;;
        esac
    done
    printf '%s' "$output"
}

# Save original PROMPT_COMMAND
_wm_original_prompt_command="$PROMPT_COMMAND"

# Guard variable: prevents DEBUG trap from firing during PROMPT_COMMAND
_wm_in_prompt_command=0

_wm_prompt_start() {
    # Reset guard so next DEBUG trap fires for user commands
    _wm_in_prompt_command=0
    printf '\e]633;A\a'
}

_wm_prompt_end() {
    printf '\e]633;B\a'
}

_wm_pre_execution() {
    # Skip if we're inside PROMPT_COMMAND (DEBUG trap fires for every simple command)
    [ "$_wm_in_prompt_command" = "1" ] && return
    printf '\e]633;C\a'
}

_wm_command_finished() {
    local exit_code=$?
    # Set guard to prevent DEBUG trap from firing during prompt functions
    _wm_in_prompt_command=1
    printf '\e]633;D;%s\a' "$exit_code"
    # Report CWD with \xHH escaping for OSC 633;P
    printf '\e]633;P;Cwd=%s\a' "$(_wm_escape_value "$PWD")"
    # OSC 7: percent-encode special characters for a valid file URI
    local encoded_pwd=""
    local i ch
    for (( i=0; i<${#PWD}; i++ )); do
        ch="${PWD:$i:1}"
        case "$ch" in
            [a-zA-Z0-9/._~:@!-]) encoded_pwd+="$ch" ;;
            *) encoded_pwd+="$(printf '%%%02X' "'$ch")" ;;
        esac
    done
    printf '\e]7;file://%s%s\a' "$(hostname)" "$encoded_pwd"
    return $exit_code
}

# Install hooks
PROMPT_COMMAND="_wm_command_finished;${_wm_original_prompt_command:+$_wm_original_prompt_command;}_wm_prompt_start"

# Wrap PS1 with prompt-end marker only (prompt-start A is emitted by PROMPT_COMMAND)
PS1="${PS1}\[\e]633;B\a\]"

# Trap DEBUG for pre-execution (guarded by _wm_in_prompt_command)
trap '_wm_pre_execution' DEBUG
