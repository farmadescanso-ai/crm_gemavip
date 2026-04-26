@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0\.."

if "%~1"=="" (
  if defined MURCIASALUD_CENTRO_URL (
    node "scripts\murciasalud-centros-prescriptores-sql.js"
    goto :after_node
  )
  echo.
  echo  MurciaSalud - SQL INSERT centros_prescriptores
  echo  ================================================
  echo.
  echo  En PowerShell el caracter ^& en la URL suele CORTARSE si usas este .bat.
  echo  Mejor usa ^(misma carpeta scripts o raiz^):
  echo    .\run-murciasalud-centro-sql.ps1 "https://www.murciasalud.es/caps.php?op=mostrar_centro^&id_centro=12^&idsec=6"
  echo  O variable ^(comillas simples en PowerShell^) y este .bat sin argumentos:
  echo    $env:MURCIASALUD_CENTRO_URL = 'https://...toda-la-URL-incluido-id_centro...'
  echo    .\scripts\run-murciasalud-centro-sql.bat
  echo.
  echo  Desde cmd.exe el .bat con comillas dobles suele ir bien:
  echo    run-murciasalud-centro-sql.bat "https://...^&id_centro=..."
  echo.
  echo  La URL debe llevar op=mostrar_centro e id_centro=...
  echo  Si aparece CAPTCHA al descargar, guarda la ficha como HTML y ejecuta:
  echo    node scripts\murciasalud-centros-prescriptores-sql.js --html ruta\ficha.html
  echo.
  echo  Opcional: anexar salida a un .sql
  echo    node scripts\murciasalud-centros-prescriptores-sql.js "URL" --out salida.sql
  echo.
  pause
  exit /b 1
)

node "scripts\murciasalud-centros-prescriptores-sql.js" %*

:after_node
set "EC=%ERRORLEVEL%"
echo.
if not "%EC%"=="0" (
  echo Error ^(codigo %EC%^). Revisa el mensaje arriba.
) else (
  echo Listo. Copia el INSERT de arriba y ejecutalo en MySQL/phpMyAdmin.
)
pause
exit /b %EC%
