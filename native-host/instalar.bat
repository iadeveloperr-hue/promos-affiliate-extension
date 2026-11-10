@echo off
REM Registra o native host da Promos para o usuario atual (todos os perfis do Chrome).
reg add "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.promos.opener" /ve /t REG_SZ /d "%~dp0com.promos.opener.json" /f
if %errorlevel%==0 (
  echo.
  echo  [OK] Native host registrado com sucesso.
) else (
  echo.
  echo  [ERRO] Nao foi possivel registrar. Tente executar como administrador.
)
echo.
pause
