<#
.SYNOPSIS
  Create a lane worktree that is ready for a child in one step: worktree + branch,
  gitignored env files copied, dependencies installed from the lockfile, verified.

.DESCRIPTION
  Never copy node_modules between worktrees (slow, times out, leaves a writer
  running). A frozen-lockfile install takes seconds with a warm store.
  Env files are copied by name only; their contents are never printed.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File New-Lane.ps1 `
    -Path C:\Code\WorkTime-173 -Branch issue/173-window-model -Base origin/epic/waiting-window

.EXAMPLE
  # Read-only reviewer lane, detached at the merged epic head:
  powershell -NoProfile -ExecutionPolicy Bypass -File New-Lane.ps1 `
    -Path C:\Code\WorkTime-review1 -Detach -Base epic/waiting-window
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Path,
    [string]$Branch,
    [string]$Base = 'HEAD',
    [string]$Repo,
    [string[]]$CopyFiles,
    [switch]$Detach,
    [switch]$SkipInstall
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_common.ps1')

function Fail([string]$msg) { Write-Output "LANE FAILED: $msg"; exit 1 }

if (-not $Repo) {
    $top = Invoke-Git (Get-Location).Path rev-parse --show-toplevel
    if ($top.Code -ne 0) { Fail 'not inside a git repository; pass -Repo' }
    $Repo = $top.Out[0]
}
$Repo = (Resolve-Path -LiteralPath $Repo).Path
if (-not $Detach -and -not $Branch) { Fail 'pass -Branch, or -Detach for a read-only lane' }
if (Test-Path -LiteralPath $Path) { Fail "path already exists: $Path" }

$baseSha = Invoke-Git $Repo rev-parse --verify "$Base^{commit}"
if ($baseSha.Code -ne 0) { Fail "base does not resolve: $Base (fetch first?)" }
$baseSha = $baseSha.Out[0]

# 1. Worktree
$prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
if ($Detach) { $wt = & git -C $Repo worktree add --detach $Path $baseSha 2>&1 }
else { $wt = & git -C $Repo worktree add -b $Branch $Path $baseSha 2>&1 }
$wtCode = $LASTEXITCODE; $ErrorActionPreference = $prev
if ($wtCode -ne 0) { Fail "git worktree add: $($wt -join ' ')" }
$Path = (Resolve-Path -LiteralPath $Path).Path

# 2. Gitignored env files (by name; never print contents)
if (-not $PSBoundParameters.ContainsKey('CopyFiles')) {
    $ign = Invoke-Git $Repo ls-files --others --ignored --exclude-standard --directory
    $CopyFiles = @($ign.Out | Where-Object { $_ -and -not $_.EndsWith('/') -and ((Split-Path $_ -Leaf) -like '.env*') -and $_ -notmatch '(^|/)node_modules/' })
}
$copied = @(); $missing = @()
foreach ($rel in $CopyFiles) {
    $src = Join-Path $Repo $rel
    if (-not (Test-Path -LiteralPath $src)) { $missing += $rel; continue }
    $dst = Join-Path $Path $rel
    $dstDir = Split-Path $dst -Parent
    if (-not (Test-Path -LiteralPath $dstDir)) { New-Item -ItemType Directory -Force -Path $dstDir | Out-Null }
    Copy-Item -LiteralPath $src -Destination $dst -Force
    $copied += $rel
}

# 3. Dependencies from the lockfile
$install = 'skipped'
if (-not $SkipInstall) {
    $cmd = $null
    if (Test-Path (Join-Path $Path 'pnpm-lock.yaml')) { $cmd = 'pnpm install --frozen-lockfile' }
    elseif (Test-Path (Join-Path $Path 'package-lock.json')) { $cmd = 'npm ci' }
    elseif (Test-Path (Join-Path $Path 'yarn.lock')) { $cmd = 'yarn install --frozen-lockfile' }
    if ($cmd) {
        $log = Join-Path $env:TEMP ("lane-install-{0}.log" -f ([guid]::NewGuid().ToString('N').Substring(0, 8)))
        $sw = [Diagnostics.Stopwatch]::StartNew()
        $code = Invoke-CmdLine -Dir $Path -CommandLine $cmd -LogFile $log
        if ($code -ne 0) {
            Write-Output (Get-Content -LiteralPath $log -Tail 25)
            Fail "'$cmd' exited $code (log: $log)"
        }
        $install = "ok ($cmd, $([int]$sw.Elapsed.TotalSeconds)s)"
    }
}

# 4. Verify
$status = Invoke-Git $Path status --porcelain
if ($status.Out.Count -gt 0 -and ($status.Out -join '').Trim()) { Fail "tree not clean after setup: $($status.Out -join '; ')" }
$head = (Invoke-Git $Path rev-parse --short HEAD).Out[0]
$branchNow = (Invoke-Git $Path branch --show-current).Out
$branchNow = if ($branchNow -and $branchNow[0]) { $branchNow[0] } else { '(detached)' }

Write-Output "LANE READY"
Write-Output "  path:    $Path"
Write-Output "  branch:  $branchNow"
Write-Output "  base:    $head ($Base)"
Write-Output "  env:     $(if ($copied) { $copied -join ', ' } else { 'none' })"
if ($missing) { Write-Output "  MISSING: $($missing -join ', ')" }
Write-Output "  install: $install"
Write-Output "  tree:    clean"
