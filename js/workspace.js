(() => {
  'use strict';

  const GITHUB_URL = 'https://github.com/huchialun9-ctrl/runbit.git';

  // ── Shared Utilities ──
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

  function getMimeFromExt(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    return MIME_MAP[ext] || 'application/octet-stream';
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
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
          entry.file(file => { file._relativePath = path + file.name; allFiles.push(file); resolve(); }, () => resolve());
        } else if (entry.isDirectory) {
          const reader = entry.createReader();
          readAllEntries(reader).then(sub => {
            Promise.all(sub.map(e => readEntry(e, path + entry.name + '/'))).then(resolve);
          }, () => resolve());
        } else resolve();
      });
    }
    function readAllEntries(reader) {
      return new Promise((resolve) => {
        const entries = [];
        function batch() { reader.readEntries(b => { if (b.length === 0) resolve(entries); else { entries.push(...b); batch(); } }, () => resolve(entries)); }
        batch();
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

  function getModeFromFilename(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const modes = {
      html: 'htmlmixed', htm: 'htmlmixed', css: 'css',
      js: 'javascript', mjs: 'javascript', json: 'application/json',
      xml: 'xml', md: 'markdown', svg: 'xml',
    };
    return modes[ext] || 'htmlmixed';
  }

  function getFileIcon(name) {
    if (typeof RBIcons === 'undefined') return '';
    const ext = name.split('.').pop().toLowerCase();
    const iconMap = {
      html: 'fileTypeHtml', htm: 'fileTypeHtml', css: 'fileTypeCss',
      js: 'fileTypeJs', mjs: 'fileTypeJs', json: 'fileTypeJson',
      svg: 'fileTypeSvg', png: 'fileTypeImg', jpg: 'fileTypeImg',
      jpeg: 'fileTypeImg', gif: 'fileTypeImg', webp: 'fileTypeImg',
      md: 'fileTypeMd', txt: 'fileTypeTxt', py: 'fileTypePy',
      ts: 'fileTypeJs', jsx: 'fileTypeJs', tsx: 'fileTypeJs',
    };
    return RBIcons.icon(iconMap[ext] || 'fileTypeDefault', 14);
  }

  // ── State ──
  const state = {
    projectId: null,
    projectName: 'Untitled Project',
    files: [],
    tree: null,
    openTabs: [],
    activeFileId: null,
    editor: null,
    swReady: false,
    consoleEntries: [],
    networkEntries: [],
    viewport: 'desktop',
    dirHandle: null,
    fileWatcherTimer: null,
  };

  // ── Init ──
  async function init() {
    await registerSW();
    setupUI();
    setupEditor();
    setupDragDrop();
    setupKeyboard();
    setupResize();
    setupPreviewConsole();
    setupModals();

    // Check for files from landing page (via IndexedDB)
    const transferredFiles = await getTransferredFiles();
    if (transferredFiles.length > 0) {
      await createProjectFromTransfer(transferredFiles);
    } else {
      await resumeLastProject();
    }
  }

  // ── Cross-page File Transfer ──
  function getTransferredFiles() {
    return new Promise((resolve) => {
      const req = indexedDB.open('runbits-transfer', 1);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('files')) {
          db.createObjectStore('files', { keyPath: 'id', autoIncrement: true });
        }
      };
      req.onsuccess = (e) => {
        const db = e.target.result;
        const tx = db.transaction('files', 'readwrite');
        const store = tx.objectStore('files');
        const getAll = store.getAll();
        getAll.onsuccess = () => {
          const files = getAll.result || [];
          // Clear after reading
          store.clear();
          db.close();
          resolve(files);
        };
        getAll.onerror = () => { db.close(); resolve([]); };
      };
      req.onerror = () => resolve([]);
    });
  }

  // ── Service Worker ──
  async function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    try {
      const reg = await navigator.serviceWorker.register('sw.js');
      await navigator.serviceWorker.ready;
      state.swReady = true;
      navigator.serviceWorker.addEventListener('message', (e) => {
        if (e.data?.type === 'console') addConsoleEntry(e.data.level, e.data.args);
      });
    } catch (err) {
      console.warn('SW registration failed:', err);
    }
  }

  function syncVFS() {
    if (!state.swReady || !navigator.serviceWorker.controller) return;
    navigator.serviceWorker.controller.postMessage({
      type: 'vfs-sync',
      files: state.files.map(f => ({ path: f.path, content: f.content, mimeType: f.mimeType })),
    });
  }

  function vfsUpdate(path, content, mimeType) {
    if (!state.swReady || !navigator.serviceWorker.controller) return;
    navigator.serviceWorker.controller.postMessage({ type: 'vfs-update', path, content, mimeType });
  }

  function vfsRemove(path) {
    if (!state.swReady || !navigator.serviceWorker.controller) return;
    navigator.serviceWorker.controller.postMessage({ type: 'vfs-remove', path });
  }

  // ── Project Management ──
  async function createProjectFromTransfer(transferredFiles) {
    const project = await RunbitsVFS.createProject('Imported Project');
    state.projectId = project.id;
    state.projectName = project.name;

    // Import files with pre-read content
    const filesForImport = transferredFiles.map(f => ({
      _relativePath: f.relativePath,
      _content: f.content,
      type: f.mimeType,
      size: f.size,
    }));

    const imported = await RunbitsVFS.importFiles(project.id, filesForImport);
    state.files = imported;
    state.tree = RunbitsVFS.buildTree(imported);

    document.getElementById('project-name').textContent = state.projectName;
    renderFileTree();
    syncVFS();
    saveLastProjectId(project.id);

    const indexFile = imported.find(f => f.path.endsWith('/index.html') || f.path === 'index.html');
    if (indexFile) openFile(indexFile.id);
    else if (imported.length > 0) openFile(imported[0].id);

    refreshPreview();
  }

  async function resumeLastProject() {
    const lastId = localStorage.getItem('runbits-last-project');
    if (!lastId) return;
    try {
      const project = await RunbitsVFS.getProject(lastId);
      if (!project) return;
      const files = await RunbitsVFS.getAllFiles(lastId);
      if (files.length === 0) return;

      state.projectId = project.id;
      state.projectName = project.name;
      state.files = files;
      state.tree = RunbitsVFS.buildTree(files);

      document.getElementById('project-name').textContent = state.projectName;
      renderFileTree();
      syncVFS();

      const indexFile = files.find(f => f.path.endsWith('/index.html') || f.path === 'index.html');
      if (indexFile) openFile(indexFile.id);
      else if (files.length > 0) openFile(files[0].id);

      refreshPreview();
    } catch {
      localStorage.removeItem('runbits-last-project');
    }
  }

  function saveLastProjectId(id) {
    localStorage.setItem('runbits-last-project', id);
  }

  // ── UI Setup ──
  function setupUI() {
    // Left panel tabs
    document.querySelectorAll('.left-panel-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.left-panel-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.left-panel-view').forEach(v => v.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(`view-${tab.dataset.view}`).classList.add('active');
      });
    });

    // Console tabs
    document.querySelectorAll('.console-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.console-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.console-view').forEach(v => v.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(`console-view-${tab.dataset.ctab}`).classList.add('active');
      });
    });

    // Viewport buttons
    document.querySelectorAll('.viewport-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.viewport-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('preview-wrapper').className = 'preview-frame-wrapper ' + btn.dataset.viewport;
        state.viewport = btn.dataset.viewport;
      });
    });

    // Top bar buttons
    document.getElementById('btn-home').addEventListener('click', () => window.location.href = 'index.html');
    document.getElementById('btn-open-folder').addEventListener('click', openLocalFolder);
    document.getElementById('btn-new-file').addEventListener('click', () => createNewFile());
    document.getElementById('btn-new-file-side').addEventListener('click', () => createNewFile());
    document.getElementById('btn-new-folder').addEventListener('click', createNewFolder);
    document.getElementById('btn-save').addEventListener('click', saveCurrentFile);
    document.getElementById('btn-run').addEventListener('click', refreshPreview);
    document.getElementById('btn-format').addEventListener('click', formatCode);
    document.getElementById('btn-refresh-preview').addEventListener('click', refreshPreview);
    document.getElementById('btn-qr').addEventListener('click', showQRCode);
    document.getElementById('btn-clear-console').addEventListener('click', clearConsole);
    document.getElementById('btn-github').addEventListener('click', () => window.open(GITHUB_URL, '_blank'));

    // Dev toolbox
    document.querySelectorAll('.devtool-btn').forEach(btn => {
      btn.addEventListener('click', () => openDevTool(btn.dataset.tool));
    });

    // File drop zone
    const dropZone = document.getElementById('file-drop-zone');
    ['dragenter', 'dragover'].forEach(evt => {
      dropZone.addEventListener(evt, (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
    });
    ['dragleave', 'drop'].forEach(evt => {
      dropZone.addEventListener(evt, (e) => { e.preventDefault(); dropZone.classList.remove('drag-over'); });
    });
    dropZone.addEventListener('drop', handleFileDrop);

    // File tree empty click
    document.getElementById('file-tree-empty').addEventListener('click', openLocalFolder);

    // Context menu
    document.addEventListener('click', hideContextMenu);
    document.querySelectorAll('.context-menu-item').forEach(item => {
      item.addEventListener('click', () => handleContextAction(item.dataset.action));
    });
  }

  // ── Modals ──
  function setupModals() {
    // Close modals on overlay click
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.classList.remove('active');
      });
    });

    document.getElementById('btn-close-qr').addEventListener('click', () => {
      document.getElementById('qr-modal').classList.remove('active');
    });
    document.getElementById('btn-close-devtool').addEventListener('click', () => {
      document.getElementById('devtool-modal').classList.remove('active');
    });
    document.getElementById('btn-copy-devtool').addEventListener('click', () => {
      const output = document.getElementById('devtool-output');
      navigator.clipboard.writeText(output.value).catch(() => {
        output.select();
        document.execCommand('copy');
        showToast('Copied to clipboard', 'success');
      });
      showToast('Copied to clipboard', 'success');
    });
    document.getElementById('devtool-action').addEventListener('click', processDevTool);
  }

  // ── Editor Setup ──
  function setupEditor() {
    if (typeof CodeMirror === 'undefined') {
      showToast('CodeMirror failed to load. Check your internet connection.', 'error');
      return;
    }

    const container = document.getElementById('editor-container');
    state.editor = CodeMirror(container, {
      value: '',
      mode: 'htmlmixed',
      theme: 'material-darker',
      lineNumbers: true,
      lineWrapping: false,
      autoCloseTags: true,
      autoCloseBrackets: true,
      foldGutter: true,
      gutters: ['CodeMirror-linenumbers', 'CodeMirror-foldgutter'],
      styleActiveLine: true,
      indentUnit: 2,
      tabSize: 2,
      indentWithTabs: false,
      matchBrackets: true,
      extraKeys: {
        'Ctrl-S': () => saveCurrentFile(),
        'Cmd-S': () => saveCurrentFile(),
        'Ctrl-Enter': () => refreshPreview(),
        'Cmd-Enter': () => refreshPreview(),
        'Shift-Alt-F': () => formatCode(),
        'Ctrl-/': (cm) => cm.execCommand('toggleComment'),
        'Cmd-/': (cm) => cm.execCommand('toggleComment'),
      },
    });

    state.editor.setSize('100%', '100%');
    state.editor.on('change', debounce(() => {
      if (state.activeFileId) {
        const file = state.files.find(f => f.id === state.activeFileId);
        if (file) {
          file.content = state.editor.getValue();
          vfsUpdate(file.path, file.content, file.mimeType);
          syncVFS();
        }
      }
    }, 300));

    // Hide editor initially
    const cm = container.querySelector('.CodeMirror');
    if (cm) cm.style.display = 'none';
  }

  // ── File Operations ──
  async function createNewFile(name) {
    if (!name) {
      name = prompt('File name (e.g., index.html):');
      if (!name) return;
    }
    if (!state.projectId) {
      const project = await RunbitsVFS.createProject('New Project');
      state.projectId = project.id;
      state.projectName = project.name;
      document.getElementById('project-name').textContent = state.projectName;
      saveLastProjectId(project.id);
    }

    try {
      const file = await RunbitsVFS.addFile(state.projectId, name, '', getMimeFromExt(name));
      state.files.push(file);
      state.tree = RunbitsVFS.buildTree(state.files);
      renderFileTree();
      syncVFS();
      openFile(file.id);
    } catch (err) {
      showToast('Failed to create file: ' + err.message, 'error');
    }
  }

  async function createNewFolder() {
    const name = prompt('Folder name:');
    if (!name) return;
    await createNewFile(name + '/.gitkeep');
  }

  async function deleteFileById(fileId) {
    const file = state.files.find(f => f.id === fileId);
    if (!file) return;
    if (!confirm(`Delete "${file.name}"?`)) return;

    try {
      await RunbitsVFS.deleteFile(fileId);
      state.files = state.files.filter(f => f.id !== fileId);
      state.tree = RunbitsVFS.buildTree(state.files);
      renderFileTree();
      vfsRemove(file.path);
      syncVFS();
      closeTab(fileId);
    } catch (err) {
      showToast('Failed to delete: ' + err.message, 'error');
    }
  }

  async function renameFileById(fileId) {
    const file = state.files.find(f => f.id === fileId);
    if (!file) return;
    const newName = prompt('New name:', file.name);
    if (!newName || newName === file.name) return;

    try {
      const dir = file.path.substring(0, file.path.lastIndexOf('/'));
      const newPath = dir ? dir + '/' + newName : '/' + newName;
      await RunbitsVFS.renameFile(fileId, newPath);
      const oldPath = file.path;
      Object.assign(file, { path: newPath, name: newName, mimeType: getMimeFromExt(newName) });
      state.tree = RunbitsVFS.buildTree(state.files);
      renderFileTree();
      vfsRemove(oldPath);
      vfsUpdate(newPath, file.content, file.mimeType);
      syncVFS();
      updateEditorTabs();
    } catch (err) {
      showToast('Failed to rename: ' + err.message, 'error');
    }
  }

  // ── Tab Management ──
  function openFile(fileId) {
    const file = state.files.find(f => f.id === fileId);
    if (!file) return;

    if (!state.openTabs.includes(fileId)) state.openTabs.push(fileId);
    state.activeFileId = fileId;

    state.editor.setValue(file.content || '');
    state.editor.setOption('mode', getModeFromFilename(file.name));

    const cm = document.getElementById('editor-container').querySelector('.CodeMirror');
    if (cm) cm.style.display = '';
    document.getElementById('editor-empty').style.display = 'none';

    state.editor.refresh();
    updateEditorTabs();
    highlightActiveFile();
  }

  function closeTab(fileId) {
    state.openTabs = state.openTabs.filter(id => id !== fileId);
    if (state.activeFileId === fileId) {
      if (state.openTabs.length > 0) {
        openFile(state.openTabs[state.openTabs.length - 1]);
      } else {
        state.activeFileId = null;
        state.editor.setValue('');
        const cm = document.getElementById('editor-container').querySelector('.CodeMirror');
        if (cm) cm.style.display = 'none';
        document.getElementById('editor-empty').style.display = '';
      }
    }
    updateEditorTabs();
  }

  function updateEditorTabs() {
    const container = document.getElementById('editor-tabs');
    container.innerHTML = '';
    state.openTabs.forEach(fileId => {
      const file = state.files.find(f => f.id === fileId);
      if (!file) return;
      const tab = document.createElement('div');
      tab.className = 'editor-tab' + (fileId === state.activeFileId ? ' active' : '');
      tab.innerHTML = `<span>${file.name}</span><span class="close" data-id="${fileId}">&times;</span>`;
      tab.addEventListener('click', (e) => {
        if (e.target.classList.contains('close')) closeTab(e.target.dataset.id);
        else openFile(fileId);
      });
      container.appendChild(tab);
    });
  }

  // ── File Tree ──
  function renderFileTree() {
    const treeEl = document.getElementById('file-tree');
    const emptyEl = document.getElementById('file-tree-empty');
    if (!state.tree || state.files.length === 0) {
      treeEl.innerHTML = '';
      treeEl.appendChild(emptyEl);
      emptyEl.style.display = '';
      return;
    }
    emptyEl.style.display = 'none';
    treeEl.innerHTML = '';
    renderTreeLevel(state.tree, treeEl, 0);
  }

  function renderTreeLevel(node, container, depth) {
    const entries = Object.values(node.children);
    entries.sort((a, b) => {
      if (a.type === b.type) return a.name.localeCompare(b.name);
      return a.type === 'dir' ? -1 : 1;
    });

    entries.forEach(entry => {
      const item = document.createElement('div');
      item.className = `tree-item ${entry.type}`;
      item.style.paddingLeft = (8 + depth * 14) + 'px';

      if (entry.type === 'dir') {
        const arrowSvg = RBIcons.icon('chevronRight', 10);
        const folderSvg = RBIcons.icon('folder', 14);
        item.innerHTML = `<span class="icon arrow">${arrowSvg}</span><span class="icon">${folderSvg}</span><span class="name">${entry.name}</span>`;
        const children = document.createElement('div');
        children.className = 'tree-children';
        children.style.display = 'none';
        item.addEventListener('click', (e) => {
          e.stopPropagation();
          const arrow = item.querySelector('.arrow');
          const isOpen = children.style.display !== 'none';
          children.style.display = isOpen ? 'none' : 'block';
          arrow.classList.toggle('open', !isOpen);
        });
        container.appendChild(item);
        container.appendChild(children);
        renderTreeLevel(entry, children, depth + 1);
      } else {
        item.innerHTML = `<span class="icon">${getFileIcon(entry.name)}</span><span class="name">${entry.name}</span>`;
        item.dataset.fileId = entry.id;
        if (entry.id === state.activeFileId) item.classList.add('active');
        item.addEventListener('click', (e) => { e.stopPropagation(); openFile(entry.id); });

        // Right-click context menu
        item.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          e.stopPropagation();
          contextTarget = { type: 'file', id: entry.id };
          showContextMenu(e);
        });

        container.appendChild(item);
      }
    });
  }

  function highlightActiveFile() {
    document.querySelectorAll('.tree-item.file').forEach(item => {
      item.classList.toggle('active', item.dataset.fileId === state.activeFileId);
    });
  }

  // ── Local Folder (File System Access API) ──
  async function openLocalFolder() {
    if ('showDirectoryPicker' in window) {
      try {
        const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
        state.dirHandle = dirHandle;
        await loadFromDirHandle(dirHandle);
      } catch (err) {
        if (err.name !== 'AbortError') showToast('Failed: ' + err.message, 'error');
      }
    } else {
      document.getElementById('folder-input').click();
    }
  }

  async function loadFromDirHandle(dirHandle) {
    const project = await RunbitsVFS.createProject(dirHandle.name);
    state.projectId = project.id;
    state.projectName = project.name;

    const files = [];
    await readDirRecursive(dirHandle, '', files);

    const fileObjects = [];
    for (const f of files) {
      const content = await f.handle.text();
      fileObjects.push({ _relativePath: f.path, _content: content, type: getMimeFromExt(f.path), size: 0 });
    }

    const imported = await RunbitsVFS.importFiles(project.id, fileObjects);
    state.files = imported;
    state.tree = RunbitsVFS.buildTree(imported);

    document.getElementById('project-name').textContent = state.projectName;
    renderFileTree();
    syncVFS();
    saveLastProjectId(project.id);

    const indexFile = imported.find(f => f.path.endsWith('/index.html') || f.path === 'index.html');
    if (indexFile) openFile(indexFile.id);
    else if (imported.length > 0) openFile(imported[0].id);

    refreshPreview();
    showToast(`Loaded ${imported.length} files from "${dirHandle.name}"`, 'success');
    startFileWatcher(dirHandle);
  }

  async function readDirRecursive(dirHandle, prefix, results) {
    for await (const [name, handle] of dirHandle) {
      if (name.startsWith('.')) continue; // skip hidden
      const path = prefix ? `${prefix}/${name}` : name;
      if (handle.kind === 'file') {
        results.push({ path, handle });
      } else if (handle.kind === 'directory') {
        await readDirRecursive(handle, path, results);
      }
    }
  }

  function startFileWatcher(dirHandle) {
    if (state.fileWatcherTimer) clearInterval(state.fileWatcherTimer);

    state.fileWatcherTimer = setInterval(async () => {
      if (!state.dirHandle) return;
      try {
        const diskFiles = [];
        await readDirRecursive(state.dirHandle, '', diskFiles);

        const diskPaths = new Set(diskFiles.map(f => '/' + f.path));

        // Check for modified files
        for (const f of diskFiles) {
          const existing = state.files.find(sf => sf.path === '/' + f.path);
          if (existing) {
            const newContent = await f.handle.text();
            if (newContent !== existing.content) {
              existing.content = newContent;
              existing.updatedAt = Date.now();
              await RunbitsVFS.updateFile(existing.id, newContent);
              vfsUpdate(existing.path, newContent, existing.mimeType);
              syncVFS();
              if (existing.id === state.activeFileId) {
                const cursor = state.editor.getCursor();
                state.editor.setValue(newContent);
                state.editor.setCursor(cursor);
              }
              refreshPreview();
            }
          } else {
            // New file on disk
            const content = await f.handle.text();
            const newFile = await RunbitsVFS.addFile(state.projectId, f.path, content, getMimeFromExt(f.path));
            state.files.push(newFile);
            vfsUpdate(newFile.path, content, newFile.mimeType);
          }
        }

        // Check for deleted files (FIX: compare normalized paths correctly)
        const deleted = state.files.filter(f => !diskPaths.has(f.path));
        for (const f of deleted) {
          await RunbitsVFS.deleteFile(f.id);
          vfsRemove(f.path);
          closeTab(f.id);
        }
        if (deleted.length > 0) {
          state.files = state.files.filter(f => diskPaths.has(f.path));
          state.tree = RunbitsVFS.buildTree(state.files);
          renderFileTree();
          syncVFS();
        }
      } catch (err) {
        // Ignore polling errors
      }
    }, 1500);
  }

  document.getElementById('folder-input').addEventListener('change', async (e) => {
    const files = Array.from(e.target.files);
    if (files.length > 0) {
      const fileObjects = [];
      for (const f of files) {
        const path = f.webkitRelativePath || f.name;
        const content = await readFileAsText(f);
        fileObjects.push({ _relativePath: path, _content: content, type: f.type || getMimeFromExt(path), size: f.size });
      }
      const project = await RunbitsVFS.createProject('Imported Project');
      state.projectId = project.id;
      state.projectName = project.name;
      const imported = await RunbitsVFS.importFiles(project.id, fileObjects);
      state.files = imported;
      state.tree = RunbitsVFS.buildTree(imported);
      document.getElementById('project-name').textContent = state.projectName;
      renderFileTree();
      syncVFS();
      saveLastProjectId(project.id);
      const indexFile = imported.find(f => f.path.endsWith('/index.html'));
      if (indexFile) openFile(indexFile.id);
      else if (imported.length > 0) openFile(imported[0].id);
      refreshPreview();
    }
  });

  // ── Drag & Drop ──
  function setupDragDrop() {
    let dragCounter = 0;
    document.addEventListener('dragenter', (e) => { e.preventDefault(); dragCounter++; });
    document.addEventListener('dragleave', (e) => { e.preventDefault(); dragCounter--; });
    document.addEventListener('dragover', (e) => e.preventDefault());
    document.addEventListener('drop', async (e) => {
      e.preventDefault();
      dragCounter = 0;
      const items = e.dataTransfer.items;
      if (!items) return;
      const entries = [];
      for (let i = 0; i < items.length; i++) {
        const entry = items[i].webkitGetAsEntry?.();
        if (entry) entries.push(entry);
      }
      if (entries.length === 0) return;

      const files = await resolveEntries(entries);
      if (files.length === 0) return;

      if (!state.projectId) {
        const project = await RunbitsVFS.createProject('Dropped Project');
        state.projectId = project.id;
        state.projectName = project.name;
        document.getElementById('project-name').textContent = state.projectName;
        saveLastProjectId(project.id);
      }

      for (const f of files) {
        const path = f._relativePath || f.webkitRelativePath || f.name;
        const content = await readFileAsText(f);
        const file = await RunbitsVFS.addFile(state.projectId, path, content, getMimeFromExt(path));
        state.files.push(file);
        vfsUpdate(file.path, content, file.mimeType);
      }
      state.tree = RunbitsVFS.buildTree(state.files);
      renderFileTree();
      syncVFS();
      refreshPreview();
      showToast(`Added ${files.length} files`, 'success');
    });
  }

  function handleFileDrop(e) {
    const items = e.dataTransfer.items;
    if (!items || !state.projectId) return;
    const entries = [];
    for (let i = 0; i < items.length; i++) {
      const entry = items[i].webkitGetAsEntry?.();
      if (entry) entries.push(entry);
    }
    resolveEntries(entries).then(async (files) => {
      for (const f of files) {
        const path = f._relativePath || f.webkitRelativePath || f.name;
        const content = await readFileAsText(f);
        const file = await RunbitsVFS.addFile(state.projectId, path, content, getMimeFromExt(path));
        state.files.push(file);
        vfsUpdate(file.path, content, file.mimeType);
      }
      state.tree = RunbitsVFS.buildTree(state.files);
      renderFileTree();
      syncVFS();
      refreshPreview();
    });
  }

  // ── Save & Format ──
  async function saveCurrentFile() {
    if (!state.activeFileId) return;
    const file = state.files.find(f => f.id === state.activeFileId);
    if (!file) return;
    const content = state.editor.getValue();
    file.content = content;
    file.updatedAt = Date.now();
    file.size = new Blob([content]).size;
    await RunbitsVFS.updateFile(file.id, content);
    vfsUpdate(file.path, content, file.mimeType);
    syncVFS();
    refreshPreview();
    showToast('Saved', 'success');
  }

  function formatCode() {
    if (!state.activeFileId) return;
    const file = state.files.find(f => f.id === state.activeFileId);
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    if (ext === 'json') {
      try {
        state.editor.setValue(JSON.stringify(JSON.parse(state.editor.getValue()), null, 2));
        showToast('JSON formatted', 'success');
      } catch { showToast('Invalid JSON', 'error'); }
    } else {
      showToast('Auto-format available for JSON only', 'info');
    }
  }

  // ── Preview ──
  function refreshPreview() {
    const indexFile = state.files.find(f => f.path.endsWith('/index.html') || f.path === 'index.html');
    if (!indexFile) {
      document.getElementById('preview-loading').style.display = '';
      document.getElementById('preview-iframe').src = 'about:blank';
      document.getElementById('preview-url').textContent = 'about:blank';
      return;
    }
    document.getElementById('preview-loading').style.display = 'none';
    const iframe = document.getElementById('preview-iframe');
    // Use unique timestamp to force reload
    iframe.src = indexFile.path + '?_t=' + Date.now();
    document.getElementById('preview-url').textContent = indexFile.path;
  }

  // ── Console/Network Interception ──
  function setupPreviewConsole() {
    const iframe = document.getElementById('preview-iframe');

    function injectInterceptor() {
      try {
        const doc = iframe.contentDocument || iframe.contentWindow?.document;
        if (!doc) return;
        const script = doc.createElement('script');
        script.textContent = `(function(){
          ['log','error','warn','info','debug'].forEach(function(level){
            var orig = console[level];
            console[level] = function(){
              orig.apply(console, arguments);
              try{window.parent.postMessage({type:'console',level:level,args:Array.from(arguments).map(function(a){try{return typeof a==='object'?JSON.stringify(a,null,2):String(a)}catch(e){return String(a)}})},'*')}catch(e){}
            };
          });
          window.onerror=function(m,s,l,c,e){try{window.parent.postMessage({type:'console',level:'error',args:[m+' (line '+l+')']},'*')}catch(e){}};
          var of=window.fetch;window.fetch=function(){window.parent.postMessage({type:'network',method:(arguments[1]&&arguments[1].method)||'GET',url:typeof arguments[0]==='string'?arguments[0]:arguments[0].url},'*');return of.apply(this,arguments)};
          var ox=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){window.parent.postMessage({type:'network',method:m,url:u},'*');return ox.apply(this,arguments)};
        })();`;
        doc.head.appendChild(script);
      } catch { /* cross-origin */ }
    }

    iframe.addEventListener('load', injectInterceptor);

    window.addEventListener('message', (e) => {
      if (e.data?.type === 'console') addConsoleEntry(e.data.level, e.data.args);
      else if (e.data?.type === 'network') addNetworkEntry(e.data.method, e.data.url);
    });
  }

  function addConsoleEntry(level, args) {
    const entry = { level, args: Array.isArray(args) ? args : [String(args)], time: new Date().toLocaleTimeString() };
    state.consoleEntries.push(entry);
    const container = document.getElementById('console-view-console');
    const el = document.createElement('div');
    el.className = `console-entry ${level}`;
    const icons = {
      log: RBIcons.icon('consoleLog', 12),
      error: RBIcons.icon('consoleError', 12),
      warn: RBIcons.icon('consoleWarn', 12),
      info: RBIcons.icon('consoleInfo', 12),
      debug: RBIcons.icon('terminal', 12),
    };
    el.innerHTML = `<span class="console-entry-icon">${icons[level] || RBIcons.icon('consoleLog', 12)}</span><span class="console-entry-content">${escapeHtml(entry.args.join(' '))}</span><span class="console-entry-time">${entry.time}</span>`;
    container.appendChild(el);
    container.scrollTop = container.scrollHeight;
    document.getElementById('console-count').textContent = state.consoleEntries.length;
  }

  function addNetworkEntry(method, url) {
    state.networkEntries.push({ method: method || 'GET', url: url || '', time: new Date().toLocaleTimeString() });
    const container = document.getElementById('console-view-network');
    const el = document.createElement('div');
    el.className = 'network-entry';
    const ext = (url || '').split('.').pop().split('?')[0].toLowerCase();
    const type = { html: 'document', css: 'stylesheet', js: 'script', json: 'fetch', png: 'image', jpg: 'image', svg: 'image' }[ext] || 'other';
    el.innerHTML = `<span class="network-method">${method || 'GET'}</span><span class="network-url" title="${escapeHtml(url || '')}">${escapeHtml(url || '')}</span><span class="network-status ok">200</span><span class="network-type">${type}</span>`;
    container.appendChild(el);
    container.scrollTop = container.scrollHeight;
    document.getElementById('network-count').textContent = state.networkEntries.length;
  }

  function clearConsole() {
    state.consoleEntries = [];
    state.networkEntries = [];
    document.getElementById('console-view-console').innerHTML = '';
    document.getElementById('console-view-network').innerHTML = '';
    document.getElementById('console-count').textContent = '0';
    document.getElementById('network-count').textContent = '0';
  }

  // ── QR Code (Server-backed) ──
  async function showQRCode() {
    const modal = document.getElementById('qr-modal');
    modal.classList.add('active');
    const previewUrl = window.location.origin + '/preview/' + (state.projectId || '') + '/index.html';
    document.getElementById('qr-url').textContent = previewUrl;

    const canvas = document.getElementById('qr-canvas');
    try {
      const resp = await fetch(`/api/qr?text=${encodeURIComponent(previewUrl)}&size=200`);
      const data = await resp.json();
      if (data.dataUrl) {
        const img = canvas.getContext('2d');
        const image = new Image();
        image.onload = () => {
          canvas.width = 200;
          canvas.height = 200;
          img.drawImage(image, 0, 0, 200, 200);
        };
        image.src = data.dataUrl;
      }
    } catch {
      // Fallback: draw placeholder
      const ctx = canvas.getContext('2d');
      canvas.width = 200;
      canvas.height = 200;
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(0, 0, 200, 200);
      ctx.fillStyle = '#666';
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('QR Code', 100, 100);
      ctx.fillText('(server required)', 100, 120);
    }
  }

  // ── Dev Tools ──
  let currentDevTool = null;

  function openDevTool(tool) {
    currentDevTool = tool;
    document.getElementById('devtool-modal').classList.add('active');
    const titles = {
      'json': 'JSON Formatter', 'base64-enc': 'Base64 Encoder',
      'base64-dec': 'Base64 Decoder', 'url-enc': 'URL Encoder',
      'url-dec': 'URL Decoder', 'jwt': 'JWT Token Parser',
      'timestamp': 'Timestamp Converter', 'hash': 'SHA-256 Hash',
    };
    document.getElementById('devtool-title').textContent = titles[tool] || 'Tool';
    document.getElementById('devtool-input').value = '';
    document.getElementById('devtool-output').value = '';
    if (state.activeFileId && state.editor?.getSelection()) {
      document.getElementById('devtool-input').value = state.editor.getSelection();
    }
  }

  async function processDevTool() {
    const input = document.getElementById('devtool-input').value;
    const output = document.getElementById('devtool-output');
    try {
      switch (currentDevTool) {
        case 'json': output.value = JSON.stringify(JSON.parse(input), null, 2); break;
        case 'base64-enc': output.value = btoa(unescape(encodeURIComponent(input))); break;
        case 'base64-dec': output.value = decodeURIComponent(escape(atob(input))); break;
        case 'url-enc': output.value = encodeURIComponent(input); break;
        case 'url-dec': output.value = decodeURIComponent(input); break;
        case 'jwt': output.value = parseJWT(input); break;
        case 'timestamp': output.value = formatTimestamp(input); break;
        case 'hash': {
          const data = new TextEncoder().encode(input);
          const hashBuffer = await crypto.subtle.digest('SHA-256', data);
          output.value = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
          break;
        }
      }
    } catch (err) { output.value = 'Error: ' + err.message; }
  }

  function parseJWT(token) {
    const parts = token.trim().split('.');
    if (parts.length !== 3) throw new Error('Invalid JWT - expected 3 parts');
    return JSON.stringify({
      header: JSON.parse(atob(parts[0])),
      payload: JSON.parse(atob(parts[1])),
    }, null, 2);
  }

  function formatTimestamp(input) {
    const num = parseInt(input);
    if (isNaN(num)) throw new Error('Invalid timestamp');
    const date = new Date(num > 1e12 ? num : num * 1000);
    return JSON.stringify({ iso: date.toISOString(), local: date.toLocaleString(), utc: date.toUTCString(), unix: Math.floor(date.getTime() / 1000) }, null, 2);
  }

  // ── Context Menu ──
  let contextTarget = null;

  function showContextMenu(e) {
    const menu = document.getElementById('context-menu');
    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';
    menu.classList.add('visible');
  }

  function hideContextMenu() {
    document.getElementById('context-menu').classList.remove('visible');
  }

  function handleContextAction(action) {
    if (!contextTarget) return;
    switch (action) {
      case 'new-file': createNewFile(); break;
      case 'new-folder': createNewFolder(); break;
      case 'rename': if (contextTarget.type === 'file') renameFileById(contextTarget.id); break;
      case 'delete': if (contextTarget.type === 'file') deleteFileById(contextTarget.id); break;
    }
    hideContextMenu();
  }

  // ── Keyboard Shortcuts ──
  function setupKeyboard() {
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveCurrentFile(); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); refreshPreview(); }
      if (e.key === 'Escape') {
        document.querySelectorAll('.modal-overlay.active').forEach(m => m.classList.remove('active'));
        hideContextMenu();
      }
    });
  }

  // ── Resize ──
  function setupResize() {
    setupHorizontalResize('resize-left', 'left-panel', 'left');
    setupHorizontalResize('resize-right', 'right-panel', 'right');
    setupVerticalResize('resize-console', 'console-panel');
  }

  function setupHorizontalResize(handleId, panelId, side) {
    const handle = document.getElementById(handleId);
    const panel = document.getElementById(panelId);
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = panel.offsetWidth;
      handle.style.userSelect = 'none';
      function onMove(e) {
        const diff = side === 'left' ? e.clientX - startX : startX - e.clientX;
        panel.style.width = Math.max(180, Math.min(500, startWidth + diff)) + 'px';
        state.editor?.refresh();
      }
      function onUp() {
        handle.style.userSelect = '';
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  function setupVerticalResize(handleId, panelId) {
    const handle = document.getElementById(handleId);
    const panel = document.getElementById(panelId);
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const startY = e.clientY;
      const startHeight = panel.offsetHeight;
      handle.style.userSelect = 'none';
      function onMove(e) {
        panel.style.height = Math.max(80, Math.min(500, startHeight + (startY - e.clientY))) + 'px';
        state.editor?.refresh();
      }
      function onUp() {
        handle.style.userSelect = '';
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  // ── Utilities ──
  function debounce(fn, delay) {
    let timer;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  // ── Start ──
  init();
})();
