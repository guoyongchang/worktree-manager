# OSC 633 shell integration for PowerShell
# Supports Windows PowerShell 5.1 and PowerShell 7+
#
# Sequences emitted:   A (prompt start), B (prompt end), D (command finish), P;Cwd
# Sequences NOT emitted: E (command text), C (command started)
#
# OSC 633;E and OSC 633;C require wrapping PSReadLine's ReadLine or
# PSConsoleHostReadLine, which is fragile across PS 5.x / 7+ versions and
# breaks some user profiles. The trade-off is intentional: command-text
# tracking and the "command started" marker are unavailable in PowerShell
# terminals. Shell prompt boundaries and CWD tracking still work normally.

# Only load inside worktree-manager terminals
if ($env:WORKTREE_MANAGER_SHELL_INTEGRATION -ne '1') { return }

# Guard: only load once
if ($Global:__WMState) { return }

# Protect against user profiles that set ErrorActionPreference = 'Stop'
$__wmOrigEAP = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
try {

# Load user profiles (all four paths, standard order)
$__wmProfiles = @(
    $PROFILE.AllUsersAllHosts,
    $PROFILE.AllUsersCurrentHost,
    $PROFILE.CurrentUserAllHosts,
    $PROFILE.CurrentUserCurrentHost
)
foreach ($__wmP in $__wmProfiles) {
    if ($__wmP -and (Test-Path $__wmP)) { . $__wmP }
}

# Initialize global state (after profile load to capture user's Prompt)
$Global:__WMState = @{
    OriginalPrompt = $function:Prompt
    LastHistoryId  = -1
}

# Escape control characters (\x00-\x1f), backslashes, and semicolons as \xHH.
# Compatible with PowerShell 5.1+ ([regex]::Replace with scriptblock).
function Global:__WM-Escape-Value([string]$value) {
    [regex]::Replace($value, '[\x00-\x1f\\;]', {
        param($match)
        -Join (
            [System.Text.Encoding]::UTF8.GetBytes($match.Value) |
            ForEach-Object { '\x{0:x2}' -f $_ }
        )
    })
}

# Custom Prompt function: emits OSC 633 sequences around the original prompt.
function Global:Prompt {
    # Exit code: prefer $LASTEXITCODE for native commands, fall back to $? boolean.
    # Known limitation: $? in Prompt context reflects the Prompt function's own last
    # expression, not the user's last command, so it may report 0 even when a native
    # command returned a non-zero exit code. $LASTEXITCODE is authoritative for native
    # executables; $? is used only as a fallback for PowerShell-native commands that
    # don't set $LASTEXITCODE. OSC 633;D is used for command navigation, not for
    # precise exit-code display, so this imprecision is acceptable.
    $ExitCode = if ($global:?) { 0 }
                elseif ($global:LASTEXITCODE) { $global:LASTEXITCODE }
                else { 1 }
    $LastHistoryEntry = Get-History -Count 1
    $Result = ""

    # D: previous command finished. Without PSConsoleHostReadLine wrapping,
    # history growth is the safest signal that a command actually ran.
    if (
        $Global:__WMState.LastHistoryId -ne -1 -and
        $LastHistoryEntry -and
        $LastHistoryEntry.Id -ne $Global:__WMState.LastHistoryId
    ) {
        $Result += "$([char]0x1b)]633;D;$ExitCode`a"
    }

    # Update history tracking
    if ($LastHistoryEntry) {
        $Global:__WMState.LastHistoryId = $LastHistoryEntry.Id
    }

    # A: prompt start
    $Result += "$([char]0x1b)]633;A`a"

    # P;Cwd: report current directory (FileSystem provider only)
    if ($pwd.Provider.Name -eq 'FileSystem') {
        $Result += "$([char]0x1b)]633;P;Cwd=$(__WM-Escape-Value $pwd.ProviderPath)`a"
    }

    # Execute original prompt
    $OriginalPrompt = ""
    try {
        $OriginalPrompt = & $Global:__WMState.OriginalPrompt
    } catch {}
    $Result += $OriginalPrompt

    # B: prompt end (user input begins)
    $Result += "$([char]0x1b)]633;B`a"

    return $Result
}

} catch {
    # Shell integration failed to load; shell still works normally
} finally {
    $ErrorActionPreference = $__wmOrigEAP
}
