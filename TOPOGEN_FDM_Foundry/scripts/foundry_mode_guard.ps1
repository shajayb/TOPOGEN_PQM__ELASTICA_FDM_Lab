<#
.SYNOPSIS
    Cryptographic Mode A / Mode B surface boundary verifier and resealer for TOPOGEN_FDM_Foundry.
.DESCRIPTION
    PowerShell wrapper delegating to `foundry_mode_guard.mjs` (Node ESM) and preserving exit codes:
      0 = pass / resealed
      1 = verification failure or error
      2 = MODE LOCK VIOLATION (e.g., -Mode A -Reseal) or AIR-GAP VIOLATION
#>
[CmdletBinding()]
param(
    [ValidateSet("A", "B")]
    [string]$Mode = "A",

    [switch]$Verify,

    [switch]$Reseal,

    [switch]$SelfTest,

    [switch]$SkipBench,

    [string]$FoundryRoot = "",

    [switch]$Json
)

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$MjsPath = Join-Path $ScriptDir "foundry_mode_guard.mjs"

if (-not (Test-Path -LiteralPath $MjsPath -PathType Leaf)) {
    [Console]::Error.WriteLine("[FOUNDRY-GUARD-ERROR] Missing $MjsPath")
    exit 1
}

$nodeArgs = @($MjsPath, "--mode", $Mode)
if ($Verify) { $nodeArgs += "--verify" }
if ($Reseal) { $nodeArgs += "--reseal" }
if ($SelfTest) { $nodeArgs += "--self-test" }
if ($SkipBench) { $nodeArgs += "--skip-bench" }
if (-not [string]::IsNullOrWhiteSpace($FoundryRoot)) {
    $nodeArgs += "--foundry-root"
    $nodeArgs += $FoundryRoot
}
if ($Json) { $nodeArgs += "--json" }

$prevEap = $ErrorActionPreference
$ErrorActionPreference = "Continue"
& node @nodeArgs
$code = $LASTEXITCODE
$ErrorActionPreference = $prevEap
exit $code
