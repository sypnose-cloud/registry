import http.server

class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/msix':
            with open('C:/Users/carlo/repos/registry/app/src-tauri/target/release/bundle/msix/SypnoseRegistry_0.1.0_x64.msix', 'rb') as f:
                data = f.read()
            self.send_response(200)
            self.send_header('Content-Type', 'application/octet-stream')
            self.send_header('Content-Length', len(data))
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(data)
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET')
        self.end_headers()

s = http.server.HTTPServer(('127.0.0.1', 9876), H)
print('Serving MSIX on http://localhost:9876/msix')
s.serve_forever()
