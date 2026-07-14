const RUNBITS_SW_VERSION = '1.0.0';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

// ── Message handler for VFS data sync ──
let vfsCache = new Map();

self.addEventListener('message', (event) => {
  const { type, files, path, content, mimeType } = event.data;

  if (type === 'vfs-sync') {
    vfsCache.clear();
    if (files) {
      files.forEach(f => {
        vfsCache.set(normalizePath(f.path), {
          content: f.content,
          mimeType: f.mimeType || guessMime(f.path),
        });
      });
    }
  } else if (type === 'vfs-update') {
    if (path && content !== undefined) {
      vfsCache.set(normalizePath(path), {
        content,
        mimeType: mimeType || guessMime(path),
      });
    }
  } else if (type === 'vfs-remove') {
    if (path) {
      vfsCache.delete(normalizePath(path));
    }
  } else if (type === 'vfs-clear') {
    vfsCache.clear();
  }
});

function normalizePath(p) {
  return ('/' + p.replace(/^\//, '')).replace(/\/+/g, '/');
}

function guessMime(path) {
  const ext = path.split('.').pop().toLowerCase();
  const map = {
    html: 'text/html', htm: 'text/html', css: 'text/css',
    js: 'application/javascript', mjs: 'application/javascript',
    json: 'application/json', xml: 'application/xml',
    svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg',
    jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
    ico: 'image/x-icon', woff: 'font/woff', woff2: 'font/woff2',
    ttf: 'font/ttf', otf: 'font/otf',
    mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg',
    wasm: 'application/wasm', txt: 'text/plain',
  };
  return map[ext] || 'application/octet-stream';
}

// ── Request Interception ──
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Only intercept same-origin requests
  if (url.origin !== self.location.origin) return;

  const path = normalizePath(url.pathname);

  // Check VFS cache first
  const entry = vfsCache.get(path);
  if (entry) {
    event.respondWith(new Response(entry.content, {
      headers: { 'Content-Type': entry.mimeType },
    }));
    return;
  }

  // For paths that look like directory index, try index.html
  if (path.endsWith('/')) {
    const indexEntry = vfsCache.get(path + 'index.html');
    if (indexEntry) {
      event.respondWith(new Response(indexEntry.content, {
        headers: { 'Content-Type': indexEntry.mimeType },
      }));
      return;
    }
  }
});

// ── Utility: notify all clients ──
function notifyClients(message) {
  self.clients.matchAll().then(clients => {
    clients.forEach(client => client.postMessage(message));
  });
}
