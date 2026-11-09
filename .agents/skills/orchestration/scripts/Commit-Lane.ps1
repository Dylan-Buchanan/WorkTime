<#
.SYNOPSIS
  Mechanically commit a sandboxed child's finished work after verifying scope.
  This is ORCH's only commit of lane content; ORCH writes none of it.

.DESCRIPTION
  Codex's workspace-write sandbox always makes .git read-only (verified with
  codex-cli 0.160.0, even with --add-dir), so Codex lanes leave changes
  uncommitted and put the commit message in their report. This script:
    1. checks the worktree is on the expected branch at the expected base,
    2. checks the changed paths equal the authorized file list (no drift),
    3. commits with the child's own message (from Invoke-Child's
       commit-message.txt) and a Lane-Agent trailer,
    4. proves the tree is clean afterwards.
  It refuses instead of fixing anything. Never edit the message or the files.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File Commit-Lane.ps1 `
    -Worktree C:\Code\WorkTime-173 -Branch issue/173-window-model -Base 6194f3c `
    -AllowedFile C:\orch\briefs\173.allowed.txt `
    -MessageFile C:\Temp\orch-runs\20261109-0130-implplus-173\commit-message.txt `
    -LaneAgent "codex gpt-6.1-sol"
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Worktree,
    [Parameter(Mandatory = $true)][string]$Branch,
    [Parameter(Mandatory = $true)][string]$Base,
    [Parameter(Mandatory = $true)][string]$AllowedFile,
    [Parameter(Mandatory = $true)][string]$MessageFile,
    [Parameter(Mandatory = $true)][string]$LaneAgent,
    [switch]$AllowSubset
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_common.ps1')

function Refuse([string]$msg) { Write-Output "COMMIT REFUSED: $msg"; exit 1 }

if (-not (Test-Path -LiteralPath $Worktree -PathType Container)) { Refuse "worktree not found: $Worktree" }
if (-not (Test-Path -LiteralPath $MessageFile -PathType Leaf)) { Refuse "message file not found: $MessageFile" }
if (-not (Test-Path -LiteralPath $AllowedFile -PathType Leaf)) { Refuse "allowed-file list not found: $AllowedFile" }

$cur = (Invoke-Git $Worktree branch --show-current).Out
if (-not $cur -or $cur[0] -ne $Branch) { Refuse "worktree is on '$($cur -join '')', expected '$Branch'" }
$head = (Invoke-Git $Worktree rev-parse HEAD).Out[0]
$baseSha = Invoke-Git $Worktree rev-parse --verify "$Base^{commit}"
if ($baseSha.Code -ne 0) { Refuse "base does not resolve: $Base" }
if ($head -ne $baseSha.Out[0]) { Refuse "HEAD $($head.Substring(0,7)) is not the lane base $($baseSha.Out[0].Substring(0,7)); the lane already has commits, verify it the normal way" }

$msg = (Read-TextFile $MessageFile).Trim()
if (-not $msg) { Refuse 'commit message is empty' }
$subject = ($msg -split "`r?`n")[0]
if ($subject -notmatch '\(#\d+\)') { Write-Output "WARN: subject has no (#issue) reference: $subject" }

$allowed = @(Get-Content -LiteralPath $AllowedFile | ForEach-Object { $_.Trim() -replace '\\', '/' } | Where-Object { $_ -and -not $_.StartsWith('#') } | Sort-Object -Unique)
$changed = @(Get-ChangedPaths $Worktree)
if ($changed.Count -eq 0) { Refuse 'nothing to commit' }

$extra = @($changed | Where-Object { $allowed -notcontains $_ })
$untouched = @($allowed | Where-Object { $changed -notcontains $_ })
if ($extra.Count -gt 0) { Refuse "changed outside the authorized list: $($extra -join ', ')" }
if ($untouched.Count -gt 0 -and -not $AllowSubset) { Refuse "authorized but untouched (pass -AllowSubset if intended): $($untouched -join ', ')" }

$prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
try {
    $addOut = & git -C $Worktree add -A -- @changed 2>&1; $addCode = $LASTEXITCODE
    if ($addCode -ne 0) { Refuse "git add failed: $($addOut -join ' ')" }
    $staged = @((& git -C $Worktree -c core.quotepath=false diff --cached --name-only 2>$null) | Sort-Object -Unique)
    $mismatch = Compare-Object $staged $changed
    if ($mismatch) { & git -C $Worktree reset -q 2>&1 | Out-Null; Refuse "staged set differs from changed set: $(($mismatch | ForEach-Object { $_.SideIndicator + $_.InputObject }) -join ', ')" }
    $tmpMsg = [IO.Path]::GetTempFileName()
    [IO.File]::WriteAllText($tmpMsg, $msg + "`n", (New-Object System.Text.UTF8Encoding($false)))
    $commitOut = & git -C $Worktree commit -q -F $tmpMsg --trailer "Lane-Agent: $LaneAgent" 2>&1; $commitCode = $LASTEXITCODE
    Remove-Item -LiteralPath $tmpMsg -Force -ErrorAction SilentlyContinue
    if ($commitCode -ne 0) { & git -C $Worktree reset -q 2>&1 | Out-Null; Refuse "git commit failed (hooks?): $($commitOut -join ' ')" }
} finally { $ErrorActionPreference = $prev }

$after = Get-ChangedPaths $Worktree
Write-Output "COMMITTED"
Write-Output "  $((Invoke-Git $Worktree log --oneline -1).Out[0])"
Write-Output "  files: $($changed.Count) ($($changed -join ', '))"
Write-Output "  tree:  $(if (@($after).Count -eq 0) { 'clean' } else { 'DIRTY: ' + ($after -join ', ') })"
if (@($after).Count -gt 0) { exit 1 }
