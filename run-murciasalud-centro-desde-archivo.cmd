@echo off
chcp 65001 >nul
cd /d "%~dp0"

if not exist "scripts\murciasalud-centro-url.txt" (
  if exist "scripts\murciasalud-centro-url.example.txt" (
    copy /y "scripts\murciasalud-centro-url.example.txt" "scripts\murciasalud-centro-url.txt" >nul
    echo Creado scripts\murciasalud-centro-url.txt desde el ejemplo. Edita ese .txt si necesitas otra URL.
    echo.
  ) else (
    echo Falta scripts\murciasalud-centro-url.txt y el ejemplo.
    pause
    exit /b 1
  )
)

node "scripts\murciasalud-centros-prescriptores-sql.js"
set "EC=%ERRORLEVEL%"
echo.
if not "%EC%"=="0" (
  echo Error ^(codigo %EC%^). Si ves CAPTCHA, guarda la ficha en HTML y ejecuta:
  echo   node scripts\murciasalud-centros-prescriptores-sql.js --html ruta\ficha.html
) else (
  echo Listo. Copia el INSERT de arriba hacia MySQL o phpMyAdmin.
)
pause
exit /b %EC%
