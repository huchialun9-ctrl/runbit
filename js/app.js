(() => {
  'use strict';

  const GITHUB_URL = 'https://github.com/huchialun9-ctrl/runbit.git';

  // ── Shared Utilities ──
  function getMimeFromExt(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const map = {
      html: 'text/html', htm: 'text/html', css: 'text/css',
      js: 'application/javascript', mjs: 'application/javascript',
      json: 'application/json', svg: 'image/svg+xml',
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
      gif: 'image/gif', webp: 'image/webp', ico: 'image/x-icon',
      woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf',
      txt: 'text/plain', md: 'text/markdown',
    };
    return map[ext] || 'application/octet-stream';
  }

  function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  }

  function resolveEntries(entries) {
    const allFiles = [];

    function readEntry(entry, path) {
      return new Promise((resolve) => {
        if (entry.isFile) {
          entry.file(file => {
            file._relativePath = path + file.name;
            allFiles.push(file);
            resolve();
          }, () => resolve());
        } else if (entry.isDirectory) {
          const reader = entry.createReader();
          readAllEntries(reader).then(subEntries => {
            Promise.all(subEntries.map(e => readEntry(e, path + entry.name + '/'))).then(resolve);
          }, () => resolve());
        } else {
          resolve();
        }
      });
    }

    function readAllEntries(reader) {
      return new Promise((resolve) => {
        const entries = [];
        function readBatch() {
          reader.readEntries(batch => {
            if (batch.length === 0) resolve(entries);
            else { entries.push(...batch); readBatch(); }
          }, () => resolve(entries));
        }
        readBatch();
      });
    }

    return Promise.all(entries.map(e => readEntry(e, ''))).then(() => allFiles);
  }

  function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
    });
  }

  // ── Tab Switching ──
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`panel-${tab.dataset.tab}`).classList.add('active');
    });
  });

  // ── File Input Handling ──
  const fileInput = document.getElementById('file-input');

  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      processFiles(Array.from(e.target.files));
    }
  });

  async function processFiles(files) {
    try {
      // Store files in IndexedDB temporarily for cross-page transfer
      const dbRequest = indexedDB.open('runbits-transfer', 1);
      dbRequest.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('files')) {
          db.createObjectStore('files', { keyPath: 'id', autoIncrement: true });
        }
      };

      dbRequest.onsuccess = async (e) => {
        const db = e.target.result;
        const tx = db.transaction('files', 'readwrite');
        const store = tx.objectStore('files');

        // Clear old transfer data
        store.clear();

        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          const content = await readFileAsText(file);
          store.add({
            name: file.name,
            relativePath: file._relativePath || file.webkitRelativePath || file.name,
            content: content,
            mimeType: file.type || getMimeFromExt(file.name),
            size: file.size,
          });
        }

        tx.oncomplete = () => {
          db.close();
          window.location.href = 'workspace.html';
        };
        tx.onerror = () => {
          showToast('Failed to import files', 'error');
        };
      };
    } catch (err) {
      showToast('Import failed: ' + err.message, 'error');
    }
  }

  // ── Drop Zone ──
  const dropZone = document.getElementById('drop-zone');

  ['dragenter', 'dragover'].forEach(evt => {
    dropZone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.add('drag-over');
    });
  });

  ['dragleave', 'drop'].forEach(evt => {
    dropZone.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.remove('drag-over');
    });
  });

  dropZone.addEventListener('drop', (e) => {
    const items = e.dataTransfer.items;
    if (items) {
      const entries = [];
      for (let i = 0; i < items.length; i++) {
        const entry = items[i].webkitGetAsEntry?.();
        if (entry) entries.push(entry);
      }
      if (entries.length > 0) {
        resolveEntries(entries).then(files => {
          if (files.length > 0) processFiles(files);
        });
      }
    }
  });

  dropZone.addEventListener('click', () => {
    fileInput.click();
  });

  // ── Button Actions ──
  document.getElementById('btn-open-folder').addEventListener('click', () => {
    fileInput.click();
  });

  document.getElementById('btn-new-project').addEventListener('click', () => {
    window.location.href = 'workspace.html';
  });

  document.getElementById('btn-start').addEventListener('click', () => {
    window.location.href = 'workspace.html';
  });

  document.getElementById('btn-github').addEventListener('click', () => {
    window.open(GITHUB_URL, '_blank');
  });

  // ── Global Drag Overlay ──
  let dragCounter = 0;
  document.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragCounter++;
    if (dragCounter === 1) {
      dropZone.classList.add('drag-over');
      document.querySelector('.tab[data-tab="product"]').click();
    }
  });

  document.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dragCounter--;
    if (dragCounter === 0) {
      dropZone.classList.remove('drag-over');
    }
  });

  document.addEventListener('dragover', (e) => e.preventDefault());

  document.addEventListener('drop', (e) => {
    e.preventDefault();
    dragCounter = 0;
    dropZone.classList.remove('drag-over');
  });
})();
