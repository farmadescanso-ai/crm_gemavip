#Requires -Version 5.1
# MurciaSalud → INSERT SQL (centros_prescriptores). En PowerShell pasa la URL con & correctamente.
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repoRoot
$nodeScript = Join-Path $repoRoot 'scripts\murciasalud-centros-prescriptores-sql.js'
if (-not (Test-Path -LiteralPath $nodeScript)) {
  Write-Error "No se encontro: $nodeScript"
  exit 1
}

if ($args.Count -eq 0) {
  Write-Host ''
  Write-Host ' MurciaSalud - SQL INSERT centros_prescriptores'
  Write-Host ' ================================================'
  Write-Host ''
  Write-Host ' Desde la raiz del CRM (recomendado en PowerShell; la URL puede llevar &):'
  Write-Host '   .\run-murciasalud-centro-sql.ps1 "https://www.murciasalud.es/caps.php?op=mostrar_centro&id_centro=12&idsec=6"'
  Write-Host ''
  Write-Host ' Si el .bat corta la URL por el caracter &: usa este .ps1, o bien:'
  Write-Host '   $env:MURCIASALUD_CENTRO_URL = ''https://...completa...'''
  Write-Host '   .\scripts\run-murciasalud-centro-sql.bat'
  Write-Host ''
  Write-Host ' CAPTCHA al descargar: guarda la ficha como HTML y:'
  Write-Host '   node scripts\murciasalud-centros-prescriptores-sql.js --html ruta\ficha.html'
  Write-Host ''
  Read-Host 'Pulsa Enter para salir'
  exit 1
}

& node $nodeScript @args
$ec = $LASTEXITCODE
Write-Host ''
if ($ec -ne 0) {
  Write-Host "Error (codigo $ec). Revisa el mensaje arriba."
} else {
  Write-Host 'Listo. Copia el INSERT de arriba y ejecutalo en MySQL/phpMyAdmin.'
}
Read-Host 'Pulsa Enter para salir'
exit $ec
