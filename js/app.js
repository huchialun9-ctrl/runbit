(() => {
  'use strict';

  // ── Tab Switching ──
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`panel-${tab.dataset.tab}`).classList.add('active');
    });
  });

  // ── Toast Notifications ──
  function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  }

  // ── File Input Handling ──
  const fileInput = document.getElementById('file-input');
  const htmlInput = document.getElementById('html-input');

  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      processFiles(Array.from(e.target.files));
    }
  });

  htmlInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      processFiles(Array.from(e.target.files));
    }
  });

  function processFiles(files) {
    const fileData = files.map(f => ({
      name: f.name,
      size: f.size,
      type: f.type || getMimeFromExt(f.name),
      relativePath: f.webkitRelativePath || f.name,
    }));

    sessionStorage.setItem('runbits-imported-files', JSON.stringify(fileData));

    const dataTransfer = { files: files };
    sessionStorage.setItem('runbits-raw-file-count', files.length.toString());

    window._pendingFiles = files;
    window.location.href = 'workspace.html';
  }

  function getMimeFromExt(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const map = {
      html: 'text/html', htm: 'text/html',
      css: 'text/css', js: 'application/javascript',
      json: 'application/json', svg: 'image/svg+xml',
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
      gif: 'image/gif', webp: 'image/webp', ico: 'image/x-icon',
      woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf',
    };
    return map[ext] || 'application/octet-stream';
  }

  // ── Drag and Drop on Landing Page ──
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

  // ── Resolve Directory Entries ──
  function resolveEntries(entries) {
    const allFiles = [];
    const pending = [];

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
          readAllEntries(reader).then(entries => {
            const promises = entries.map(e => readEntry(e, path + entry.name + '/'));
            Promise.all(promises).then(resolve);
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
            if (batch.length === 0) {
              resolve(entries);
            } else {
              entries.push(...batch);
              readBatch();
            }
          }, () => resolve(entries));
        }
        readBatch();
      });
    }

    const promises = entries.map(e => readEntry(e, ''));
    return Promise.all(promises).then(() => allFiles);
  }

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

  document.addEventListener('dragover', (e) => {
    e.preventDefault();
  });

  document.addEventListener('drop', (e) => {
    e.preventDefault();
    dragCounter = 0;
    dropZone.classList.remove('drag-over');
  });
})();
