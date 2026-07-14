const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.otf': 'font/otf',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.wasm': 'application/wasm',
};

const server = http.createServer((req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  let filePath = req.url === '/' ? '/index.html' : req.url;
  filePath = filePath.split('?')[0];
  filePath = path.join(__dirname, filePath);

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404);
        res.end('Not Found');
      } else {
        res.writeHead(500);
        res.end('Internal Server Error');
      }
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

// WebSocket-like SSE for hot reload (simple implementation)
const clients = new Set();

server.on('upgrade', (req, socket, head) => {
  // Simple WebSocket upgrade for hot reload
  const key = req.headers['sec-websocket-key'];
  if (!key) return;

  const acceptKey = crypto
    .createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-5AB5DC11CE85')
    .digest('base64');

  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${acceptKey}\r\n\r\n`
  );

  clients.add(socket);
  console.log(`[Hot Reload] Client connected (${clients.size} total)`);

  socket.on('close', () => {
    clients.delete(socket);
    console.log(`[Hot Reload] Client disconnected (${clients.size} total)`);
  });

  socket.on('error', () => clients.delete(socket));
});

function notifyClients() {
  for (const client of clients) {
    try {
      client.write('\x00'); // ping frame
    } catch {
      clients.delete(client);
    }
  }
}

// Watch for file changes (optional)
if (process.argv.includes('--watch')) {
  const watchDir = process.argv[process.argv.indexOf('--watch') + 1] || '.';
  fs.watch(watchDir, { recursive: true }, (eventType, filename) => {
    if (filename) {
      console.log(`[Hot Reload] File changed: ${filename}`);
      notifyClients();
    }
  });
  console.log(`[Hot Reload] Watching ${path.resolve(watchDir)} for changes...`);
}

server.listen(PORT, () => {
  console.log(`\n  ⚡ Runbits Web Dev Server`);
  console.log(`  ➜ Local:   http://localhost:${PORT}`);
  console.log(`  ➜ Network: http://${getLocalIP()}:${PORT}\n`);
  console.log(`  Press Ctrl+C to stop.\n`);
});

function getLocalIP() {
  const { networkInterfaces } = require('os');
  for (const iface of Object.values(networkInterfaces())) {
    for (const alias of iface) {
      if (alias.family === 'IPv4' && !alias.internal) {
        return alias.address;
      }
    }
  }
  return '127.0.0.1';
}
