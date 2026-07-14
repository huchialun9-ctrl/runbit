window.RunbitsVFS = (() => {
  'use strict';

  const DB_NAME = 'runbits-vfs';
  const DB_VERSION = 1;
  const PROJECTS_STORE = 'projects';
  const FILES_STORE = 'files';

  let db = null;

  function open() {
    return new Promise((resolve, reject) => {
      if (db) return resolve(db);
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const database = e.target.result;
        if (!database.objectStoreNames.contains(PROJECTS_STORE)) {
          const ps = database.createObjectStore(PROJECTS_STORE, { keyPath: 'id' });
          ps.createIndex('name', 'name', { unique: false });
        }
        if (!database.objectStoreNames.contains(FILES_STORE)) {
          const fs = database.createObjectStore(FILES_STORE, { keyPath: 'id' });
          fs.createIndex('projectId', 'projectId', { unique: false });
          fs.createIndex('path', 'path', { unique: false });
          fs.createIndex('projectPath', ['projectId', 'path'], { unique: false });
        }
      };
      req.onsuccess = (e) => { db = e.target.result; resolve(db); };
      req.onerror = (e) => reject(e.target.error);
    });
  }

  function genId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function getMime(filename) {
    const ext = filename.split('.').pop().toLowerCase();
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

  // ── Project CRUD ──
  async function createProject(name) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(PROJECTS_STORE, 'readwrite');
      const store = tx.objectStore(PROJECTS_STORE);
      const project = {
        id: genId(),
        name: name || 'Untitled Project',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      const req = store.add(project);
      req.onsuccess = () => resolve(project);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async function getProject(id) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(PROJECTS_STORE, 'readonly');
      const req = tx.objectStore(PROJECTS_STORE).get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async function getAllProjects() {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(PROJECTS_STORE, 'readonly');
      const req = tx.objectStore(PROJECTS_STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async function deleteProject(id) {
    const db = await open();
    return new Promise(async (resolve, reject) => {
      const tx = db.transaction([PROJECTS_STORE, FILES_STORE], 'readwrite');
      tx.objectStore(PROJECTS_STORE).delete(id);
      const filesIndex = tx.objectStore(FILES_STORE).index('projectId');
      const req = filesIndex.openCursor(IDBKeyRange.only(id));
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject(e.target.error);
    });
  }

  // ── File CRUD ──
  async function addFile(projectId, path, content, mimeType) {
    const db = await open();
    const name = path.split('/').pop();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(FILES_STORE, 'readwrite');
      const store = tx.objectStore(FILES_STORE);
      const file = {
        id: genId(),
        projectId,
        path: '/' + path.replace(/^\//, ''),
        name,
        content: typeof content === 'string' ? content : '',
        mimeType: mimeType || getMime(name),
        size: typeof content === 'string' ? new Blob([content]).size : 0,
        updatedAt: Date.now(),
      };
      const req = store.add(file);
      req.onsuccess = () => resolve(file);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async function updateFile(fileId, content) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(FILES_STORE, 'readwrite');
      const store = tx.objectStore(FILES_STORE);
      const getReq = store.get(fileId);
      getReq.onsuccess = () => {
        const file = getReq.result;
        if (!file) return reject(new Error('File not found'));
        file.content = typeof content === 'string' ? content : file.content;
        file.size = new Blob([file.content]).size;
        file.updatedAt = Date.now();
        const putReq = store.put(file);
        putReq.onsuccess = () => resolve(file);
        putReq.onerror = (e) => reject(e.target.error);
      };
      getReq.onerror = (e) => reject(e.target.error);
    });
  }

  async function getFile(projectId, path) {
    const db = await open();
    const normalizedPath = '/' + path.replace(/^\//, '');
    return new Promise((resolve, reject) => {
      const tx = db.transaction(FILES_STORE, 'readonly');
      const index = tx.objectStore(FILES_STORE).index('projectPath');
      const req = index.get([projectId, normalizedPath]);
      req.onsuccess = () => resolve(req.result);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async function getFileById(fileId) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(FILES_STORE, 'readonly');
      const req = tx.objectStore(FILES_STORE).get(fileId);
      req.onsuccess = () => resolve(req.result);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async function getAllFiles(projectId) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(FILES_STORE, 'readonly');
      const index = tx.objectStore(FILES_STORE).index('projectId');
      const req = index.getAll(projectId);
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async function deleteFile(fileId) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(FILES_STORE, 'readwrite');
      const req = tx.objectStore(FILES_STORE).delete(fileId);
      req.onsuccess = () => resolve();
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async function renameFile(fileId, newPath) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(FILES_STORE, 'readwrite');
      const store = tx.objectStore(FILES_STORE);
      const getReq = store.get(fileId);
      getReq.onsuccess = () => {
        const file = getReq.result;
        if (!file) return reject(new Error('File not found'));
        file.path = '/' + newPath.replace(/^\//, '');
        file.name = newPath.split('/').pop();
        file.mimeType = getMime(file.name);
        file.updatedAt = Date.now();
        const putReq = store.put(file);
        putReq.onsuccess = () => resolve(file);
        putReq.onerror = (e) => reject(e.target.error);
      };
      getReq.onerror = (e) => reject(e.target.error);
    });
  }

  // ── Import from File objects ──
  async function importFiles(projectId, fileObjects) {
    const results = [];
    for (const file of fileObjects) {
      const path = file._relativePath || file.webkitRelativePath || file.name;
      const content = await readFileAsText(file);
      const f = await addFile(projectId, path, content, getMime(path));
      results.push(f);
    }
    return results;
  }

  function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
    });
  }

  // ── Build tree structure ──
  function buildTree(files) {
    const root = { name: '/', children: {}, type: 'dir' };

    files.forEach(f => {
      const parts = f.path.split('/').filter(Boolean);
      let current = root;

      parts.forEach((part, i) => {
        if (i === parts.length - 1) {
          current.children[part] = {
            name: part,
            type: 'file',
            id: f.id,
            mimeType: f.mimeType,
            size: f.size,
            updatedAt: f.updatedAt,
          };
        } else {
          if (!current.children[part]) {
            current.children[part] = { name: part, children: {}, type: 'dir' };
          }
          current = current.children[part];
        }
      });
    });

    return root;
  }

  // ── Get entry by path ──
  function getEntry(tree, path) {
    const parts = path.split('/').filter(Boolean);
    let current = tree;
    for (const part of parts) {
      if (!current.children || !current.children[part]) return null;
      current = current.children[part];
    }
    return current;
  }

  // ── Clear all data ──
  async function clearAll() {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([PROJECTS_STORE, FILES_STORE], 'readwrite');
      tx.objectStore(PROJECTS_STORE).clear();
      tx.objectStore(FILES_STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject(e.target.error);
    });
  }

  return {
    open,
    createProject,
    getProject,
    getAllProjects,
    deleteProject,
    addFile,
    updateFile,
    getFile,
    getFileById,
    getAllFiles,
    deleteFile,
    renameFile,
    importFiles,
    buildTree,
    getEntry,
    clearAll,
    getMime,
  };
})();
