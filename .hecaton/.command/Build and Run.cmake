cmake_minimum_required(VERSION 3.20)

if(NOT DEFINED EVEN_TARGET)
    set(EVEN_TARGET "Simulator")
endif()
if(NOT DEFINED EVEN_PORT)
    set(EVEN_PORT 5173)
endif()
set(G2_HOST_ARGS)
if(DEFINED G2_HOST AND NOT G2_HOST STREQUAL "")
    list(APPEND G2_HOST_ARGS -DeviceHost "${G2_HOST}")
endif()

# Build the Even G2 sample and launch its dev server and simulator.
# Only the project's Vite/simulator processes belong to this session. Never stop hecaton.
if(NOT WIN32)
    message(FATAL_ERROR "This launcher requires Windows. Use npm run dev and npm run simulator on other platforms.")
endif()

if(NOT DEFINED WORKTREE_PATH OR WORKTREE_PATH STREQUAL "")
    get_filename_component(WORKTREE_PATH "${CMAKE_CURRENT_LIST_DIR}/../.." ABSOLUTE)
endif()
if(NOT EXISTS "${WORKTREE_PATH}/package.json")
    message(FATAL_ERROR "Even G2 project not found: ${WORKTREE_PATH}")
endif()

find_program(NPM_EXECUTABLE NAMES npm.cmd REQUIRED)
find_program(POWERSHELL_EXECUTABLE NAMES powershell.exe REQUIRED)

if(NOT EXISTS "${WORKTREE_PATH}/node_modules/.bin/vite.cmd")
    message(STATUS "Installing sample dependencies...")
    execute_process(
        COMMAND "${NPM_EXECUTABLE}" ci
        WORKING_DIRECTORY "${WORKTREE_PATH}"
        RESULT_VARIABLE install_result
        ENCODING UTF-8
    )
    if(NOT install_result STREQUAL "0")
        message(FATAL_ERROR "npm ci failed: ${install_result}")
    endif()
endif()

message(STATUS "Building G2 Sensor Explorer...")
execute_process(
    COMMAND "${NPM_EXECUTABLE}" run build
    WORKING_DIRECTORY "${WORKTREE_PATH}"
    RESULT_VARIABLE build_result
    ENCODING UTF-8
)
if(NOT build_result STREQUAL "0")
    message(FATAL_ERROR "Build failed: ${build_result}")
endif()

# Keep the launcher self-contained: command folders may be copied without helpers.
set(RUN_DIRECTORY "${WORKTREE_PATH}/.hecaton/run")
file(MAKE_DIRECTORY "${RUN_DIRECTORY}")
set(RUN_SCRIPT "${RUN_DIRECTORY}/run-even-${EVEN_TARGET}.ps1")
file(WRITE "${RUN_SCRIPT}" [=[
param(
    [Parameter(Mandatory = $true)][string]$ProjectRoot,
    [ValidateSet('Simulator', 'G2')][string]$Target = 'Simulator',
    [int]$Port = 5173,
    [string]$DeviceHost = $env:EVEN_G2_HOST
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$ProjectRoot = (Resolve-Path -LiteralPath $ProjectRoot).Path
$node = (Get-Command node.exe -ErrorAction Stop).Source
$vite = Join-Path $ProjectRoot 'node_modules\vite\bin\vite.js'
$logDir = Join-Path $ProjectRoot ".hecaton\logs\$Target"
$url = "http://localhost:$Port"
New-Item -ItemType Directory -Path $logDir -Force | Out-Null

if ($Target -eq 'G2') {
    $networks = @(Get-NetIPConfiguration | Where-Object {
        $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up'
    })
    $addresses = @($networks.IPv4Address.IPAddress | Where-Object {
        $_ -and $_ -notlike '169.254.*' -and $_ -ne '127.0.0.1'
    } | Select-Object -Unique)
    if (-not $DeviceHost) {
        if ($addresses.Count -ne 1) {
            throw "Cannot select one LAN address. Candidates: $($addresses -join ', '). Set EVEN_G2_HOST or -DG2_HOST to the PC address reachable by your phone."
        }
        $DeviceHost = $addresses[0]
    }
    $localAddresses = @(Get-NetIPAddress -AddressFamily IPv4 | Select-Object -ExpandProperty IPAddress)
    if ($DeviceHost -notin $localAddresses -or $DeviceHost -eq '127.0.0.1' -or $DeviceHost -like '169.254.*') {
        throw 'G2 host must be a reachable IPv4 address assigned to this PC.'
    }
    $deviceUrl = "http://${DeviceHost}:$Port"
    Write-Output "G2 phone URL: $deviceUrl"
    Write-Output 'Prerequisites: G2 paired in Even app; firmware updated; same developer account; Scan QR available.'
    Write-Output 'Phone and PC must be mutually reachable. Test the URL in the phone browser first.'
    $selectedInterface = Get-NetIPAddress -IPAddress $DeviceHost -AddressFamily IPv4
    $profile = Get-NetConnectionProfile -InterfaceIndex $selectedInterface.InterfaceIndex -ErrorAction SilentlyContinue
    if ($profile.NetworkCategory -eq 'Public') {
        Write-Warning "Selected network is Public. A Private-only firewall rule will not allow TCP $Port. On a trusted home LAN, switch the network to Private and allow inbound TCP $Port."
    }
}

# A Windows job closes all member processes even if the terminal kills PowerShell
# before its finally block can run. The handle is not inherited by child processes.
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
public sealed class G2SessionJob : IDisposable {
    [StructLayout(LayoutKind.Sequential)] struct BasicLimits {
        public long ProcessTime, JobTime;
        public uint Flags;
        public UIntPtr MinWorkingSet, MaxWorkingSet;
        public uint ActiveProcesses;
        public UIntPtr Affinity;
        public uint Priority, Scheduling;
    }
    [StructLayout(LayoutKind.Sequential)] struct IoCounters {
        public ulong ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes;
    }
    [StructLayout(LayoutKind.Sequential)] struct ExtendedLimits {
        public BasicLimits Basic;
        public IoCounters Io;
        public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
    }
    [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job, int infoClass, ref ExtendedLimits info, uint size);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    private IntPtr handle;
    public G2SessionJob() {
        handle = CreateJobObject(IntPtr.Zero, null);
        if (handle == IntPtr.Zero) throw new Win32Exception();
        var limits = new ExtendedLimits();
        limits.Basic.Flags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        if (!SetInformationJobObject(handle, 9, ref limits, (uint)Marshal.SizeOf(limits))) {
            int error = Marshal.GetLastWin32Error();
            Dispose();
            throw new Win32Exception(error);
        }
    }
    public void Attach(int processId) {
        using (var process = Process.GetProcessById(processId)) {
            if (process.ProcessName != "node" && process.ProcessName != "evenhub-simulator")
                throw new InvalidOperationException("Refusing to manage unrelated process: " + process.ProcessName);
            if (!AssignProcessToJobObject(handle, process.Handle)) throw new Win32Exception();
        }
    }
    public void Dispose() {
        if (handle != IntPtr.Zero) { CloseHandle(handle); handle = IntPtr.Zero; }
    }
}
'@
$sessionJob = New-Object G2SessionJob
# Also detect a launcher-only shutdown, where the hosting terminal kills CMake
# but leaves its PowerShell child alive.
$parentId = (Get-CimInstance Win32_Process -Filter "ProcessId=$PID").ParentProcessId
$launcher = [Diagnostics.Process]::GetProcessById($parentId)
$null = $launcher.Handle
try {
# Reuse only this project's server, and adopt it into the session lifetime.
$listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
foreach ($listener in $listeners) {
    $owner = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)"
    $commandLine = ([string]$owner.CommandLine).Replace('/', '\')
    $isProjectVite = $commandLine.IndexOf($vite, [StringComparison]::OrdinalIgnoreCase) -ge 0
    foreach ($match in [regex]::Matches($commandLine, '"([^"]+vite\.js)"')) {
        if ([IO.Path]::GetFullPath($match.Groups[1].Value) -eq $vite) { $isProjectVite = $true }
    }
    if (-not $isProjectVite) { throw "Port $Port is used by another project. Free it manually first." }
}
foreach ($ownerId in @($listeners.OwningProcess | Select-Object -Unique)) {
    $sessionJob.Attach([int]$ownerId)
}
if ($listeners.Count -eq 0) {
    $server = Start-Process -FilePath $node -ArgumentList @(
        ('"{0}"' -f $vite), '--host', '0.0.0.0', '--port', "$Port", '--strictPort'
    ) -WorkingDirectory $ProjectRoot -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $logDir 'vite.stdout.log') `
        -RedirectStandardError (Join-Path $logDir 'vite.stderr.log')
    $sessionJob.Attach($server.Id)
    Write-Output "Started Vite (PID $($server.Id))."
} else {
    Write-Output 'Reusing this project''s Vite server.'
}
$ready = $false
for ($attempt = 0; $attempt -lt 20; $attempt++) {
    try {
        $response = Invoke-WebRequest -Uri "http://127.0.0.1:$Port" -UseBasicParsing -TimeoutSec 2
        if ($response.StatusCode -eq 200) { $ready = $true; break }
    } catch { }
    if ($server -and $server.HasExited) { break }
    Start-Sleep -Milliseconds 300
}
if (-not $ready) { throw "Vite failed to become ready. Check $logDir" }

if ($Target -eq 'Simulator') {
Push-Location -LiteralPath $ProjectRoot
try {
    $simulator = & $node -p "require.resolve('@evenrealities/sim-win32-' + process.arch + '/bin/evenhub-simulator.exe')"
    if ($LASTEXITCODE -ne 0) { throw 'Simulator executable not found. Run npm ci.' }
} finally { Pop-Location }
$existing = @(Get-CimInstance Win32_Process -Filter "Name='evenhub-simulator.exe'" |
    Where-Object { $_.ExecutablePath -eq $simulator -and $_.CommandLine -like "*$url*" })
try {
    foreach ($instance in $existing) { $sessionJob.Attach([int]$instance.ProcessId) }
} catch {
    # An old simulator can belong to an incompatible Windows job. Restart only
    # the verified project executable, so the replacement has our lifetime.
    Write-Output 'Restarting the project simulator to attach it to this session.'
    foreach ($instance in $existing) {
        $oldSim = Get-Process -Id $instance.ProcessId -ErrorAction SilentlyContinue
        if ($oldSim) {
            try {
                if ($oldSim.MainModule.FileName -ne $simulator) { throw 'Simulator identity changed.' }
                if (-not $oldSim.CloseMainWindow() -or -not $oldSim.WaitForExit(3000)) {
                    $oldSim.Kill()
                    $oldSim.WaitForExit()
                }
            } finally { $oldSim.Dispose() }
        }
    }
    $existing = @()
}
if ($existing.Count -eq 0) {
    $sim = Start-Process -FilePath $simulator -ArgumentList $url `
        -WorkingDirectory $ProjectRoot -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $logDir 'simulator.stdout.log') `
        -RedirectStandardError (Join-Path $logDir 'simulator.stderr.log')
    $sessionJob.Attach($sim.Id)
    Start-Sleep -Seconds 2
    if ($sim.HasExited) { throw "Simulator exited early. Check $logDir" }
    Write-Output "Started Even Hub simulator (PID $($sim.Id))."
} else {
    Write-Output 'Reusing this project''s Even Hub simulator.'
}
} else {
    Write-Output 'Scan the following QR in Even app > Even Hub > Scan QR:'
    & (Join-Path $ProjectRoot 'node_modules\.bin\evenhub.cmd') qr --url $deviceUrl
    if ($LASTEXITCODE -ne 0) { throw 'QR generation failed.' }
    Write-Output "Waiting for you to scan. This PC cannot verify phone pairing or start the app without a scan."
    Write-Output 'Closing this session stops the PC server; exit the app on G2 separately.'
}
Write-Output "Ready: $url (browser demo: $url/?demo=1)"
Write-Output "Logs: $logDir"
Write-Output 'Following logs. Ctrl+C or closing this session stops the PC processes owned by this session.'
$logFiles = @('vite.stdout.log', 'vite.stderr.log')
if ($Target -eq 'Simulator') { $logFiles += @('simulator.stdout.log', 'simulator.stderr.log') }
$positions = @{}
foreach ($name in $logFiles) {
    $positions[$name] = 0L
    if (-not (Test-Path -LiteralPath (Join-Path $logDir $name))) {
        Write-Output "[$name] No log file yet. A server started outside this launcher may log to its original terminal."
    }
}
while (-not $launcher.HasExited) {
    foreach ($name in $logFiles) {
        $path = Join-Path $logDir $name
        if (-not (Test-Path -LiteralPath $path)) { continue }
        $stream = $null
        $reader = $null
        try {
            $stream = [IO.File]::Open($path, [IO.FileMode]::Open, [IO.FileAccess]::Read,
                ([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))
            if ($stream.Length -lt $positions[$name]) { $positions[$name] = 0L }
            [void]$stream.Seek($positions[$name], [IO.SeekOrigin]::Begin)
            $reader = New-Object IO.StreamReader($stream, [Text.Encoding]::UTF8)
            $chunk = $reader.ReadToEnd()
            $positions[$name] = $stream.Position
            if ($chunk.Length -gt 0) {
                Write-Output "[$name]"
                Write-Output $chunk.TrimEnd()
            }
        } catch [IO.IOException] {
            # A process may briefly lock or recreate its log while restarting.
        } finally {
            if ($reader) { $reader.Dispose() }
            elseif ($stream) { $stream.Dispose() }
        }
    }
    Start-Sleep -Milliseconds 250
}
} finally {
    $sessionJob.Dispose()
    $launcher.Dispose()
}
]=])
file(TO_NATIVE_PATH "${RUN_SCRIPT}" RUN_SCRIPT_NATIVE)
execute_process(
    COMMAND "${POWERSHELL_EXECUTABLE}" -NoProfile -NonInteractive -ExecutionPolicy Bypass
        -File "${RUN_SCRIPT_NATIVE}"
        -ProjectRoot "${WORKTREE_PATH}"
        -Target "${EVEN_TARGET}" -Port "${EVEN_PORT}" ${G2_HOST_ARGS}
    WORKING_DIRECTORY "${WORKTREE_PATH}"
    RESULT_VARIABLE run_result
    # Keep this command attached to the terminal for live log output.
    ENCODING UTF-8
)
if(NOT run_result STREQUAL "0")
    message(FATAL_ERROR "Launcher stopped: ${run_result}")
endif()
