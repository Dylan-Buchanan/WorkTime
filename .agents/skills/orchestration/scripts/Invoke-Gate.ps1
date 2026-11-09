<#
.SYNOPSIS
  Run gate steps in order, stop at the first red, record exit codes, test counts,
  and failing test names, flag files the gate itself modified, and push only when
  everything is green. This is the only way ORCH pushes.

.DESCRIPTION
  -Steps takes cmd.exe command lines separated by ';;' (powershell -File cannot
  pass a real array). Each step is run in -Worktree with output to its own
  log (cmd.exe resolves pnpm.cmd, avoiding the pnpm.ps1 execution-policy block).
  After the steps, the tree is checked for side effects: a tracked file changed
  only by line endings is a warning; any real change or new untracked file fails
  the gate (a build or version script wrote something nobody reviewed).

  With -PushRef, the current branch must equal it and the push happens inside
  this script after the checks, never chained after a gate in the caller's shell.

  Exit code: 0 all green (and pushed, if asked), 1 a step failed, 2 side effects,
  3 push refused or failed.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File Invoke-Gate.ps1 -Name merge-173 `
    -Worktree C:\Code\WorkTime-waiting-epic `
    -Steps 'pnpm lint;;pnpm exec vitest run --maxWorkers=2;;pnpm build' `
    -PushRef epic/waiting-window
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Worktree,
    [Parameter(Mandatory = $true)][string[]]$Steps,
    [string]$Name = 'gate',
    [string]$PushRef,
    [string]$Remote = 'origin',
    [string]$RunRoot = (Join-Path $env:TEMP 'orch-runs')
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_common.ps1')

$Worktree = (Resolve-Path -LiteralPath $Worktree).Path
# powershell -File passes "a,b" as ONE string, so steps are separated by ';;'.
$Steps = @($Steps | ForEach-Object { $_ -split ';;' } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
$runDir = Join-Path $RunRoot ("{0}-{1}" -f (Get-Date -Format 'yyyyMMdd-HHmmss'), $Name)
New-Item -ItemType Directory -Force -Path $runDir | Out-Null

$head = (Invoke-Git $Worktree rev-parse --short HEAD).Out[0]
$branch = (Invoke-Git $Worktree branch --show-current).Out
$branch = if ($branch -and $branch[0]) { $branch[0] } else { '(detached)' }
$before = @(Get-ChangedPaths $Worktree)

Write-Output "GATE $Name at $branch@$head  (logs: $runDir)"
if ($before.Count -gt 0) { Write-Output "  WARN tree already dirty before the gate: $($before -join ', ')" }

$countPattern = '^\s*(Test Files|Tests)\s+\d+|^\s*\d+\s+(passed|failed|skipped|flaky|did not run|interrupted)\b|^\s*#\s*(pass|fail|tests)\s+\d+'
# Vitest "FAIL"/x-mark lines, Playwright "1) [project] > ..." lines, node:test "not ok".
# Built from char codes: PS 5.1 reads BOM-less .ps1 files as ANSI.
$xMarks = [string]([char]0x00D7) + [char]0x2717 + [char]0x2718
$pwArrow = [string][char]0x203A
$failPattern = "^\s*(FAIL|[$xMarks])\s+\S|^\s*\d+\)\s+\[.+\]\s+$pwArrow|^\s*not ok\s+\d+"
$results = @()
$red = $false
$i = 0
foreach ($step in $Steps) {
    $i++
    $log = Join-Path $runDir ("step{0}.log" -f $i)
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $code = Invoke-CmdLine -Dir $Worktree -CommandLine $step -LogFile $log
    $secs = [int]$sw.Elapsed.TotalSeconds
    $text = Remove-Ansi (Read-TextFile $log)
    $lines = $text -split "`r?`n"
    $counts = @($lines | Where-Object { $_ -match $countPattern } | ForEach-Object { $_.Trim() } | Select-Object -Last 6)
    $fails = @($lines | Where-Object { $_ -match $failPattern } | ForEach-Object { $_.Trim() } | Sort-Object -Unique | Select-Object -First 25)
    $results += [pscustomobject]@{ step = $step; exit = $code; seconds = $secs; counts = $counts; failures = $fails; log = $log }
    $mark = if ($code -eq 0) { 'PASS' } else { 'FAIL' }
    Write-Output ("  [{0}] {1}  exit={2}  {3}s" -f $mark, $step, $code, $secs)
    foreach ($c in $counts) { Write-Output "         $c" }
    if ($code -ne 0) {
        $red = $true
        if ($fails.Count -gt 0) {
            Write-Output "         failing (record these names; rerun once with fewer workers before calling it a regression):"
            foreach ($f in $fails) { Write-Output "           $f" }
        } else {
            Write-Output "         last lines of $log :"
            foreach ($l in ($lines | Where-Object { $_.Trim() } | Select-Object -Last 15)) { Write-Output "           $l" }
        }
        break
    }
}

# Side effects of the gate itself (builds, version scripts, generators)
$after = @(Get-ChangedPaths $Worktree)
$new = @($after | Where-Object { $before -notcontains $_ })
$eolOnly = @(); $real = @()
foreach ($p in $new) {
    $tracked = (Invoke-Git $Worktree ls-files --error-unmatch -- $p).Code -eq 0
    if ($tracked -and (Invoke-Git $Worktree diff --ignore-cr-at-eol --quiet -- $p).Code -eq 0) { $eolOnly += $p } else { $real += $p }
}
if ($eolOnly.Count -gt 0) { Write-Output "  WARN line-ending-only changes made by the gate (not content): $($eolOnly -join ', ')" }
if ($real.Count -gt 0) { Write-Output "  SIDE EFFECT the gate changed files: $($real -join ', ')" }

$summary = [ordered]@{ name = $Name; worktree = $Worktree; branch = $branch; head = $head; steps = $results
    eolOnly = $eolOnly; sideEffects = $real; pushed = $false }

if ($red) { Write-JsonFile (Join-Path $runDir 'gate.json') $summary; Write-Output "GATE RED: not pushing."; exit 1 }
if ($real.Count -gt 0) { Write-JsonFile (Join-Path $runDir 'gate.json') $summary; Write-Output "GATE BLOCKED by side effects: not pushing."; exit 2 }

if ($PushRef) {
    if ($branch -ne $PushRef) { Write-JsonFile (Join-Path $runDir 'gate.json') $summary; Write-Output "PUSH REFUSED: on '$branch', expected '$PushRef'."; exit 3 }
    $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    $pushOut = & git -C $Worktree push $Remote "refs/heads/${PushRef}:refs/heads/${PushRef}" 2>&1; $pushCode = $LASTEXITCODE
    $ErrorActionPreference = $prev
    if ($pushCode -ne 0) { Write-JsonFile (Join-Path $runDir 'gate.json') $summary; Write-Output "PUSH FAILED (exit $pushCode): $($pushOut -join ' ')"; exit 3 }
    $summary.pushed = $true
    Write-Output "  pushed $branch@$head to $Remote"
}
Write-JsonFile (Join-Path $runDir 'gate.json') $summary
Write-Output "GATE GREEN"
exit 0
