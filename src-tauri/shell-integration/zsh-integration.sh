#!/bin/zsh
# OSC 633 shell integration for zsh

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

_wm_preexec() {
    printf '\e]633;C\a'
    # Send command text with \xHH escaping
    printf '\e]633;E;%s\a' "$(_wm_escape_value "$1")"
}

_wm_precmd() {
    local exit_code=$?
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
    # Emit prompt-start (A). PS1 wrapping only adds prompt-end (B).
    printf '\e]633;A\a'
}

# Install hooks via add-zsh-hook (safe, does not clobber user hooks)
autoload -Uz add-zsh-hook
add-zsh-hook precmd _wm_precmd
add-zsh-hook preexec _wm_preexec

# Wrap PS1 with prompt-end marker only.
# precmd emits A (prompt-start), so PS1 only needs B (prompt-end) at the end.
_wm_set_prompt() {
    PS1="${PS1}%{$(printf '\e]633;B\a')%}"
}
_wm_set_prompt
