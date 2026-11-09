# Shared helpers for the orchestration scripts. Windows PowerShell 5.1 compatible.
# Dot-source only: . (Join-Path $PSScriptRoot '_common.ps1')

try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false) } catch { }

function Invoke-Git {
    # Runs git without letting PS 5.1 turn stderr into terminating errors.
    # --no-optional-locks keeps read-only calls from taking index.lock while a
    # child works in the same worktree.
    param([Parameter(Mandatory = $true)][string]$Dir, [Parameter(ValueFromRemainingArguments = $true)][string[]]$GitArgs)
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $out = & git --no-optional-locks -C $Dir @GitArgs 2>$null
        $code = $LASTEXITCODE
    } finally { $ErrorActionPreference = $prev }
    [pscustomobject]@{ Code = $code; Out = @($out | ForEach-Object { "$_" }) }
}

function Start-CmdLine {
    # Starts "<CommandLine> < NUL > log 2>&1" (or with a stdin file) through cmd.exe and
    # returns the Process. cmd.exe resolves pnpm.cmd/npm.cmd, which sidesteps the
    # PowerShell execution policy that blocks pnpm.ps1.
    param(
        [Parameter(Mandatory = $true)][string]$Dir,
        [Parameter(Mandatory = $true)][string]$CommandLine,
        [Parameter(Mandatory = $true)][string]$LogFile,
        [string]$StdinFile,
        [switch]$Hidden
    )
    $stdin = if ($StdinFile) { "`"$StdinFile`"" } else { 'NUL' }
    $full = "$CommandLine < $stdin > `"$LogFile`" 2>&1"
    $splat = @{
        FilePath         = $env:ComSpec
        ArgumentList     = "/d /s /c `"$full`""
        WorkingDirectory = $Dir
        PassThru         = $true
    }
    if ($Hidden) { $splat.WindowStyle = 'Hidden' } else { $splat.NoNewWindow = $true }
    $p = Start-Process @splat
    $null = $p.Handle   # cache the handle so ExitCode is readable after exit
    return $p
}

function Invoke-CmdLine {
    param([string]$Dir, [string]$CommandLine, [string]$LogFile)
    $p = Start-CmdLine -Dir $Dir -CommandLine $CommandLine -LogFile $LogFile
    $p.WaitForExit()
    return $p.ExitCode
}

function Remove-Ansi {
    param([string]$Text)
    if ($null -eq $Text) { return '' }
    $esc = [char]27; $bel = [char]7
    return ($Text -replace "$esc\[[0-9;?]*[ -/]*[@-~]", '' -replace "$esc\][^$bel]*$bel", '')
}

function Read-TextFile {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return '' }
    $fs = [System.IO.File]::Open($Path, 'Open', 'Read', 'ReadWrite')
    try { $sr = New-Object System.IO.StreamReader($fs, [System.Text.Encoding]::UTF8); return $sr.ReadToEnd() }
    finally { $fs.Dispose() }
}

function Write-JsonFile {
    param([string]$Path, $Object)
    $json = $Object | ConvertTo-Json -Depth 6
    [System.IO.File]::WriteAllText($Path, $json, (New-Object System.Text.UTF8Encoding($false)))
}

function Get-ChangedPaths {
    # Repo-relative paths that differ from HEAD (tracked changes + untracked, not ignored).
    param([string]$Dir)
    $r = Invoke-Git $Dir -c core.quotepath=false status --porcelain=v1 -z -uall
    $raw = ($r.Out -join "`n")
    $tokens = @($raw -split "`0" | Where-Object { $_ -ne '' })
    $paths = New-Object System.Collections.Generic.List[string]
    for ($i = 0; $i -lt $tokens.Count; $i++) {
        $t = $tokens[$i].TrimStart("`n")
        if ($t.Length -lt 4) { continue }
        $xy = $t.Substring(0, 2)
        $paths.Add($t.Substring(3))
        if ($xy -match '[RC]' -and ($i + 1) -lt $tokens.Count) {
            $i++                              # rename/copy: next token is the source path
            if ($xy -match 'R') { $paths.Add($tokens[$i].TrimStart("`n")) }
        }
    }
    return @($paths | Sort-Object -Unique)
}

function Get-ProcessTree {
    # $RootPid and all live descendants, as @{ pid = creation-time string }.
    # The creation time guards against PID reuse when killing orphans later.
    param([int]$RootPid)
    $all = @(Get-CimInstance Win32_Process -Property ProcessId, ParentProcessId, CreationDate)
    $kids = @{}; $created = @{}
    foreach ($p in $all) {
        $pp = [int]$p.ParentProcessId
        $created[[int]$p.ProcessId] = "$($p.CreationDate)"
        if (-not $kids.ContainsKey($pp)) { $kids[$pp] = New-Object System.Collections.Generic.List[int] }
        $kids[$pp].Add([int]$p.ProcessId)
    }
    $tree = @{}
    $queue = New-Object System.Collections.Generic.Queue[int]
    $queue.Enqueue($RootPid)
    while ($queue.Count -gt 0) {
        $cur = $queue.Dequeue()
        if ($tree.ContainsKey($cur) -or -not $created.ContainsKey($cur)) { continue }
        $tree[$cur] = $created[$cur]
        if ($kids.ContainsKey($cur)) { foreach ($k in $kids[$cur]) { if ($k -ne $cur) { $queue.Enqueue($k) } } }
    }
    return $tree
}

function Get-AliveTracked {
    # PIDs from a @{ pid = creation-time } map that are still the same live process.
    param([hashtable]$Tracked)
    if (-not $Tracked -or $Tracked.Count -eq 0) { return @() }
    $now = @{}
    foreach ($p in @(Get-CimInstance Win32_Process -Property ProcessId, CreationDate)) { $now[[int]$p.ProcessId] = "$($p.CreationDate)" }
    return @($Tracked.Keys | Where-Object { $now.ContainsKey([int]$_) -and $now[[int]$_] -eq $Tracked[$_] } | ForEach-Object { [int]$_ })
}

function Stop-Pids {
    param([int[]]$Pids)
    foreach ($id in $Pids) {
        $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
        try { & taskkill.exe /T /F /PID $id 2>&1 | Out-Null } finally { $ErrorActionPreference = $prev }
    }
}

function Join-Dict {
    param($A, $B)
    $r = [ordered]@{}
    foreach ($k in $A.Keys) { $r[$k] = $A[$k] }
    foreach ($k in $B.Keys) { $r[$k] = $B[$k] }
    return $r
}

function Get-LaneLockFile {
    # Per-worktree lock used by Invoke-Child (one agent per worktree) and Remove-Lane.
    param([string]$Worktree, [string]$RunRoot)
    $lockDir = Join-Path $RunRoot 'locks'
    New-Item -ItemType Directory -Force -Path $lockDir | Out-Null
    $bytes = [Text.Encoding]::UTF8.GetBytes($Worktree.TrimEnd('\', '/').ToLowerInvariant())
    $hash = [BitConverter]::ToString((New-Object Security.Cryptography.SHA1Managed).ComputeHash($bytes)).Replace('-', '').Substring(0, 16)
    return (Join-Path $lockDir "$hash.lock")
}

function Get-LaneLockHolder {
    # The lock's "pid|name|time" text when its supervisor is still alive, else $null.
    param([string]$LockFile)
    if (-not (Test-Path -LiteralPath $LockFile)) { return $null }
    $holder = (Get-Content -LiteralPath $LockFile -Raw).Trim()
    $holderPid = 0
    if (-not [int]::TryParse(($holder -split '\|')[0], [ref]$holderPid)) { return $null }
    if (Get-Process -Id $holderPid -ErrorAction SilentlyContinue) { return $holder }
    return $null
}
