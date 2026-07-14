const CACHE_NAME = 'runbits-v1';
const APP_SHELL = [
  '/',
  '/index.html',
  '/workspace.html',
  '/css/shared.css',
  '/css/landing.css',
  '/css/workspace.css',
  '/js/app.js',
  '/js/vfs.js',
  '/js/workspace.js',
  '/manifest.json',
];

const MIME_MAP = {
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
  ts: 'text/typescript', tsx: 'text/typescript',
  jsx: 'application/javascript', py: 'text/x-python',
};

let vfsCache = new Map();

// ── Install: Pre-cache app shell ──
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

// ── Activate: Clean old caches ──
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ── Message handler ──
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
      vfsCache.set(normalizePath(path), { content, mimeType: mimeType || guessMime(path) });
    }
  } else if (type === 'vfs-remove') {
    if (path) vfsCache.delete(normalizePath(path));
  } else if (type === 'vfs-clear') {
    vfsCache.clear();
  }
});

function normalizePath(p) {
  return ('/' + p.replace(/^\//, '')).replace(/\/+/g, '/');
}

function guessMime(path) {
  const ext = path.split('.').pop().toLowerCase();
  return MIME_MAP[ext] || 'application/octet-stream';
}

// ── Fetch: VFS first, then cache, then network ──
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Only handle same-origin
  if (url.origin !== self.location.origin) return;

  const path = normalizePath(url.pathname);

  // Check VFS cache
  const entry = vfsCache.get(path);
  if (entry) {
    event.respondWith(new Response(entry.content, {
      headers: { 'Content-Type': entry.mimeType, 'Cache-Control': 'no-cache' },
    }));
    return;
  }

  // Try directory index
  if (path.endsWith('/')) {
    const indexEntry = vfsCache.get(path + 'index.html');
    if (indexEntry) {
      event.respondWith(new Response(indexEntry.content, {
        headers: { 'Content-Type': indexEntry.mimeType, 'Cache-Control': 'no-cache' },
      }));
      return;
    }
  }

  // Fall back to cache, then network
  event.respondWith(
    caches.match(event.request).then((cached) => {
      return cached || fetch(event.request).then((response) => {
        // Cache successful responses for app shell
        if (response.ok && event.request.method === 'GET') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      });
    }).catch(() => {
      // Offline fallback
      if (event.request.mode === 'navigate') {
        return caches.match('/index.html');
      }
      return new Response('Offline', { status: 503 });
    })
  );
});
