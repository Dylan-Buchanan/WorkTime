<#
.SYNOPSIS
  Remove a lane worktree safely and completely, then prune it and optionally
  delete its branch.

.DESCRIPTION
  `git worktree remove` fails on lanes with a pnpm node_modules ("Filename too
  long" / "Result too large"), even with core.longpaths. This script deletes the
  directory through the \\?\ long-path prefix and then prunes.

  It refuses when:
    - the path is the main worktree or not a registered worktree of the repo,
    - a supervised child still holds the lane (Invoke-Child lock),
    - the lane has uncommitted changes or its HEAD is not contained in
      -MergedInto, unless -Discard says the lane is being thrown away.

.EXAMPLE
  # After the lane is merged into the epic:
  powershell -NoProfile -ExecutionPolicy Bypass -File Remove-Lane.ps1 `
    -Path C:\Code\WorkTime-173 -MergedInto epic/waiting-window -DeleteBranch

.EXAMPLE
  # A stalled lane that will be recreated from scratch:
  powershell -NoProfile -ExecutionPolicy Bypass -File Remove-Lane.ps1 `
    -Path C:\Code\WorkTime-173 -Discard -DeleteBranch
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Path,
    [string]$MergedInto,
    [switch]$DeleteBranch,
    [switch]$Discard,
    [string]$RunRoot = (Join-Path $env:TEMP 'orch-runs')
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_common.ps1')

function Refuse([string]$msg) { Write-Output "REMOVE REFUSED: $msg"; exit 1 }

if (-not (Test-Path -LiteralPath $Path -PathType Container)) { Refuse "not a directory: $Path" }
$Path = (Resolve-Path -LiteralPath $Path).Path.TrimEnd('\')
if (-not $MergedInto -and -not $Discard) { Refuse 'pass -MergedInto <ref> for a finished lane, or -Discard for an abandoned one' }

$common = Invoke-Git $Path rev-parse --path-format=absolute --git-common-dir
if ($common.Code -ne 0) { Refuse "not a git worktree: $Path" }
$commonDir = $common.Out[0] -replace '/', '\'
$repo = Split-Path $commonDir -Parent

# Must be a registered, non-main worktree of $repo
$list = (Invoke-Git $repo worktree list --porcelain).Out | Where-Object { $_ -like 'worktree *' } | ForEach-Object { ($_.Substring(9) -replace '/', '\').TrimEnd('\') }
if ($list.Count -eq 0) { Refuse 'could not list worktrees' }
if ($list[0] -ieq $Path) { Refuse 'that is the main worktree' }
if (-not ($list | Where-Object { $_ -ieq $Path })) { Refuse "not a registered worktree of $repo" }

$holder = Get-LaneLockHolder (Get-LaneLockFile $Path $RunRoot)
if ($holder) { Refuse "a supervised child still holds this lane ($holder)" }

$dirty = @(Get-ChangedPaths $Path)
$branch = (Invoke-Git $Path branch --show-current).Out
$branch = if ($branch -and $branch[0]) { $branch[0] } else { $null }
$head = (Invoke-Git $Path rev-parse HEAD).Out[0]

if (-not $Discard) {
    if ($dirty.Count -gt 0) { Refuse "uncommitted changes: $($dirty -join ', ')" }
    $anc = Invoke-Git $repo merge-base --is-ancestor $head $MergedInto
    if ($anc.Code -ne 0) { Refuse "HEAD $($head.Substring(0,7)) is not contained in $MergedInto" }
}

Remove-Item -LiteralPath ("\\?\" + $Path) -Recurse -Force
if (Test-Path -LiteralPath $Path) { Refuse "directory still present after delete: $Path" }
$null = Invoke-Git $repo worktree prune
$still = (Invoke-Git $repo worktree list --porcelain).Out | Where-Object { $_ -like 'worktree *' } | ForEach-Object { ($_.Substring(9) -replace '/', '\').TrimEnd('\') } | Where-Object { $_ -ieq $Path }
if ($still) { Refuse "worktree still registered after prune: $Path" }

$branchNote = 'kept'
if ($DeleteBranch -and $branch) {
    $flag = if ($Discard) { '-D' } else { '-d' }
    $del = Invoke-Git $repo branch $flag $branch
    $branchNote = if ($del.Code -eq 0) { "deleted ($flag)" } else { "NOT deleted (git branch $flag failed)" }
}

Write-Output "LANE REMOVED"
Write-Output "  path:   $Path"
Write-Output "  head:   $($head.Substring(0,7))$(if ($Discard -and $dirty.Count -gt 0) { " (discarded $($dirty.Count) uncommitted path(s))" })"
Write-Output "  branch: $(if ($branch) { "$branch $branchNote" } else { '(detached)' })"
