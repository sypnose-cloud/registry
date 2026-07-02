$SignTool = 'C:\Program Files (x86)\Windows Kits\10\bin\10.0.19041.0\x64\signtool.exe'
$Msix = 'C:\Users\carlo\repos\registry\app\src-tauri\target\release\bundle\msix\SypnoseRegistry_0.1.0_x64.msix'
$Cert = 'D:\CERTIFICADO\RepackagerExpress_renewed.pfx'
$p = [System.IO.File]::ReadAllText('D:\CERTIFICADO\pass.txt').Trim()
& $SignTool sign /fd SHA256 /a /f $Cert /p $p $Msix
if ($LASTEXITCODE -ne 0) { Write-Error "SIGN FAILED"; exit 1 }
& $SignTool verify /pa $Msix
if ($LASTEXITCODE -ne 0) { Write-Error "VERIFY FAILED"; exit 1 }
Write-Host "=== SIGNED AND VERIFIED OK ==="
