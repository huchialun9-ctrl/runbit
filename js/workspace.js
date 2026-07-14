(() => {
  'use strict';

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
    watchers: [],
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

    // Check if we have files from landing page
    const pendingFiles = window._pendingFiles;
    if (pendingFiles && pendingFiles.length > 0) {
      await createProjectFromFiles(pendingFiles);
    } else {
      // Try to resume last project
      await resumeLastProject();
    }
  }

  // ── Service Worker ──
  async function registerSW() {
    if ('serviceWorker' in navigator) {
      try {
        const reg = await navigator.serviceWorker.register('sw.js');
        await navigator.serviceWorker.ready;
        state.swReady = true;
        // Listen for SW messages
        navigator.serviceWorker.addEventListener('message', (e) => {
          if (e.data.type === 'console') {
            addConsoleEntry(e.data.level, e.data.args);
          }
        });
      } catch (err) {
        console.warn('SW registration failed:', err);
      }
    }
  }

  function syncVFS() {
    if (!state.swReady || !navigator.serviceWorker.controller) return;
    const files = state.files.map(f => ({
      path: f.path,
      content: f.content,
      mimeType: f.mimeType,
    }));
    navigator.serviceWorker.controller.postMessage({ type: 'vfs-sync', files });
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
  async function createProjectFromFiles(fileObjects) {
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

    // Auto-open index.html
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
    // Tab switching (left panel)
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
        const wrapper = document.getElementById('preview-wrapper');
        wrapper.className = 'preview-frame-wrapper ' + btn.dataset.viewport;
        state.viewport = btn.dataset.viewport;
      });
    });

    // Top bar buttons
    document.getElementById('btn-home').addEventListener('click', () => {
      window.location.href = 'index.html';
    });

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

    // QR modal
    document.getElementById('btn-close-qr').addEventListener('click', () => {
      document.getElementById('qr-modal').classList.remove('active');
    });

    // Devtool modal
    document.getElementById('btn-close-devtool').addEventListener('click', () => {
      document.getElementById('devtool-modal').classList.remove('active');
    });
    document.getElementById('btn-copy-devtool').addEventListener('click', () => {
      const output = document.getElementById('devtool-output');
      navigator.clipboard.writeText(output.value);
      showToast('Copied to clipboard', 'success');
    });
    document.getElementById('devtool-action').addEventListener('click', processDevTool);

    // Dev toolbox buttons
    document.querySelectorAll('.devtool-btn').forEach(btn => {
      btn.addEventListener('click', () => openDevTool(btn.dataset.tool));
    });

    // Context menu
    document.addEventListener('click', hideContextMenu);
    document.addEventListener('contextmenu', (e) => {
      if (e.target.closest('.file-tree')) {
        e.preventDefault();
        showContextMenu(e);
      }
    });

    document.querySelectorAll('.context-menu-item').forEach(item => {
      item.addEventListener('click', () => {
        handleContextAction(item.dataset.action);
      });
    });

    // File drop zone
    const dropZone = document.getElementById('file-drop-zone');
    ['dragenter', 'dragover'].forEach(evt => {
      dropZone.addEventListener(evt, (e) => {
        e.preventDefault();
        dropZone.classList.add('drag-over');
      });
    });
    ['dragleave', 'drop'].forEach(evt => {
      dropZone.addEventListener(evt, (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
      });
    });
    dropZone.addEventListener('drop', handleFileDrop);

    // File tree empty click
    document.getElementById('file-tree-empty').addEventListener('click', openLocalFolder);
  }

  // ── Editor Setup ──
  function setupEditor() {
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
    state.editor.on('change', () => {
      if (state.activeFileId) {
        const file = state.files.find(f => f.id === state.activeFileId);
        if (file) {
          file.content = state.editor.getValue();
          vfsUpdate(file.path, file.content, file.mimeType);
        }
      }
    });

    // Hide editor initially
    container.querySelector('.CodeMirror').style.display = 'none';
  }

  function getModeFromFilename(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const modes = {
      html: 'htmlmixed', htm: 'htmlmixed',
      css: 'css', js: 'javascript', mjs: 'javascript',
      json: 'application/json', xml: 'xml',
      md: 'markdown', markdown: 'markdown',
      ts: 'text/typescript', tsx: 'jsx',
      jsx: 'jsx', py: 'python',
      sql: 'text/x-sql', sh: 'text/x-sh',
      yaml: 'yaml', yml: 'yaml',
      svg: 'xml',
    };
    return modes[ext] || 'htmlmixed';
  }

  // ── File Operations ──
  async function createNewFile(name, parentId) {
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

    const path = parentId ? `${parentId}/${name}` : name;
    const file = await RunbitsVFS.addFile(state.projectId, path, '', RunbitsVFS.getMime(name));
    state.files.push(file);
    state.tree = RunbitsVFS.buildTree(state.files);
    renderFileTree();
    syncVFS();
    openFile(file.id);
  }

  async function createNewFolder() {
    const name = prompt('Folder name:');
    if (!name) return;
    // Create a placeholder file inside the folder
    await createNewFile(name + '/.gitkeep');
  }

  async function deleteFileById(fileId) {
    const file = state.files.find(f => f.id === fileId);
    if (!file) return;

    if (!confirm(`Delete "${file.name}"?`)) return;

    await RunbitsVFS.deleteFile(fileId);
    state.files = state.files.filter(f => f.id !== fileId);
    state.tree = RunbitsVFS.buildTree(state.files);
    renderFileTree();
    vfsRemove(file.path);
    syncVFS();

    // Close tab if open
    closeTab(fileId);
  }

  async function renameFileById(fileId) {
    const file = state.files.find(f => f.id === fileId);
    if (!file) return;

    const newName = prompt('New name:', file.name);
    if (!newName || newName === file.name) return;

    const dir = file.path.substring(0, file.path.lastIndexOf('/'));
    const newPath = dir ? dir + '/' + newName : newName;

    await RunbitsVFS.renameFile(fileId, newPath);
    const oldPath = file.path;
    Object.assign(file, { path: newPath, name: newName, mimeType: RunbitsVFS.getMime(newName) });

    state.tree = RunbitsVFS.buildTree(state.files);
    renderFileTree();
    vfsRemove(oldPath);
    vfsUpdate(newPath, file.content, file.mimeType);
    syncVFS();
    updateEditorTabs();
  }

  // ── Tab Management ──
  function openFile(fileId) {
    const file = state.files.find(f => f.id === fileId);
    if (!file) return;

    if (!state.openTabs.includes(fileId)) {
      state.openTabs.push(fileId);
    }
    state.activeFileId = fileId;

    state.editor.setValue(file.content || '');
    state.editor.setOption('mode', getModeFromFilename(file.name));

    // Show editor, hide empty state
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
        if (e.target.classList.contains('close')) {
          closeTab(e.target.dataset.id);
        } else {
          openFile(fileId);
        }
      });

      container.appendChild(tab);
    });
  }

  // ── File Tree Rendering ──
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
        item.innerHTML = `<span class="icon arrow">&#9654;</span><span class="icon">&#128193;</span><span class="name">${entry.name}</span>`;
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
        const icon = getFileIcon(entry.name);
        item.innerHTML = `<span class="icon">${icon}</span><span class="name">${entry.name}</span>`;
        item.dataset.fileId = entry.id;

        if (entry.id === state.activeFileId) {
          item.classList.add('active');
        }

        item.addEventListener('click', (e) => {
          e.stopPropagation();
          openFile(entry.id);
        });

        container.appendChild(item);
      }
    });
  }

  function getFileIcon(name) {
    const ext = name.split('.').pop().toLowerCase();
    const icons = {
      html: '&#127760;', htm: '&#127760;',
      css: '&#127912;', js: '&#9889;', mjs: '&#9889;',
      json: '&#123;&#125;', svg: '&#127912;',
      png: '&#128247;', jpg: '&#128247;', jpeg: '&#128247;',
      gif: '&#128247;', webp: '&#128247;',
      md: '&#128221;', txt: '&#128196;',
      py: '&#128013;', ts: '&#128309;',
      woff: '&#127912;', woff2: '&#127912;', ttf: '&#127912;',
    };
    return icons[ext] || '&#128196;';
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
        if (err.name !== 'AbortError') {
          showToast('Failed to open folder: ' + err.message, 'error');
        }
      }
    } else {
      // Fallback: use hidden file input
      document.getElementById('folder-input').click();
    }
  }

  document.getElementById('folder-input').addEventListener('change', async (e) => {
    const files = Array.from(e.target.files);
    if (files.length > 0) {
      await createProjectFromFiles(files);
    }
  });

  async function loadFromDirHandle(dirHandle) {
    const project = await RunbitsVFS.createProject(dirHandle.name);
    state.projectId = project.id;
    state.projectName = project.name;

    const files = [];
    await readDirRecursive(dirHandle, '', files);

    const imported = [];
    for (const f of files) {
      const content = await f.handle.text();
      const file = await RunbitsVFS.addFile(project.id, f.path, content, RunbitsVFS.getMime(f.path));
      imported.push(file);
    }

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

    // Start watching for changes
    watchDirHandle(dirHandle);
  }

  async function readDirRecursive(dirHandle, prefix, results) {
    for await (const [name, handle] of dirHandle) {
      const path = prefix ? `${prefix}/${name}` : name;
      if (handle.kind === 'file') {
        results.push({ path, handle });
      } else if (handle.kind === 'directory') {
        await readDirRecursive(handle, path, results);
      }
    }
  }

  async function watchDirHandle(dirHandle) {
    // Polling-based watcher since there's no native FS watch API
    const pollInterval = 1000;
    let lastCheck = Date.now();

    async function poll() {
      if (!state.dirHandle) return;
      try {
        const files = [];
        await readDirRecursive(state.dirHandle, '', files);

        for (const f of files) {
          const file = state.files.find(sf => sf.path === '/' + f.path);
          const handle = f.handle;
          if (file) {
            const newContent = await handle.text();
            if (newContent !== file.content) {
              file.content = newContent;
              file.updatedAt = Date.now();
              await RunbitsVFS.updateFile(file.id, newContent);
              vfsUpdate(file.path, newContent, file.mimeType);
              syncVFS();

              if (file.id === state.activeFileId) {
                const cursor = state.editor.getCursor();
                state.editor.setValue(newContent);
                state.editor.setCursor(cursor);
              }
              refreshPreview();
            }
          } else {
            // New file
            const content = await handle.text();
            const newFile = await RunbitsVFS.addFile(state.projectId, f.path, content, RunbitsVFS.getMime(f.path));
            state.files.push(newFile);
            vfsUpdate(newFile.path, content, newFile.mimeType);
          }
        }

        // Check for deleted files
        const currentPaths = new Set(files.map(f => '/' + f.path));
        const deleted = state.files.filter(f => !currentPaths.has(f.path));
        for (const f of deleted) {
          await RunbitsVFS.deleteFile(f.id);
          state.files = state.files.filter(sf => sf.id !== f.id);
          vfsRemove(f.path);
          closeTab(f.id);
        }

        if (deleted.length > 0 || files.length !== state.files.length) {
          state.tree = RunbitsVFS.buildTree(state.files);
          renderFileTree();
          syncVFS();
        }
      } catch (err) {
        // Ignore polling errors
      }
      setTimeout(poll, pollInterval);
    }

    poll();
  }

  // ── Drag & Drop ──
  function setupDragDrop() {
    let dragCounter = 0;

    document.addEventListener('dragenter', (e) => {
      e.preventDefault();
      dragCounter++;
    });

    document.addEventListener('dragleave', (e) => {
      e.preventDefault();
      dragCounter--;
    });

    document.addEventListener('dragover', (e) => {
      e.preventDefault();
    });

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

      if (entries.length > 0) {
        const files = await resolveEntries(entries);
        if (files.length > 0) {
          if (!state.projectId) {
            await createProjectFromFiles(files);
          } else {
            // Add to existing project
            for (const f of files) {
              const path = f._relativePath || f.webkitRelativePath || f.name;
              const content = await readFileAsText(f);
              const file = await RunbitsVFS.addFile(state.projectId, path, content, RunbitsVFS.getMime(path));
              state.files.push(file);
              vfsUpdate(file.path, content, file.mimeType);
            }
            state.tree = RunbitsVFS.buildTree(state.files);
            renderFileTree();
            syncVFS();
            refreshPreview();
            showToast(`Added ${files.length} files`, 'success');
          }
        }
      }
    });
  }

  function handleFileDrop(e) {
    const items = e.dataTransfer.items;
    if (!items) return;

    const entries = [];
    for (let i = 0; i < items.length; i++) {
      const entry = items[i].webkitGetAsEntry?.();
      if (entry) entries.push(entry);
    }

    resolveEntries(entries).then(async (files) => {
      if (files.length > 0 && state.projectId) {
        for (const f of files) {
          const path = f._relativePath || f.webkitRelativePath || f.name;
          const content = await readFileAsText(f);
          const file = await RunbitsVFS.addFile(state.projectId, path, content, RunbitsVFS.getMime(path));
          state.files.push(file);
          vfsUpdate(file.path, content, file.mimeType);
        }
        state.tree = RunbitsVFS.buildTree(state.files);
        renderFileTree();
        syncVFS();
        refreshPreview();
      }
    });
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
            const promises = subEntries.map(e => readEntry(e, path + entry.name + '/'));
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

  // ── Save ──
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

  // ── Format Code ──
  function formatCode() {
    if (!state.activeFileId) return;
    const file = state.files.find(f => f.id === state.activeFileId);
    if (!file) return;

    const ext = file.name.split('.').pop().toLowerCase();
    if (ext === 'json') {
      try {
        const formatted = JSON.stringify(JSON.parse(state.editor.getValue()), null, 2);
        state.editor.setValue(formatted);
        showToast('JSON formatted', 'success');
      } catch {
        showToast('Invalid JSON', 'error');
      }
    } else {
      showToast('Auto-format available for JSON', 'info');
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
    const url = new URL(window.location.origin + indexFile.path);
    iframe.src = url.pathname;
    document.getElementById('preview-url').textContent = url.pathname;
  }

  // ── Preview Console Interception ──
  function setupPreviewConsole() {
    const iframe = document.getElementById('preview-iframe');

    // Inject console interceptor into preview
    function injectConsoleInterceptor() {
      try {
        const doc = iframe.contentDocument || iframe.contentWindow.document;
        if (!doc) return;

        const script = doc.createElement('script');
        script.textContent = `
          (function() {
            const origConsole = {};
            ['log','error','warn','info','debug'].forEach(level => {
              origConsole[level] = console[level];
              console[level] = function() {
                origConsole[level].apply(console, arguments);
                try {
                  window.parent.postMessage({
                    type: 'console',
                    level: level,
                    args: Array.from(arguments).map(a => {
                      try { return typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a); }
                      catch { return String(a); }
                    })
                  }, '*');
                } catch(e) {}
              };
            });

            window.addEventListener('error', function(e) {
              try {
                window.parent.postMessage({
                  type: 'console',
                  level: 'error',
                  args: [e.message + ' (line ' + e.lineno + ')']
                }, '*');
              } catch(e2) {}
            });

            // Intercept network requests
            const origFetch = window.fetch;
            window.fetch = function() {
              window.parent.postMessage({
                type: 'network',
                method: arguments[1]?.method || 'GET',
                url: typeof arguments[0] === 'string' ? arguments[0] : arguments[0].url
              }, '*');
              return origFetch.apply(this, arguments);
            };

            const origOpen = XMLHttpRequest.prototype.open;
            XMLHttpRequest.prototype.open = function(method, url) {
              window.parent.postMessage({
                type: 'network',
                method: method,
                url: url
              }, '*');
              return origOpen.apply(this, arguments);
            };
          })();
        `;
        doc.head.appendChild(script);
      } catch {
        // Cross-origin or not loaded yet
      }
    }

    iframe.addEventListener('load', injectConsoleInterceptor);

    // Listen for console messages from iframe
    window.addEventListener('message', (e) => {
      if (e.data?.type === 'console') {
        addConsoleEntry(e.data.level, e.data.args);
      } else if (e.data?.type === 'network') {
        addNetworkEntry(e.data.method, e.data.url);
      }
    });
  }

  function addConsoleEntry(level, args) {
    const entry = {
      level,
      args: Array.isArray(args) ? args : [String(args)],
      time: new Date().toLocaleTimeString(),
    };
    state.consoleEntries.push(entry);

    const container = document.getElementById('console-view-console');
    const el = document.createElement('div');
    el.className = `console-entry ${level}`;

    const icons = { log: '›', error: '✕', warn: '⚠', info: 'ℹ', debug: 'DBG' };
    el.innerHTML = `
      <span class="console-entry-icon">${icons[level] || '›'}</span>
      <span class="console-entry-content">${escapeHtml(entry.args.join(' '))}</span>
      <span class="console-entry-time">${entry.time}</span>
    `;
    container.appendChild(el);
    container.scrollTop = container.scrollHeight;

    const count = state.consoleEntries.filter(e => e.level === 'error').length;
    document.getElementById('console-count').textContent = state.consoleEntries.length;
  }

  function addNetworkEntry(method, url) {
    const entry = {
      method: method || 'GET',
      url: url || '',
      time: new Date().toLocaleTimeString(),
    };
    state.networkEntries.push(entry);

    const container = document.getElementById('console-view-network');
    const el = document.createElement('div');
    el.className = 'network-entry';
    el.innerHTML = `
      <span class="network-method">${entry.method}</span>
      <span class="network-url" title="${escapeHtml(entry.url)}">${escapeHtml(entry.url)}</span>
      <span class="network-status ok">200</span>
      <span class="network-type">${guessType(entry.url)}</span>
    `;
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

  function guessType(url) {
    const ext = url.split('.').pop().split('?')[0].toLowerCase();
    const types = { html: 'document', css: 'stylesheet', js: 'script', json: 'fetch', png: 'image', jpg: 'image', svg: 'image' };
    return types[ext] || 'other';
  }

  // ── QR Code ──
  function showQRCode() {
    const modal = document.getElementById('qr-modal');
    modal.classList.add('active');

    const url = window.location.origin + '/workspace.html';
    document.getElementById('qr-url').textContent = url;

    // Simple QR code generation
    generateQR(url);
  }

  function generateQR(text) {
    const canvas = document.getElementById('qr-canvas');
    const ctx = canvas.getContext('2d');
    const size = 200;
    canvas.width = size;
    canvas.height = size;

    // Simple QR-like visual (actual QR encoding needs a library)
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);

    ctx.fillStyle = '#000000';
    const cellSize = 4;
    const margin = 20;
    const gridSize = Math.floor((size - 2 * margin) / cellSize);

    // Generate deterministic pattern from text
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      hash = ((hash << 5) - hash) + text.charCodeAt(i);
      hash |= 0;
    }

    // Draw finder patterns
    drawFinderPattern(ctx, margin, margin, cellSize);
    drawFinderPattern(ctx, size - margin - 7 * cellSize, margin, cellSize);
    drawFinderPattern(ctx, margin, size - margin - 7 * cellSize, cellSize);

    // Draw data pattern (pseudo-random)
    const seed = Math.abs(hash);
    for (let y = 0; y < gridSize; y++) {
      for (let x = 0; x < gridSize; x++) {
        if (isFinderArea(x, y, gridSize)) continue;
        const val = pseudoRandom(x * gridSize + y, seed);
        if (val > 0.5) {
          ctx.fillRect(margin + x * cellSize, margin + y * cellSize, cellSize, cellSize);
        }
      }
    }
  }

  function drawFinderPattern(ctx, x, y, cell) {
    ctx.fillStyle = '#000000';
    ctx.fillRect(x, y, 7 * cell, 7 * cell);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x + cell, y + cell, 5 * cell, 5 * cell);
    ctx.fillStyle = '#000000';
    ctx.fillRect(x + 2 * cell, y + 2 * cell, 3 * cell, 3 * cell);
  }

  function isFinderArea(x, y, grid) {
    return (x < 8 && y < 8) || (x >= grid - 8 && y < 8) || (x < 8 && y >= grid - 8);
  }

  function pseudoRandom(n, seed) {
    let x = Math.sin(n + seed) * 10000;
    return x - Math.floor(x);
  }

  // ── Dev Tools ──
  let currentDevTool = null;

  function openDevTool(tool) {
    currentDevTool = tool;
    const modal = document.getElementById('devtool-modal');
    modal.classList.add('active');

    const titles = {
      'json': 'JSON Formatter',
      'base64-enc': 'Base64 Encoder',
      'base64-dec': 'Base64 Decoder',
      'url-enc': 'URL Encoder',
      'url-dec': 'URL Decoder',
      'jwt': 'JWT Token Parser',
      'timestamp': 'Timestamp Converter',
      'hash': 'Hash Generator',
    };

    document.getElementById('devtool-title').textContent = titles[tool] || 'Tool';
    document.getElementById('devtool-input').value = '';
    document.getElementById('devtool-output').value = '';

    // Pre-fill with selected editor text
    if (state.activeFileId && state.editor.somethingSelected()) {
      document.getElementById('devtool-input').value = state.editor.getSelection();
    }
  }

  async function processDevTool() {
    const input = document.getElementById('devtool-input').value;
    const output = document.getElementById('devtool-output');

    try {
      switch (currentDevTool) {
        case 'json':
          output.value = JSON.stringify(JSON.parse(input), null, 2);
          break;
        case 'base64-enc':
          output.value = btoa(unescape(encodeURIComponent(input)));
          break;
        case 'base64-dec':
          output.value = decodeURIComponent(escape(atob(input)));
          break;
        case 'url-enc':
          output.value = encodeURIComponent(input);
          break;
        case 'url-dec':
          output.value = decodeURIComponent(input);
          break;
        case 'jwt':
          output.value = parseJWT(input);
          break;
        case 'timestamp':
          output.value = formatTimestamp(input);
          break;
        case 'hash':
          output.value = await hashText(input);
          break;
      }
    } catch (err) {
      output.value = 'Error: ' + err.message;
    }
  }

  function parseJWT(token) {
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('Invalid JWT format');
    const header = JSON.parse(atob(parts[0]));
    const payload = JSON.parse(atob(parts[1]));
    return JSON.stringify({ header, payload }, null, 2);
  }

  function formatTimestamp(input) {
    const num = parseInt(input);
    if (isNaN(num)) throw new Error('Invalid timestamp');
    const date = new Date(num > 1e12 ? num : num * 1000);
    return JSON.stringify({
      iso: date.toISOString(),
      local: date.toLocaleString(),
      utc: date.toUTCString(),
      unix: Math.floor(date.getTime() / 1000),
    }, null, 2);
  }

  async function hashText(text) {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // ── Context Menu ──
  let contextTarget = null;

  function showContextMenu(e) {
    const menu = document.getElementById('context-menu');
    const item = e.target.closest('.tree-item');

    if (item && item.dataset.fileId) {
      contextTarget = { type: 'file', id: item.dataset.fileId };
    } else {
      contextTarget = { type: 'root' };
    }

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
      case 'new-file':
        createNewFile();
        break;
      case 'new-folder':
        createNewFolder();
        break;
      case 'rename':
        if (contextTarget.type === 'file') renameFileById(contextTarget.id);
        break;
      case 'delete':
        if (contextTarget.type === 'file') deleteFileById(contextTarget.id);
        break;
    }
    hideContextMenu();
  }

  // ── Keyboard Shortcuts ──
  function setupKeyboard() {
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        saveCurrentFile();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        refreshPreview();
      }
      if (e.key === 'Escape') {
        document.getElementById('qr-modal').classList.remove('active');
        document.getElementById('devtool-modal').classList.remove('active');
        hideContextMenu();
      }
    });
  }

  // ── Resize Handles ──
  function setupResize() {
    setupHorizontalResize('resize-left', 'left-panel', 'left');
    setupHorizontalResize('resize-right', 'right-panel', 'right');
    setupVerticalResize('resize-console', 'console-panel');
  }

  function setupHorizontalResize(handleId, panelId, side) {
    const handle = document.getElementById(handleId);
    const panel = document.getElementById(panelId);
    let startX, startWidth;

    handle.addEventListener('mousedown', (e) => {
      startX = e.clientX;
      startWidth = panel.offsetWidth;

      function onMove(e) {
        const diff = side === 'left' ? e.clientX - startX : startX - e.clientX;
        const newWidth = Math.max(180, Math.min(500, startWidth + diff));
        panel.style.width = newWidth + 'px';
        if (state.editor) state.editor.refresh();
      }

      function onUp() {
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
    let startY, startHeight;

    handle.addEventListener('mousedown', (e) => {
      startY = e.clientY;
      startHeight = panel.offsetHeight;

      function onMove(e) {
        const diff = startY - e.clientY;
        const newHeight = Math.max(80, Math.min(500, startHeight + diff));
        panel.style.height = newHeight + 'px';
        if (state.editor) state.editor.refresh();
      }

      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      }

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  // ── Utilities ──
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

  // ── Start ──
  init();
})();
