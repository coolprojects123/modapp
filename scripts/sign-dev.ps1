<#PSScriptInfo
.VERSION 1.0
.GUID 12345678-1234-1234-1234-123456789012
.AUTHOR modapp
.DESCRIPTION Development signing script for Electron binaries using castLabs EVS
#>

<#
.SYNOPSIS
Signs Electron binaries in development mode using castLabs EVS for Widevine DRM support.

.DESCRIPTION
This script signs the Electron binary in the node_modules directory to enable
Widevine DRM support (for Spotify, Netflix, etc.) during development.

If no -AccountName and -Password parameters are provided, the script will use
cached credentials from ~/.castlabs_evs (created by: python -m castlabs_evs.account reauth).

.EXAMPLE
.\scripts\sign-dev.ps1
Signs the Electron binary using cached castLabs EVS credentials.

.EXAMPLE
.\scripts\sign-dev.ps1 -AccountName "your@email.com" -Password "yourpassword"
Signs the Electron binary with explicit credentials.

.NOTES
Requires:
- Python 3 with castlabs-evs installed (pip install castlabs-evs)
- castLabs EVS account

Environment variables (alternative to parameters):
- EVS_ACCOUNT_NAME: castLabs account email
- EVS_PASSWD: castLabs account password
#>

[CmdletBinding()]
param(
    [string]$AccountName = $env:EVS_ACCOUNT_NAME,
    [string]$Password = $env:EVS_PASSWD,
    [string]$ElectronPath = ".\node_modules\electron\dist",
    [switch]$Force = $false
)

function Write-Log {
    param([string]$Message, [string]$Level = "INFO")
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Write-Host "[$timestamp] [$Level] $Message"
}

function Write-ErrorExit {
    param([string]$Message, [int]$ExitCode = 1)
    Write-Log -Message $Message -Level "ERROR"
    exit $ExitCode
}

# Main script
try {
    # Check if Python is available
    if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
        Write-ErrorExit "Python is not available. Please install Python 3."
    }

    # Check if castlabs_evs is installed
    $result = python -m castlabs_evs --version 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Log "castlabs_evs not found. Installing..."
        python -m pip install castlabs-evs
        if ($LASTEXITCODE -ne 0) {
            Write-ErrorExit "Failed to install castlabs-evs. Run: python -m pip install castlabs-evs"
        }
    }

    # Check credentials - if not provided as parameters, use environment or cached
    $hasExplicitCredentials = !([string]::IsNullOrEmpty($AccountName) -or [string]::IsNullOrEmpty($Password))
    
    if ($hasExplicitCredentials) {
        # Validate explicit credentials
        if ([string]::IsNullOrEmpty($AccountName)) {
            Write-ErrorExit "EVS account name not provided. Use -AccountName parameter or set EVS_ACCOUNT_NAME environment variable."
        }
        
        if ([string]::IsNullOrEmpty($Password)) {
            Write-ErrorExit "EVS password not provided. Use -Password parameter or set EVS_PASSWD environment variable."
        }
    } else {
        Write-Log "No explicit credentials provided, using cached castLabs EVS credentials"
        $AccountName = $env:EVS_ACCOUNT_NAME
        $Password = $env:EVS_PASSWD
    }

    # Check Electron path
    if (-not (Test-Path $ElectronPath)) {
        Write-ErrorExit "Electron path not found: $ElectronPath. Run: npm install"
    }

    # Check if already signed (unless forced)
    $sigFile = Join-Path $ElectronPath "electron.exe.sig"
    if ((Test-Path $sigFile) -and (-not $Force)) {
        Write-Log "Electron binary is already signed: $sigFile"
        Write-Log "Use -Force to re-sign."
        exit 0
    }

    Write-Log "Starting castLabs EVS signing for Electron binary..."
    Write-Log "Account: $AccountName"
    Write-Log "Electron path: $ElectronPath"

    # Create environment variables for EVS authentication
    $env:EVS_ACCOUNT_NAME = $AccountName
    $env:EVS_PASSWD = $Password
    $env:EVS_NO_ASK = "1"  # Don't prompt for password in non-interactive mode

    # Run the signing command
    Write-Log "Running: python -m castlabs_evs.vmp sign-pkg $ElectronPath"
    
    $process = Start-Process -FilePath "python" -ArgumentList "-m castlabs_evs.vmp sign-pkg $ElectronPath" -NoNewWindow -Wait -PassThru
    
    if ($process.ExitCode -ne 0) {
        Write-ErrorExit "EVS signing failed with exit code $($process.ExitCode)"
    }

    # Verify signing
    if (Test-Path $sigFile) {
        Write-Log "SUCCESS: Electron binary signed successfully!"
        Write-Log "Signature file: $sigFile"
        
        # Get signature info
        $sigContent = Get-Content $sigFile -Raw
        if ($sigContent) {
            Write-Log "Signature: $($sigContent.Substring(0, [Math]::Min(50, $sigContent.Length))...)"
        }
    } else {
        Write-Log "WARNING: Signature file not created. Check if signing was successful." -Level "WARNING"
    }

    exit 0

} catch {
    Write-ErrorExit "Unexpected error: $($_.Exception.Message)"
}