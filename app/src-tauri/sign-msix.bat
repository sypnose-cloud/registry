@echo off
echo === Signing Registry MSIX ===
echo.
set SIGNTOOL="C:\Program Files (x86)\Windows Kits\10\bin\10.0.19041.0\x64\signtool.exe"
set MSIX="C:\Users\carlo\repos\registry\app\src-tauri\target\release\bundle\msix\SypnoseRegistry_2.0.0_x64.msix"
set CERT="D:\CERTIFICADO\RepackagerExpress_renewed.pfx"
set /p PASS=Certificate password:
echo Signing...
%SIGNTOOL% sign /fd SHA256 /a /f %CERT% /p %PASS% %MSIX%
if %errorlevel% neq 0 ( echo FAILED & pause & exit /b 1 )
echo Verifying...
%SIGNTOOL% verify /pa %MSIX%
if %errorlevel% neq 0 ( echo VERIFY FAILED & pause & exit /b 1 )
echo.
echo === SIGNED OK ===
echo Ready to upload to Partner Center
pause
