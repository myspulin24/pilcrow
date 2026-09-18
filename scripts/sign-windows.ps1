# Podepsat hlavní binárku dřív, než ji zabalí instalátor.
#
# Tauri podepisuje instalátory a své pomocné DLL, ale `Reader_MJ.exe` nechává
# tak, jak vyšlo z kompilátoru -- a přesně ten soubor NSIS zabalí a nainstaluje
# (viz `MAINBINARYSRCPATH` v generovaném `installer.nsi`). Bez tohohle kroku by
# tedy byl podepsaný instalátor, ale nainstalovaná aplikace ne: ve vlastnostech
# souboru by po instalaci žádný vydavatel nebyl.
#
# Spouští se jako `beforeBundleCommand` z `tauri.codesign.conf.json`, takže
# běží jen u sestavení, které se opravdu podepisuje. Obyčejný `npm run build`
# se ho ani nedotkne.

$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent
$config = Join-Path $root 'src-tauri\tauri.codesign.conf.json'
$binary = Join-Path $root 'src-tauri\target\release\Reader_MJ.exe'

# Otisk je jen jeden a je v konfiguraci, ať se nemůže rozejít s tím, čím
# podepisuje Tauri samo.
$signing = (Get-Content $config -Raw | ConvertFrom-Json).bundle.windows
$thumbprint = $signing.certificateThumbprint
$timestamp = $signing.timestampUrl

if (-not (Test-Path $binary)) {
    throw "Není co podepsat: $binary neexistuje."
}

# signtool je součástí Windows SDK a cesta k němu obsahuje číslo verze,
# takže se hledá; bereme nejnovější.
$signtool = Get-ChildItem 'C:\Program Files (x86)\Windows Kits\10\bin\*\x64\signtool.exe' -ErrorAction SilentlyContinue |
    Sort-Object FullName -Descending |
    Select-Object -First 1

if (-not $signtool) {
    throw 'signtool.exe nenalezen. Nainstaluj Windows SDK, nebo podpis vypni tím, že nepoužiješ tauri.codesign.conf.json.'
}

& $signtool.FullName sign /fd SHA256 /sha1 $thumbprint /tr $timestamp /td SHA256 $binary
if ($LASTEXITCODE -ne 0) {
    throw "Podpis $binary selhal (signtool skončil s kódem $LASTEXITCODE)."
}

# Kontrola, ne zdvořilost: tichý nepodpis by se poznal až na cizím počítači.
$signature = Get-AuthenticodeSignature $binary
if (-not $signature.SignerCertificate) {
    throw "Po podepsání nemá $binary podpis."
}
Write-Output "Podepsáno: $($signature.SignerCertificate.Subject)"
