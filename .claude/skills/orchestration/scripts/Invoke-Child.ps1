<#
.SYNOPSIS
  Run one child agent under supervision: brief fed on stdin from a file, output
  straight to a log file, hard timeout, stall watchdog, process-tree kill, push
  blocked, and a final summary ORCH can trust.

.DESCRIPTION
  Launch this with the harness's background mode (run_in_background) the moment
  you dispatch, so the harness wakes you when the run ends. Never pipe it
  through tail/Select-Object: that hides all output until exit.

  The watchdog is armed from the first second:
    startup-stall  no activity at all within -StartupStallMin (the opencode
                   "hung at startup" mode)
    stalled        no log growth, worktree change, or HEAD move for -StallMin
    timeout        -TimeoutMin wall clock
    killed-after-report  the child printed its final report but did not exit
                   within -ExitGraceMin (the "committed, then never exited" mode)

  The child's exit code is recorded but is not evidence. Judge the run by the
  outcome, git state, and the extracted report.

  Run directory (outside the repo): <RunRoot>\<timestamp>-<Name>\
    brief.md, output.log, status.json (heartbeat, then final), report.md,
    commit-message.txt (when the report contains a COMMIT MESSAGE block)

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File Invoke-Child.ps1 `
    -Agent opencode -Name impl-177 -Worktree C:\Code\WorkTime-177 -BriefFile C:\orch\briefs\177.md

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File Invoke-Child.ps1 `
    -Agent codex -Name implplus-173 -Worktree C:\Code\WorkTime-173 -BriefFile C:\orch\briefs\173.md
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][ValidateSet('opencode', 'codex', 'custom')][string]$Agent,
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$Worktree,
    [Parameter(Mandatory = $true)][string]$BriefFile,
    [string]$Model,
    [string]$OpencodeAgent,
    [ValidateSet('read-only', 'workspace-write')][string]$CodexSandbox = 'workspace-write',
    [ValidateSet('low', 'medium', 'high', 'xhigh')][string]$CodexEffort = 'high',
    [string]$Command,
    [double]$TimeoutMin = 60,
    [double]$StartupStallMin = 4,
    [double]$StallMin = 15,
    [double]$ExitGraceMin = 3,
    [int]$PollSec = 15,
    [string]$RunRoot = (Join-Path $env:TEMP 'orch-runs')
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_common.ps1')

$ReportStart = '=== CHILD REPORT ==='
$ReportEnd = '=== CHILD REPORT END ==='
$MsgStart = '--- COMMIT MESSAGE ---'
$MsgEnd = '--- END COMMIT MESSAGE ---'

if (-not (Test-Path -LiteralPath $Worktree -PathType Container)) { throw "worktree not found: $Worktree" }
if (-not (Test-Path -LiteralPath $BriefFile -PathType Leaf)) { throw "brief not found: $BriefFile" }
$Worktree = (Resolve-Path -LiteralPath $Worktree).Path
if ($Agent -eq 'custom' -and -not $Command) { throw '-Agent custom requires -Command' }

# One agent per worktree: refuse if another supervised child holds this worktree.
$lockFile = Get-LaneLockFile $Worktree $RunRoot
$holder = Get-LaneLockHolder $lockFile
if ($holder) { throw "worktree busy: supervisor holds it ($holder)" }
"$PID|$Name|$(Get-Date -Format o)" | Set-Content -LiteralPath $lockFile

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$runDir = Join-Path $RunRoot "$stamp-$Name"
New-Item -ItemType Directory -Force -Path $runDir | Out-Null
$brief = Join-Path $runDir 'brief.md'
Copy-Item -LiteralPath $BriefFile -Destination $brief
$log = Join-Path $runDir 'output.log'
$statusFile = Join-Path $runDir 'status.json'
$reportFile = Join-Path $runDir 'report.md'
$msgFile = Join-Path $runDir 'commit-message.txt'

switch ($Agent) {
    'opencode' {
        if (-not $Model) { $Model = 'opencode-go/deepseek-v4.1-flash#high' }
        # --standalone: private server per run. The default shares the desktop
        # app's long-lived background service, where runs hung at startup.
        $cmd = "opencode run --standalone --auto --model `"$Model`" --title `"$Name`""
        if ($OpencodeAgent) { $cmd += " --agent `"$OpencodeAgent`"" }
    }
    'codex' {
        if (-not $Model) { $Model = 'gpt-6.1-sol' }
        $cmd = "codex exec --sandbox $CodexSandbox -c approval_policy=never -c model_reasoning_effort=$CodexEffort -m `"$Model`" -C `"$Worktree`" -o `"$reportFile`" --color never -"
    }
    'custom' { $cmd = $Command }
}

# Block pushes from anything the child runs. GIT_CONFIG_PARAMETERS (not
# GIT_CONFIG_KEY_n) survives Codex's env filter, which drops names containing KEY.
$env:GIT_CONFIG_PARAMETERS = "'remote.origin.pushurl'='no-push://blocked-by-orchestrator'"

$headBefore = (Invoke-Git $Worktree rev-parse HEAD).Out[0]
$branch = (Invoke-Git $Worktree branch --show-current).Out
$branch = if ($branch -and $branch[0]) { $branch[0] } else { '(detached)' }
$started = Get-Date

$proc = Start-CmdLine -Dir $Worktree -CommandLine $cmd -LogFile $log -StdinFile $brief -Hidden
$meta = [ordered]@{
    name = $Name; agent = $Agent; model = $Model; worktree = $Worktree; branch = $branch
    headBefore = $headBefore; pid = $proc.Id; supervisorPid = $PID; runDir = $runDir
    started = $started.ToString('o'); command = $cmd
}
Write-Output "CHILD STARTED $Name pid=$($proc.Id) agent=$Agent model=$Model"
Write-Output "  run dir: $runDir"
Write-Output "  watch:   status.json heartbeat every ${PollSec}s; log grows in output.log"

function Get-Activity {
    $h = (Invoke-Git $Worktree rev-parse HEAD).Out
    $paths = Get-ChangedPaths $Worktree
    $sig = New-Object System.Text.StringBuilder
    [void]$sig.Append(($h -join '')).Append('|')
    foreach ($p in $paths) {
        $full = Join-Path $Worktree $p
        $item = Get-Item -LiteralPath $full -ErrorAction SilentlyContinue
        if ($item) { [void]$sig.Append("${p}:$($item.Length):$($item.LastWriteTimeUtc.Ticks);") } else { [void]$sig.Append("${p}:gone;") }
    }
    return $sig.ToString()
}

function Test-ReportDone {
    if ($Agent -eq 'codex') { return ((Test-Path -LiteralPath $reportFile) -and (Get-Item -LiteralPath $reportFile).Length -gt 0) }
    $text = Remove-Ansi (Read-TextFile $log)
    return ($text -split "`r?`n" | Where-Object { $_.Trim() -eq $ReportEnd }).Count -gt 0
}

$outcome = $null
$lastLogSize = -1; $everActive = $false
$lastActivity = Get-Date
$lastSig = Get-Activity
$doneSeenAt = $null
$treePids = @{}   # pid -> creation time, every descendant ever seen
try {
    while ($true) {
        if ($proc.WaitForExit($PollSec * 1000)) { break }
        $now = Get-Date
        $tree = Get-ProcessTree $proc.Id
        foreach ($id in $tree.Keys) { if ($id -ne $proc.Id) { $treePids[$id] = $tree[$id] } }

        $size = if (Test-Path -LiteralPath $log) { (Get-Item -LiteralPath $log).Length } else { 0 }
        $sig = Get-Activity
        if ($size -ne $lastLogSize -or $sig -ne $lastSig) {
            if ($lastLogSize -ge 0) { $lastActivity = $now }
            if ($size -gt 512 -or $sig -ne $lastSig) { $everActive = $true }
            $lastLogSize = $size; $lastSig = $sig
        }
        $elapsedMin = ($now - $started).TotalMinutes
        $idleMin = ($now - $lastActivity).TotalMinutes

        if (-not $doneSeenAt -and (Test-ReportDone)) { $doneSeenAt = $now }

        if ($doneSeenAt -and ($now - $doneSeenAt).TotalMinutes -ge $ExitGraceMin) { $outcome = 'killed-after-report' }
        elseif ($elapsedMin -ge $TimeoutMin) { $outcome = 'timeout' }
        elseif (-not $everActive -and $elapsedMin -ge $StartupStallMin) { $outcome = 'startup-stall' }
        elseif ($everActive -and $idleMin -ge $StallMin) { $outcome = 'stalled' }

        $hb = [ordered]@{ state = 'running'; elapsedSec = [int]($now - $started).TotalSeconds; logBytes = $size
            idleSec = [int]($now - $lastActivity).TotalSeconds; everActive = $everActive
            reportSeen = [bool]$doneSeenAt; heartbeat = $now.ToString('o')
        }
        Write-JsonFile $statusFile (Join-Dict $meta $hb)

        if ($outcome) {
            Stop-Pids @($proc.Id)
            [void]$proc.WaitForExit(15000)
            break
        }
    }
} finally {
    Remove-Item -LiteralPath $lockFile -Force -ErrorAction SilentlyContinue
}

# Orphans: descendants that outlived the child (vitest workers, LSP servers, servers).
# Only processes seen in the child's tree during the run, matched by creation time.
$orphans = @(Get-AliveTracked $treePids)
$leftover = @()
if ($orphans.Count -gt 0) {
    Stop-Pids $orphans
    Start-Sleep -Milliseconds 700
    $leftover = @(Get-AliveTracked $treePids)
}

$ended = Get-Date
$childExit = if ($proc.HasExited) { $proc.ExitCode } else { $null }

# Report extraction
$logText = Remove-Ansi (Read-TextFile $log)
$report = ''
$reportSource = 'none'
if ($Agent -eq 'codex' -and (Test-Path -LiteralPath $reportFile) -and (Get-Item -LiteralPath $reportFile).Length -gt 0) {
    $report = Read-TextFile $reportFile; $reportSource = 'codex -o'
}
if (-not $report) {
    $lines = $logText -split "`r?`n"
    $endIdx = -1
    for ($i = $lines.Count - 1; $i -ge 0; $i--) { if ($lines[$i].Trim() -eq $ReportEnd) { $endIdx = $i; break } }
    if ($endIdx -ge 0) {
        $startIdx = -1
        for ($i = $endIdx - 1; $i -ge 0; $i--) { if ($lines[$i].Trim() -eq $ReportStart) { $startIdx = $i; break } }
        if ($startIdx -ge 0) { $report = ($lines[($startIdx + 1)..($endIdx - 1)] -join "`r`n"); $reportSource = 'markers' }
    }
    if (-not $report) {
        $tail = @($lines | Select-Object -Last 60)
        $report = "(no $ReportStart / $ReportEnd block found; last 60 log lines follow)`r`n" + ($tail -join "`r`n")
        $reportSource = 'log-tail'
    }
    [System.IO.File]::WriteAllText($reportFile, $report, (New-Object System.Text.UTF8Encoding($false)))
}

# Commit message block, for Commit-Lane.ps1 (Codex lanes cannot commit in their sandbox)
$hasMsg = $false
$rl = $report -split "`r?`n"
$ms = -1; $me = -1
for ($i = 0; $i -lt $rl.Count; $i++) {
    if ($ms -lt 0 -and $rl[$i].Trim() -eq $MsgStart) { $ms = $i }
    elseif ($ms -ge 0 -and $rl[$i].Trim() -eq $MsgEnd) { $me = $i; break }
}
if ($ms -ge 0 -and $me -gt $ms + 1) {
    $msg = (($rl[($ms + 1)..($me - 1)] -join "`n").Trim()) + "`n"
    [System.IO.File]::WriteAllText($msgFile, $msg, (New-Object System.Text.UTF8Encoding($false)))
    $hasMsg = $true
}

if (-not $outcome) { $outcome = if ($reportSource -eq 'log-tail') { 'exited-no-report' } else { 'finished' } }

$headAfter = (Invoke-Git $Worktree rev-parse HEAD).Out[0]
$commits = if ($headAfter -ne $headBefore) { (Invoke-Git $Worktree log --oneline "$headBefore..$headAfter").Out } else { @() }
$dirty = Get-ChangedPaths $Worktree

$final = [ordered]@{
    state = 'ended'; outcome = $outcome; childExitCode = $childExit
    durationSec = [int]($ended - $started).TotalSeconds; ended = $ended.ToString('o')
    headAfter = $headAfter; commits = @($commits); dirtyPaths = @($dirty)
    reportSource = $reportSource; reportFile = $reportFile
    commitMessageFile = $(if ($hasMsg) { $msgFile } else { $null })
    orphansKilled = @($orphans).Count; leftoverPids = @($leftover); logBytes = $(if (Test-Path -LiteralPath $log) { (Get-Item -LiteralPath $log).Length } else { 0 })
}
Write-JsonFile $statusFile (Join-Dict $meta $final)

Write-Output ""
Write-Output "CHILD ENDED $Name outcome=$outcome duration=$($final.durationSec)s childExit=$childExit (exit code is not evidence)"
Write-Output "  HEAD:    $($headBefore.Substring(0,7)) -> $($headAfter.Substring(0,7)) ($(@($commits).Count) new commit(s))"
foreach ($c in $commits) { Write-Output "           $c" }
Write-Output "  dirty:   $(@($dirty).Count) path(s)$(if (@($dirty).Count -gt 0 -and @($dirty).Count -le 15) { ': ' + ($dirty -join ', ') })"
if ($hasMsg) { Write-Output "  commit message: $msgFile" }
if ($orphans.Count -gt 0) { Write-Output "  orphans: killed $($orphans.Count) process(es) the child left running" }
if ($leftover.Count -gt 0) { Write-Output "  LEFTOVER PIDS still alive after kill: $($leftover -join ', ')" }
Write-Output "  report ($reportSource): $reportFile"
Write-Output "----- report (first 80 lines) -----"
Write-Output (@($report -split "`r?`n") | Select-Object -First 80)

$ok = @('finished', 'killed-after-report') -contains $outcome
if ($ok) { exit 0 } else { exit 2 }
