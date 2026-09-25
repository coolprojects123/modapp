<#
.SYNOPSIS
  Copies (mirrors) the dev "mods" folder into modapp's AppData mods folder.

.DESCRIPTION
  modapp loads mods from disk in its app-data directory, not from the
  build output, so during dev you need your local `mods\` folder synced
  into %APPDATA%\<tauri-identifier>\mods every time you change a mod.

  This script finds your Tauri app's identifier from tauri.conf.json
  (searched near the script / current directory) to build the AppData
  path automatically. Override with -Destination if it guesses wrong.

.PARAMETER Source
  Path to your dev mods folder. Defaults to ".\mods" relative to the
  current directory.

.PARAMETER Destination
  Path to the mods folder inside AppData. If omitted, the script tries
  to detect it from tauri.conf.json's "identifier" field.

.PARAMETER Watch
  If set, keeps running and re-syncs automatically whenever a file
  under -Source changes, is added, or is removed (Ctrl+C to stop).

.EXAMPLE
  .\sync-mods.ps1
  One-time mirror copy using auto-detected paths.

.EXAMPLE
  .\sync-mods.ps1 -Watch
  Copies once, then keeps watching and re-syncing on every change.

.EXAMPLE
  .\sync-mods.ps1 -Source "C:\dev\modapp\mods" -Destination "C:\Users\me\AppData\Roaming\com.modapp.app\mods"
  Explicit paths, skipping auto-detection.
#>

param(
    [string]$Source = ".\mods",
    [string]$Destination,
    [switch]$Watch
)

function Find-TauriIdentifier {
    # Look for tauri.conf.json in common spots relative to cwd / script dir.
    $candidates = @(
        ".\src-tauri\tauri.conf.json",
        "..\src-tauri\tauri.conf.json",
        (Join-Path $PSScriptRoot "src-tauri\tauri.conf.json"),
        (Join-Path $PSScriptRoot "..\src-tauri\tauri.conf.json")
    )

    foreach ($path in $candidates) {
        if (Test-Path $path) {
            try {
                $json = Get-Content $path -Raw | ConvertFrom-Json
                if ($json.identifier) { return $json.identifier }
            } catch {
                Write-Warning "Found $path but couldn't parse it: $_"
            }
        }
    }
    return $null
}

# Resolve source
if (-not (Test-Path $Source)) {
    Write-Error "Source mods folder not found: $Source"
    exit 1
}
$Source = (Resolve-Path $Source).Path

# Resolve destination
if (-not $Destination) {
    $identifier = Find-TauriIdentifier
    if (-not $identifier) {
        Write-Error "Couldn't auto-detect the Tauri app identifier. Pass -Destination explicitly, e.g.:`n  .\sync-mods.ps1 -Destination `"$env:APPDATA\<your.app.identifier>\mods`""
        exit 1
    }
    $Destination = Join-Path $env:APPDATA "$identifier\mods"
    Write-Host "Detected app identifier '$identifier' -> $Destination"
}

if (-not (Test-Path $Destination)) {
    New-Item -ItemType Directory -Path $Destination -Force | Out-Null
}

function Sync-Mods {
    Write-Host "Syncing $Source -> $Destination"
    # /MIR mirrors the tree (adds, updates, and removes files that no
    # longer exist in Source). /NFL /NDL /NJH /NJS quiet the noisy log.
    robocopy $Source $Destination /MIR /NFL /NDL /NJH /NJS | Out-Null
    $code = $LASTEXITCODE
    if ($code -le 7) {
        Write-Host "Sync complete ($(Get-Date -Format 'HH:mm:ss'))."
    } else {
        Write-Warning "robocopy exited with code $code - check the paths above."
    }
}

Sync-Mods

if ($Watch) {
    Write-Host "Watching $Source for changes... (Ctrl+C to stop)"

    $fsw = New-Object System.IO.FileSystemWatcher $Source -Property @{
        IncludeSubdirectories = $true
        EnableRaisingEvents   = $true
    }

    $action = {
        Start-Sleep -Milliseconds 300  # debounce rapid saves
        Sync-Mods
    }

    Register-ObjectEvent $fsw Changed -Action $action | Out-Null
    Register-ObjectEvent $fsw Created -Action $action | Out-Null
    Register-ObjectEvent $fsw Deleted -Action $action | Out-Null
    Register-ObjectEvent $fsw Renamed -Action $action | Out-Null

    try {
        while ($true) { Start-Sleep -Seconds 1 }
    } finally {
        Get-EventSubscriber | Unregister-Event
        $fsw.Dispose()
    }
}