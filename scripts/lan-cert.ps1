# Erzeugt ein HTTPS-Zertifikat für den lokalen Dev-Server im WLAN.
# Voraussetzung: mkcert ist installiert (winget install FiloSottile.mkcert).
#
# Das Skript installiert die Root-CA NICHT in den Windows-Zertifikatsspeicher –
# nur das iPad muss ihr vertrauen. Nie die Datei rootCA-key.pem weitergeben!

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$certs = Join-Path $root 'certs'

if (-not (Get-Command mkcert -ErrorAction SilentlyContinue)) {
  Write-Host 'mkcert fehlt. Installieren mit:  winget install FiloSottile.mkcert' -ForegroundColor Yellow
  exit 1
}

# WLAN-/LAN-Adresse mit Standard-Gateway finden
$ip = Get-NetIPConfiguration |
  Where-Object { $_.IPv4DefaultGateway -ne $null -and $_.NetAdapter.Status -eq 'Up' } |
  Select-Object -First 1 -ExpandProperty IPv4Address |
  Select-Object -ExpandProperty IPAddress

if (-not $ip) {
  Write-Host 'Keine LAN-Adresse gefunden. Bist du mit dem WLAN verbunden?' -ForegroundColor Yellow
  exit 1
}

New-Item -ItemType Directory -Force $certs | Out-Null
$hostName = $env:COMPUTERNAME.ToLower()
mkcert -cert-file (Join-Path $certs 'dev.pem') -key-file (Join-Path $certs 'dev-key.pem') $ip localhost "$hostName.local"

$caRoot = (mkcert -CAROOT).Trim()
Copy-Item (Join-Path $caRoot 'rootCA.pem') (Join-Path $certs 'rootCA.pem') -Force

Write-Host ''
Write-Host "Fertig. Zertifikat für $ip erstellt." -ForegroundColor Green
Write-Host ''
Write-Host 'Nächste Schritte auf dem iPad:'
Write-Host "  1. npm run dev:lan  (Port 5173)  oder  npm run preview:lan  (Port 4173, mit Offline-Modus)"
Write-Host "  2. Safari öffnen: https://${ip}:5173/__feder/rootCA.pem   (Warnung bestätigen)"
Write-Host '  3. Einstellungen > Profil geladen > Installieren'
Write-Host '  4. Einstellungen > Allgemein > Info > Zertifikatsvertrauenseinstellungen > mkcert aktivieren'
Write-Host "  5. https://${ip}:5173/ bzw. https://${ip}:4173/ öffnen"
