@echo off
REM Remove o registro do native host da Promos (reverte o instalar.bat).
reg delete "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.promos.opener" /f
echo.
echo  Native host removido.
echo.
pause
