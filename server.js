const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const QRCode = require('qrcode');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

// ── WebSocket for Hot Reload ──
const wss = new WebSocketServer({ server });
const clients = new Set();

wss.on('connection', (ws) => {
  clients.add(ws);
  console.log(`[WS] Client connected (${clients.size} total)`);
  ws.on('close', () => {
    clients.delete(ws);
    console.log(`[WS] Client disconnected (${clients.size} total)`);
  });
  ws.on('error', () => clients.delete(ws));
});

function notifyClients(message) {
  const data = typeof message === 'string' ? message : JSON.stringify(message);
  for (const client of clients) {
    if (client.readyState === 1) {
      try { client.send(data); } catch { clients.delete(client); }
    }
  }
}

// ── Middleware ──
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// CORS for local development
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ── In-Memory Project Store ──
const projects = new Map();

// ── API Routes ──

// List all projects
app.get('/api/projects', (req, res) => {
  const list = Array.from(projects.values()).map(p => ({
    id: p.id,
    name: p.name,
    fileCount: Object.keys(p.files).length,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  }));
  res.json({ projects: list });
});

// Create a new project
app.post('/api/projects', (req, res) => {
  const { name } = req.body;
  const id = genId();
  const project = {
    id,
    name: name || 'Untitled Project',
    files: {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  projects.set(id, project);
  res.json({ project: { id: project.id, name: project.name, createdAt: project.createdAt } });
});

// Get project details
app.get('/api/projects/:id', (req, res) => {
  const project = projects.get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const files = Object.entries(project.files).map(([path, f]) => ({
    path,
    name: path.split('/').pop(),
    mimeType: f.mimeType,
    size: f.size,
    updatedAt: f.updatedAt,
  }));
  res.json({
    project: { id: project.id, name: project.name, createdAt: project.createdAt },
    files,
  });
});

// Delete project
app.delete('/api/projects/:id', (req, res) => {
  if (!projects.has(req.params.id)) return res.status(404).json({ error: 'Project not found' });
  projects.delete(req.params.id);
  res.json({ ok: true });
});

// Create/update file in project
app.put('/api/projects/:id/files', (req, res) => {
  const project = projects.get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const { path: filePath, content, mimeType } = req.body;
  if (!filePath) return res.status(400).json({ error: 'path is required' });

  const normalizedPath = '/' + filePath.replace(/^\//, '');
  project.files[normalizedPath] = {
    content: content || '',
    mimeType: mimeType || getMime(normalizedPath),
    size: new Blob([content || '']).size,
    updatedAt: Date.now(),
  };
  project.updatedAt = Date.now();

  // Notify connected WebSocket clients
  notifyClients(JSON.stringify({
    type: 'file-change',
    projectId: project.id,
    path: normalizedPath,
  }));

  res.json({ ok: true, path: normalizedPath });
});

// Batch upload files
app.post('/api/projects/:id/files/batch', (req, res) => {
  const project = projects.get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const { files } = req.body;
  if (!Array.isArray(files)) return res.status(400).json({ error: 'files array is required' });

  let count = 0;
  for (const f of files) {
    const normalizedPath = '/' + (f.path || '').replace(/^\//, '');
    if (!normalizedPath) continue;
    project.files[normalizedPath] = {
      content: f.content || '',
      mimeType: f.mimeType || getMime(normalizedPath),
      size: new Blob([f.content || '']).size,
      updatedAt: Date.now(),
    };
    count++;
  }
  project.updatedAt = Date.now();

  notifyClients(JSON.stringify({ type: 'files-sync', projectId: project.id }));

  res.json({ ok: true, count });
});

// Delete file
app.delete('/api/projects/:id/files', (req, res) => {
  const project = projects.get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const { path: filePath } = req.query;
  if (!filePath) return res.status(400).json({ error: 'path query is required' });

  const normalizedPath = '/' + filePath.replace(/^\//, '');
  if (!project.files[normalizedPath]) return res.status(404).json({ error: 'File not found' });

  delete project.files[normalizedPath];
  project.updatedAt = Date.now();

  notifyClients(JSON.stringify({
    type: 'file-delete',
    projectId: project.id,
    path: normalizedPath,
  }));

  res.json({ ok: true });
});

// Get file content
app.get('/api/projects/:id/files', (req, res) => {
  const project = projects.get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const { path: filePath } = req.query;
  if (!filePath) return res.status(400).json({ error: 'path query is required' });

  const normalizedPath = '/' + filePath.replace(/^\//, '');
  const file = project.files[normalizedPath];
  if (!file) return res.status(404).json({ error: 'File not found' });

  res.json({ path: normalizedPath, content: file.content, mimeType: file.mimeType });
});

// Serve project files for preview (virtual hosting)
app.get('/preview/:projectId/*', (req, res) => {
  const project = projects.get(req.params.projectId);
  if (!project) return res.status(404).send('Project not found');

  let filePath = '/' + (req.params[0] || 'index.html');
  const file = project.files[filePath];

  if (!file) {
    // Try index.html in directory
    if (!filePath.endsWith('.html')) {
      const indexFile = project.files[filePath + '/index.html'] || project.files[filePath + '/index'];
      if (indexFile) {
        res.setHeader('Content-Type', indexFile.mimeType);
        return res.send(indexFile.content);
      }
    }
    return res.status(404).send('File not found');
  }

  res.setHeader('Content-Type', file.mimeType);
  res.setHeader('Cache-Control', 'no-cache');
  res.send(file.content);
});

// QR Code generation
app.get('/api/qr', async (req, res) => {
  try {
    const { text, size } = req.query;
    if (!text) return res.status(400).json({ error: 'text query is required' });

    const qrSize = parseInt(size) || 200;
    const dataUrl = await QRCode.toDataURL(text, {
      width: qrSize,
      margin: 2,
      color: { dark: '#000000', light: '#ffffff' },
    });
    res.json({ dataUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// QR Code as PNG
app.get('/api/qr.png', async (req, res) => {
  try {
    const { text, size } = req.query;
    if (!text) return res.status(400).send('text query required');

    const qrSize = parseInt(size) || 200;
    const buffer = await QRCode.toBuffer(text, {
      width: qrSize,
      margin: 2,
    });
    res.setHeader('Content-Type', 'image/png');
    res.send(buffer);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// ── Hot Reload Script Injection ──
const hotReloadScript = `
<script>
(function(){
  var ws = new WebSocket('ws://' + location.host);
  ws.onmessage = function(e) {
    try {
      var msg = JSON.parse(e.data);
      if (msg.type === 'file-change' || msg.type === 'files-sync') {
        location.reload();
      }
    } catch(err) {}
  };
  ws.onclose = function() {
    setTimeout(function() { location.reload(); }, 2000);
  };
})();
</script>`;

// ── Static Files ──
app.use(express.static(path.join(__dirname), {
  index: 'index.html',
  setHeaders: (res, filePath) => {
    // No cache for development - always serve fresh files
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
  },
}));

// Inject hot-reload script into HTML pages
app.use((req, res, next) => {
  if (req.path.endsWith('.html') || req.path === '/') {
    const filePath = path.join(__dirname, req.path === '/' ? 'index.html' : req.path);
    if (fs.existsSync(filePath)) {
      let content = fs.readFileSync(filePath, 'utf8');
      // Always inject fresh hot-reload script
      content = content.replace('</body>', hotReloadScript + '\n</body>');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      return res.send(content);
    }
  }
  next();
});

// SPA fallback
app.get('*', (req, res) => {
  const indexPath = path.join(__dirname, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send('Not Found');
  }
});

// ── Helpers ──
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function getMime(filePath) {
  const ext = filePath.split('.').pop().toLowerCase();
  const map = {
    html: 'text/html', htm: 'text/html', css: 'text/css',
    js: 'application/javascript', mjs: 'application/javascript',
    json: 'application/json', xml: 'application/xml',
    svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg',
    jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
    ico: 'image/x-icon', bmp: 'image/bmp',
    woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf',
    otf: 'font/otf', eot: 'application/vnd.ms-fontobject',
    mp4: 'video/mp4', webm: 'video/webm', ogg: 'audio/ogg',
    mp3: 'audio/mpeg', wav: 'audio/wav',
    pdf: 'application/pdf', zip: 'application/zip',
    wasm: 'application/wasm', txt: 'text/plain',
    md: 'text/markdown', csv: 'text/csv',
    ts: 'application/typescript', tsx: 'application/typescript',
    jsx: 'application/javascript', py: 'text/x-python',
  };
  return map[ext] || 'application/octet-stream';
}

function getLocalIP() {
  const { networkInterfaces } = require('os');
  for (const iface of Object.values(networkInterfaces())) {
    for (const alias of iface) {
      if (alias.family === 'IPv4' && !alias.internal) return alias.address;
    }
  }
  return '127.0.0.1';
}

// ── Start Server ──
server.listen(PORT, () => {
  const ip = getLocalIP();
  console.log('');
  console.log('  \x1b[36m⚡ Runbits Web Server\x1b[0m');
  console.log('');
  console.log('  \x1b[32m➜\x1b[0m  Local:    \x1b[1mhttp://localhost:' + PORT + '\x1b[0m');
  console.log('  \x1b[32m➜\x1b[0m  Network:  \x1b[1mhttp://' + ip + ':' + PORT + '\x1b[0m');
  console.log('  \x1b[32m➜\x1b[0m  API:      \x1b[1mhttp://localhost:' + PORT + '/api/projects\x1b[0m');
  console.log('');
  console.log('  \x1b[90mPress Ctrl+C to stop.\x1b[0m');
  console.log('');
});
