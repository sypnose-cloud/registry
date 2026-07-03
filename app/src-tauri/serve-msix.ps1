$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add('http://localhost:9876/')
$listener.Start()
Write-Host "Serving MSIX on http://localhost:9876/msix"
while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $resp = $ctx.Response
    if ($ctx.Request.HttpMethod -eq 'OPTIONS' -or $ctx.Request.Url.AbsolutePath -eq '/msix') {
        $resp.AddHeader('Access-Control-Allow-Origin', '*')
        $resp.AddHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
        $resp.AddHeader('Access-Control-Allow-Headers', '*')
        if ($ctx.Request.HttpMethod -eq 'GET') {
            $file = 'C:\Users\carlo\repos\registry\app\src-tauri\target\release\bundle\msix\SypnoseRegistry_2.0.0_x64.msix'
            $bytes = [System.IO.File]::ReadAllBytes($file)
            $resp.ContentType = 'application/octet-stream'
            $resp.ContentLength64 = $bytes.Length
            $resp.OutputStream.Write($bytes, 0, $bytes.Length)
        }
    }
    $resp.Close()
    if ($ctx.Request.Url.AbsolutePath -eq '/stop') { break }
}
$listener.Stop()
