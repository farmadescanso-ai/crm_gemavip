#Requires -Version 5.1
# Invoca Node sin pasar por cmd.exe (evita que & en la URL se corte al usar .bat desde PowerShell).
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
  Write-Host ' Ejemplo (URL con &):'
  Write-Host '   .\scripts\run-murciasalud-centro-sql.ps1 "https://www.murciasalud.es/caps.php?op=mostrar_centro&id_centro=12&idsec=6"'
  Write-Host ''
  Write-Host ' Desde la raiz tambien puedes usar:'
  Write-Host '   .\run-murciasalud-centro-sql.ps1 "https://..."'
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
