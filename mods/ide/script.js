const IDE_FILES = [
  { name: 'scratch.js', language: 'javascript', value: "ModAPI.registerTab({\n  id: 'hello',\n  label: 'Hello',\n  icon: 'code',\n  render(container) {\n    container.textContent = 'Hello from a mod';\n  },\n});" },
  { name: 'mod.json', language: 'json', value: '{\n  "name": "My Mod",\n  "version": "1.0.0",\n  "enabledByDefault": true\n}' },
  { name: 'README.md', language: 'markdown', value: '# My Mod\n\nA small workspace for experimenting with modapp.' },
];

function ideEscape(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function renderIde(container) {
  container.innerHTML = `
    <div class="ide-workspace">
      <nav class="ide-menubar">
        <div class="ide-menu" data-menu="file">
          <button class="ide-menu-trigger" data-menu-trigger>File</button>
          <div class="ide-menu-dropdown" data-menu-dropdown hidden>
            <button data-command-id="new-file">New File<span class="ide-menu-shortcut">Ctrl+N</span></button>
            <button data-command-id="open-file">Open File...<span class="ide-menu-shortcut">Ctrl+O</span></button>
            <button data-command-id="open-folder">Open Folder...</button>
            <div class="ide-menu-separator"></div>
            <button data-command-id="save">Save<span class="ide-menu-shortcut">Ctrl+S</span></button>
            <button data-command-id="close-folder">Close Folder</button>
            <button data-command-id="save-all">Save All<span class="ide-menu-shortcut">Ctrl+Shift+S</span></button>
            <div class="ide-menu-separator"></div>
            <button data-command-id="close-editor">Close Editor<span class="ide-menu-shortcut">Ctrl+W</span></button>
            <button data-command-id="close-all">Close All Editors</button>
          </div>
        </div>
        <div class="ide-menu" data-menu="edit">
          <button class="ide-menu-trigger" data-menu-trigger>Edit</button>
          <div class="ide-menu-dropdown" data-menu-dropdown hidden>
            <button data-command-id="undo">Undo<span class="ide-menu-shortcut">Ctrl+Z</span></button>
            <button data-command-id="redo">Redo<span class="ide-menu-shortcut">Ctrl+Y</span></button>
            <div class="ide-menu-separator"></div>
            <button data-command-id="find">Find<span class="ide-menu-shortcut">Ctrl+F</span></button>
          </div>
        </div>
        <div class="ide-menu" data-menu="view">
          <button class="ide-menu-trigger" data-menu-trigger>View</button>
          <div class="ide-menu-dropdown" data-menu-dropdown hidden>
            <button data-command-id="command-palette">Command Palette...<span class="ide-menu-shortcut">Ctrl+Shift+P</span></button>
            <div class="ide-menu-separator"></div>
            <button data-command-id="toggle-sidebar">Toggle Explorer<span class="ide-menu-shortcut">Ctrl+B</span></button>
            <button data-command-id="toggle-terminal">Toggle Terminal<span class="ide-menu-shortcut">Ctrl+\`</span></button>
            <button data-command-id="toggle-minimap">Toggle Minimap</button>
          </div>
        </div>
        <div class="ide-menu" data-menu="terminal">
          <button class="ide-menu-trigger" data-menu-trigger>Terminal</button>
          <div class="ide-menu-dropdown" data-menu-dropdown hidden>
            <button data-command-id="new-terminal">New Terminal</button>
            <button data-command-id="clear-terminal">Clear Terminal</button>
            <div class="ide-menu-separator"></div>
            <button data-command-id="run-file">Run Active File</button>
          </div>
        </div>
      </nav>
      <div class="ide-toolbar"><span class="ide-breadcrumb"><span class="material-symbols-outlined">folder_open</span> <span data-workspace-name>mods</span> <span>/</span> <strong data-breadcrumb>scratch.js</strong></span><span class="ide-header-actions"><span class="ide-sync"><span class="material-symbols-outlined">cloud_done</span> local workspace</span><button class="ide-run-button" data-action="run"><span class="material-symbols-outlined">play_arrow</span>Run</button></span></div>
      <div class="ide-grid">
        <div class="ide-activitybar">
          <button class="ide-activity-item active" data-activity="explorer" title="Explorer"><span class="material-symbols-outlined">description</span></button>
          <button class="ide-activity-item" data-activity="search" title="Search"><span class="material-symbols-outlined">search</span></button>
          <div class="ide-activity-spacer"></div>
          <button class="ide-activity-item" data-activity="terminal" title="Toggle Terminal"><span class="material-symbols-outlined">terminal</span></button>
        </div>
        <aside class="ide-files"><div class="ide-sidebar-heading"><span>Explorer</span><div class="ide-explorer-actions"><button class="ide-icon-button" data-action="open-file" title="Open file"><span class="material-symbols-outlined">note_add</span></button><button class="ide-icon-button" data-action="open-folder" title="Open folder"><span class="material-symbols-outlined">create_new_folder</span></button><button class="ide-icon-button" data-action="new" title="New file"><span class="material-symbols-outlined">add</span></button></div></div><button class="ide-tree-root" data-action="toggle-tree"><span class="material-symbols-outlined ide-tree-chevron">expand_more</span><span class="material-symbols-outlined folder-icon">folder</span> <span data-workspace-name>mods</span></button><div class="ide-file-list"></div><div class="ide-sidebar-footer"><span class="material-symbols-outlined">info</span> Local mod workspace</div><input class="ide-hidden-input" data-file-input type="file" multiple><input class="ide-hidden-input" data-folder-input type="file" webkitdirectory multiple></aside>
        <div class="ide-main">
          <section class="ide-editor-panel">
            <div class="ide-tabs"></div>
            <div class="ide-editor-mount"></div>
            <div class="ide-empty-state" data-empty-state hidden>
              <span class="material-symbols-outlined ide-empty-icon">draft</span>
              <p class="ide-empty-title">No editor open</p>
              <div class="ide-empty-actions">
                <button class="ide-empty-action" data-command-id="open-file"><span class="material-symbols-outlined">note_add</span>Open File... <kbd>Ctrl+O</kbd></button>
                <button class="ide-empty-action" data-command-id="new-file"><span class="material-symbols-outlined">add</span>New File <kbd>Ctrl+N</kbd></button>
                <button class="ide-empty-action" data-command-id="command-palette"><span class="material-symbols-outlined">terminal</span>Show All Commands <kbd>Ctrl+Shift+P</kbd></button>
              </div>
            </div>
          </section>
          <section class="ide-terminal-panel"><div class="ide-panel-bar"><span><span class="material-symbols-outlined">terminal</span> Terminal</span><select class="ide-shell-select" data-shell-select title="Shell"></select></div><div class="ide-term-mount"></div></section>
        </div>
      </div>
      <footer class="ide-statusbar"><span><span class="material-symbols-outlined">code</span><strong data-language>JavaScript</strong></span><span>Spaces: 2</span><span>UTF-8</span><span data-cursor>Ln 1, Col 1</span></footer>
    </div>
    <div class="ide-context-menu" data-context-menu hidden>
      <button data-menu-action="close">Close</button>
      <button data-menu-action="close-others">Close Others</button>
      <button data-menu-action="close-all">Close All</button>
    </div>
    <div class="ide-command-palette" data-command-palette hidden>
      <div class="ide-command-palette-inputrow"><span class="material-symbols-outlined">search</span><input class="ide-command-palette-input" data-command-palette-input placeholder="Type a command..."></div>
      <div class="ide-command-palette-list" data-command-palette-list></div>
    </div>`;

  const files = IDE_FILES.map((file) => ({ ...file }));
  let active = files[0];
  let editor;
  let fallback;
  
  // Tree structure for file explorer: { type: 'folder'|'file', name, path, children, ...fileProps }
  const ROOT_KEY = '__root__';
  let workspaceName = 'mods';
  let workspaceHandle = null;
  let autoSave = true;
  const saveTimers = new Map();
  let fileTree = [{ type: 'folder', name: workspaceName, path: ROOT_KEY, children: [], expanded: true }];
  
  // Map from file path to tree node for quick lookup
  const fileTreeMap = new Map();
  const fileList = container.querySelector('.ide-file-list');
  const tabs = container.querySelector('.ide-tabs');
  const mount = container.querySelector('.ide-editor-mount');
  const termMount = container.querySelector('.ide-term-mount');
  const fileInput = container.querySelector('[data-file-input]');
  const folderInput = container.querySelector('[data-folder-input]');
  const contextMenu = container.querySelector('[data-context-menu]');
  const treeRoot = container.querySelector('[data-action="toggle-tree"]');
  const emptyState = container.querySelector('[data-empty-state]');
  const commandPalette = container.querySelector('[data-command-palette]');
  const paletteInput = container.querySelector('[data-command-palette-input]');
  const paletteList = container.querySelector('[data-command-palette-list]');
  const activityItems = [...container.querySelectorAll('.ide-activity-item')];
  let minimapEnabled = true;

  function fileIcon(file) { 
    if (file.type === 'folder') return 'folder';
    if (file.language === 'json') return 'data_object';
    if (file.language === 'markdown') return 'article';
    return 'javascript';
  }
  
  function renderTreeNode(node, depth = 0) {
    const isActive = active && active.name === node.path;
    const hasChildren = node.children && node.children.length > 0;
    const isExpanded = node.expanded !== undefined ? node.expanded : true;
    
    if (node.type === 'folder') {
      const childrenHtml = hasChildren && isExpanded ? node.children.map(child => renderTreeNode(child, depth + 1)).join('') : '';
      const chevron = hasChildren ? (isExpanded ? 'expand_more' : 'chevron_right') : '&#8203;';
      const display = hasChildren && !isExpanded ? 'none' : 'block';
      return `
        <div class="ide-tree-node folder ${isActive ? 'active' : ''}" data-path="${ideEscape(node.path)}">
          <button class="ide-tree-toggle" data-action="toggle" data-path="${ideEscape(node.path)}" style="padding-left: ${depth * 14 + 8}px">
            <span class="material-symbols-outlined ide-tree-chevron">${chevron}</span>
            <span class="material-symbols-outlined folder-icon">folder</span>
            <span class="ide-tree-label">${ideEscape(node.name)}</span>
          </button>
          ${hasChildren ? `<div class="ide-tree-children" style="display: ${display}">${childrenHtml}</div>` : ''}
        </div>`;
    } else {
      // File node
      const dirty = node.dirty ? '<span class="ide-dirty-dot"></span>' : '';
      return `
        <button class="ide-tree-node file ${isActive ? 'active' : ''}" data-file="${ideEscape(node.path)}" style="padding-left: ${depth * 14 + 28}px">
          <span class="material-symbols-outlined">${fileIcon(node)}</span>
          <span class="ide-tree-label">${ideEscape(node.name.split('/').pop())}</span>${dirty}
        </button>`;
    }
  }
  
  function renderFiles() {
    // Rebuild tree from files
    buildFileTree();
    
    // Render tree
    fileList.innerHTML = fileTree[0].children.map(node => renderTreeNode(node, 1)).join('');
    
    // Render tabs (only files, not folders)
    tabs.innerHTML = files.filter((file) => file.open).map((file) => {
      const icon = file.language === 'json' ? 'data_object' : file.language === 'markdown' ? 'article' : 'javascript';
      return `<button class="ide-tab${file === active ? ' active' : ''}" data-file="${ideEscape(file.name)}"><span class="material-symbols-outlined">${icon}</span>${ideEscape(file.name.split('/').pop())}<span class="ide-tab-close" data-close="${ideEscape(file.name)}">close</span></button>`;
    }).join('');
    
    // Add event listeners for tree nodes
    fileList.querySelectorAll('.ide-tree-node.file').forEach((button) => {
      button.addEventListener('click', () => selectFile(button.dataset.file));
      button.addEventListener('contextmenu', (event) => { 
        event.preventDefault(); 
        openContextMenu(event, button.dataset.file); 
      });
    });
    
    fileList.querySelectorAll('.ide-tree-toggle').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        const path = button.dataset.path;
        const treeNode = button.closest('.ide-tree-node.folder');
        const children = treeNode.querySelector('.ide-tree-children');
        const chevron = treeNode.querySelector('.ide-tree-chevron');
        
        if (children) {
          const isExpanded = children.style.display !== 'none';
          const newExpandedState = !isExpanded;
          children.style.display = newExpandedState ? 'block' : 'none';
          chevron.textContent = newExpandedState ? 'expand_more' : 'chevron_right';
          
          // Update the tree data structure
          const folder = findNodeInTree(path);
          if (folder) {
            folder.expanded = newExpandedState;
          }
        }
      });
    });
    
    tabs.querySelectorAll('[data-file]').forEach((button) => {
      button.addEventListener('click', () => selectFile(button.dataset.file));
      button.addEventListener('contextmenu', (event) => { event.preventDefault(); openContextMenu(event, button.dataset.file); });
    });
    tabs.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', (event) => { event.stopPropagation(); closeFile(button.dataset.close); }));
  }
  function selectFile(nameOrPath, { keepPreviousOpen = true } = {}) {
    const next = files.find((file) => file.name === nameOrPath);
    if (!next) return;
    // Closing a tab calls this with keepPreviousOpen: false so the tab
    // being left behind isn't force-reopened by this switch.
    if (keepPreviousOpen && active) active.open = true;
    next.open = true;
    active = next;
    emptyState.hidden = true;
    mount.hidden = false;
    container.querySelector('[data-breadcrumb]').textContent = next.name.split('/').join(' / ');
    container.querySelector('[data-language]').textContent = next.language === 'javascript' ? 'JavaScript' : next.language[0].toUpperCase() + next.language.slice(1);
    renderFiles();
    if (next.lazy) {
      setEditorValue('');
      const target = next;
      nativeRead(target.fsRoot, target.name).then((text) => {
        target.value = text; target.lazy = false;
        if (active === target) setEditorValue(text);
      }).catch(() => { target.lazy = false; notify(`Cannot read ${target.name}`); });
    } else {
      setEditorValue(next.value);
    }
  }
  function clearActiveEditor() {
    active = null;
    container.querySelector('[data-breadcrumb]').textContent = 'No editor open';
    container.querySelector('[data-language]').textContent = '—';
    container.querySelector('[data-cursor]').textContent = '';
    mount.hidden = true;
    emptyState.hidden = false;
    renderFiles();
  }
  function closeFile(nameOrPath, { skipConfirm = false } = {}) {
    const file = files.find((item) => item.name === nameOrPath);
    if (!file || !file.open) return;
    file.open = false;
    if (file === active) {
      const next = files.find((item) => item.open);
      if (next) selectFile(next.name, { keepPreviousOpen: false });
      else clearActiveEditor();
    } else {
      renderFiles();
    }
  }
  function closeOthers(nameOrPath) {
    files.filter((item) => item.open && item.name !== nameOrPath).forEach((item) => { item.open = false; });
    if (!active || active.name !== nameOrPath) selectFile(nameOrPath, { keepPreviousOpen: false });
    else renderFiles();
  }
  function closeAll() {
    files.forEach((item) => { item.open = false; });
    clearActiveEditor();
  }
  function newFile() {
    const file = { name: `untitled-${files.length + 1}.js`, language: 'javascript', value: '// New mod file\n', open: true, dirty: true };
    files.push(file);
    selectFile(file.name);
  }
  let suppressChange = false;
  function setEditorValue(value) {
    suppressChange = true;
    try { if (editor) editor.setValue(value); else if (fallback) fallback.value = value; } finally { suppressChange = false; }
  }
  function changed(value) {
    if (!active || suppressChange) return;
    const wasDirty = active.dirty;
    active.value = value; active.dirty = true;
    if (!wasDirty) renderFiles();
    if (autoSave && active.handle) scheduleAutoSave(active);
  }
  function scheduleAutoSave(file) {
    clearTimeout(saveTimers.get(file));
    saveTimers.set(file, setTimeout(async () => {
      saveTimers.delete(file);
      if (!file.dirty || !file.handle) return;
      try { await writeToHandle(file.handle, file.value); file.dirty = false; renderFiles(); } catch (error) { console.warn('Auto save failed for', file.name, error); }
    }, 800));
  }
  function languageFor(name) { const extension = name.split('.').pop().toLowerCase(); return extension === 'json' ? 'json' : extension === 'md' ? 'markdown' : extension === 'css' ? 'css' : extension === 'html' ? 'html' : 'javascript'; }
  
  function findOrCreateFolder(tree, pathParts, index = 0) {
    if (index >= pathParts.length) return null;
    
    const part = pathParts[index];
    let child = tree.children.find(c => c.name === part && c.type === 'folder');
    
    if (!child) {
      const path = pathParts.slice(0, index + 1).join('/');
      child = { type: 'folder', name: part, path, children: [], expanded: index < 2 };
      tree.children.push(child);
      fileTreeMap.set(path, child);
    }
    
    if (index === pathParts.length - 1) {
      return child;
    }
    return findOrCreateFolder(child, pathParts, index + 1);
  }
  
  function addFileToTree(file) {
    const pathParts = file.name.split('/');
    if (pathParts.length === 1) {
      // File in root
      const rootFolder = fileTree[0];
      const existing = rootFolder.children.find(c => c.name === file.name && c.type === 'file');
      if (!existing) {
        rootFolder.children.push({ type: 'file', name: file.name, path: file.name, ...file });
        fileTreeMap.set(file.name, rootFolder.children[rootFolder.children.length - 1]);
      }
    } else {
      // File in subfolder
      const folderPath = pathParts.slice(0, -1).join('/');
      const fileName = pathParts[pathParts.length - 1];
      
      let folder = fileTreeMap.get(folderPath);
      if (!folder) {
        folder = findOrCreateFolder(fileTree[0], pathParts.slice(0, -1), 0);
        fileTreeMap.set(folderPath, folder);
      }
      
      if (folder) {
        const existing = folder.children.find(c => c.name === fileName && c.type === 'file');
        if (!existing) {
          folder.children.push({ type: 'file', name: fileName, path: file.name, ...file });
          fileTreeMap.set(file.name, folder.children[folder.children.length - 1]);
        }
      }
    }
  }
  
  function buildFileTree() {
    // Preserve expanded state from old tree
    const oldExpandedState = new Map();
    const saveExpandedState = (node) => {
      if (node.type === 'folder' && node.expanded !== undefined) {
        oldExpandedState.set(node.path, node.expanded);
      }
      if (node.children) {
        node.children.forEach(saveExpandedState);
      }
    };
    
    // Save current expanded state
    fileTree.forEach(saveExpandedState);
    
    // Build new tree
    fileTree = [{ type: 'folder', name: workspaceName, path: ROOT_KEY, children: [], expanded: true }];
    fileTreeMap.clear();
    fileTreeMap.set(ROOT_KEY, fileTree[0]);
    
    for (const file of files) {
      addFileToTree(file);
    }
    
    // Restore expanded state
    const restoreExpandedState = (node) => {
      if (node.type === 'folder') {
        const wasExpanded = oldExpandedState.get(node.path);
        if (wasExpanded !== undefined) {
          node.expanded = wasExpanded;
        }
      }
      if (node.children) {
        node.children.forEach(restoreExpandedState);
      }
    };
    
    fileTree.forEach(restoreExpandedState);
  }
  
  function findNodeInTree(path, node = null, nodes = fileTree) {
    if (node) {
      if (node.path === path) return node;
      if (node.children) {
        for (const child of node.children) {
          const found = findNodeInTree(path, child);
          if (found) return found;
        }
      }
    } else {
      for (const node of nodes) {
        const found = findNodeInTree(path, node);
        if (found) return found;
      }
    }
    return null;
  }
  
  function findFileInTree(path) {
    const fromMap = fileTreeMap.get(path);
    if (fromMap) return fromMap;
    return findNodeInTree(path);
  }
  
  async function importFiles(selectedFiles) {
    let lastOpened = null;
    for (const selected of selectedFiles) {
      const name = selected.webkitRelativePath || selected.name;
      const existing = files.find((file) => file.name === name);
      if (existing) {
        // Already in the workspace (possibly closed) — reopen it rather
        // than silently doing nothing.
        existing.open = true;
        lastOpened = existing.name;
        continue;
      }
      const content = await selected.text();
      files.push({ name, language: languageFor(name.split('/').pop()), value: content, open: false, dirty: false, imported: true });
      lastOpened = name;
    }
    // Rebuild the file tree with new files
    buildFileTree();
    renderFiles();
    // Select the file that was actually just opened, not just whatever
    // happens to sit last in the files array.
    if (lastOpened) selectFile(lastOpened);
  }
  // ---- Real filesystem access (File System Access API) ----
  const hasFsApi = typeof window.showDirectoryPicker === 'function';
  const SKIP_DIRS = new Set(['node_modules', '.git', 'target', 'dist', 'build', '.next', '__pycache__', '.venv']);
  const BINARY_EXT = /\.(png|jpe?g|gif|webp|ico|bmp|pdf|zip|gz|tar|7z|rar|exe|dll|so|dylib|wasm|woff2?|ttf|otf|mp[34]|mov|avi|webm|ogg|wav|bin|db|sqlite|lock)$/i;
  const MAX_FILE_BYTES = 1024 * 1024;
  const MAX_FILES = 1000;
  let notifyTimer;
  function notify(message) {
    const slot = container.querySelector('.ide-statusbar > span:first-child');
    if (!slot) return;
    if (slot.dataset.original === undefined) slot.dataset.original = slot.innerHTML;
    slot.textContent = message;
    clearTimeout(notifyTimer);
    notifyTimer = setTimeout(() => { slot.innerHTML = slot.dataset.original; }, 6000);
  }

  async function walkDirectory(dirHandle, prefix, out) {
    const entries = [];
    for await (const entry of dirHandle.values()) entries.push(entry);
    entries.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'directory' ? -1 : 1));
    for (const entry of entries) {
      if (out.files.length >= MAX_FILES) { out.truncated = true; return; }
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.kind === 'directory') {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
        await walkDirectory(entry, path, out);
      } else {
        if (BINARY_EXT.test(entry.name)) { out.skipped++; continue; }
        const file = await entry.getFile();
        if (file.size > MAX_FILE_BYTES) { out.skipped++; continue; }
        out.files.push({ path, handle: entry, text: await file.text() });
      }
    }
  }
  function setWorkspaceName(name) {
    workspaceName = name;
    container.querySelectorAll('[data-workspace-name]').forEach((el) => { el.textContent = name; });
  }
  async function resetWorkspace(name, handle) {
    await saveAll();
    saveTimers.forEach((timer) => clearTimeout(timer));
    saveTimers.clear();
    files.splice(0, files.length);
    workspaceHandle = handle || null;
    setWorkspaceName(name);
    active = null;
    setEditorValue('');
    workspaceRoot = null;
    clearActiveEditor();
  }
  async function closeFolder() { await resetWorkspace('No Folder', null); }
  async function openFolderPicker() {
    if (!hasFsApi) return folderInput.click();
    let dirHandle;
    try { dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' }); }
    catch (error) { if (error && error.name === 'AbortError') return; console.warn(error); return folderInput.click(); }
    const out = { files: [], skipped: 0, truncated: false };
    await walkDirectory(dirHandle, '', out);
    await resetWorkspace(dirHandle.name, dirHandle);
    let first = null;
    const preferred = ['README.md', 'readme.md', 'mod.json', 'package.json'];
    for (const item of out.files) {
      files.push({ name: item.path, language: languageFor(item.path.split('/').pop()), value: item.text, open: false, dirty: false, imported: true, handle: item.handle });
    }
    first = (preferred.find((name) => files.some((f) => f.name === name))) || null;
    buildFileTree();
    renderFiles();
    if (first) selectFile(first);
    notify(`Opened ${dirHandle.name}: ${out.files.length} files` + (out.skipped ? `, ${out.skipped} skipped (binary/large)` : '') + (out.truncated ? `, stopped at ${MAX_FILES} files` : ''));
  }
  async function openFilePicker() {
    if (typeof window.showOpenFilePicker !== 'function') return fileInput.click();
    let handles;
    try { handles = await window.showOpenFilePicker({ multiple: true }); }
    catch (error) { if (error && error.name === 'AbortError') return; console.warn(error); return fileInput.click(); }
    let last = null;
    for (const handle of handles) {
      const existing = files.find((file) => file.handle && file.name === handle.name);
      if (existing) { existing.open = true; last = existing.name; continue; }
      const text = await (await handle.getFile()).text();
      files.push({ name: handle.name, language: languageFor(handle.name), value: text, open: false, dirty: false, imported: true, handle });
      last = handle.name;
    }
    buildFileTree();
    renderFiles();
    if (last) selectFile(last);
  }

  // ---- Native filesystem via the shell API (no browser permission prompts) ----
  // Shell-independent: on Windows every operation runs `powershell -EncodedCommand` (works from cmd, PowerShell,
  // Git Bash, WSL, or any custom terminal); elsewhere it runs `sh -c '...'`. The target folder is set inside the
  // script itself, so nothing depends on how the terminal treats its working directory.
  const LAST_FOLDER_KEY = 'ide.lastFolder';
  const lsGet = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
  const lsSet = (key, value) => { try { localStorage.setItem(key, value); } catch { /* blocked */ } };
  const IS_WINDOWS = /Windows/i.test(navigator.userAgent);
  let workspaceRoot = null;
  function shellAvailable() { return !!(window.ModAPI && ModAPI.native && ModAPI.native.shell && ModAPI.native.shell.run); }
  function isAbsolutePath(path) { return /^([A-Za-z]:[\\/]|[\\/]{2}|\/|~)/.test(path); }
  function normalizeUserPath(raw) { return raw.trim().replace(/^["']|["']$/g, ''); }
  function cleanRel(path) { return path.replace(/\\/g, '/').replace(/^\.\//, ''); }
  function toB64(text) { return btoa(unescape(encodeURIComponent(text))); }
  const shq = (text) => "'" + String(text).replace(/'/g, "'\\''") + "'";
  const psq = (text) => "'" + String(text).replace(/'/g, "''") + "'";
  function psEncode(script) {
    const full = "$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';[Console]::OutputEncoding=[Text.Encoding]::UTF8;" + script;
    let binary = '';
    for (let i = 0; i < full.length; i++) { const c = full.charCodeAt(i); binary += String.fromCharCode(c & 255, c >> 8); }
    return btoa(binary);
  }
  const SKIP_LIST = ['node_modules', '.git', 'target', 'dist', 'build', '__pycache__', '.venv'];
  const adapter = IS_WINDOWS ? {
    chunk: 1800,
    run: (script) => ModAPI.ide.runCommand(`powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${psEncode(script)}`, ''),
    check: (root) => `Set-Location -LiteralPath ${psq(root)}; [Console]::Out.Write((Get-Location).Path)`,
    list: (root) => `Set-Location -LiteralPath ${psq(root)}; $base=(Get-Location).Path.TrimEnd('\\')+'\\'; $skip=@(${SKIP_LIST.map(psq).join(',')}); ` +
      `function Walk($d){ Get-ChildItem -LiteralPath $d -Force -ErrorAction SilentlyContinue | ForEach-Object { if($_.PSIsContainer){ if(($skip -notcontains $_.Name) -and -not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint)){ Walk $_.FullName } } elseif($_.Length -lt 1048576){ $_.FullName.Substring($base.Length).Replace('\\','/') } } }; ` +
      `Walk (Get-Location).Path | Select-Object -First ${MAX_FILES + 1}`,
    read: (root, rel) => `Set-Location -LiteralPath ${psq(root)}; [Console]::Out.Write([IO.File]::ReadAllText((Join-Path (Get-Location).Path ${psq(rel)})))`,
    write: (root, rel, b64, first) => `Set-Location -LiteralPath ${psq(root)}; $p=Join-Path (Get-Location).Path ${psq(rel)}; $b=[Convert]::FromBase64String(${psq(b64)}); ` +
      (first ? `[void][IO.Directory]::CreateDirectory((Split-Path -Parent $p)); [IO.File]::WriteAllBytes($p,$b)` : `$f=[IO.File]::Open($p,[IO.FileMode]::Append); $f.Write($b,0,$b.Length); $f.Close()`),
  } : {
    chunk: 6000,
    run: (script) => ModAPI.ide.runCommand(`sh -c ${shq(script)}`, ''),
    check: (root) => `cd ${shq(root)} && pwd`,
    list: (root) => `cd ${shq(root)} && find . \\( ${SKIP_LIST.map((n) => `-name ${shq(n)}`).join(' -o ')} \\) -prune -o -type f -size -1024k -print | head -${MAX_FILES + 1}`,
    read: (root, rel) => `cd ${shq(root)} && cat -- ${shq(rel)}`,
    write: (root, rel, b64, first) => `cd ${shq(root)} && ` + (first ? `mkdir -p "$(dirname ${shq(rel)})" && printf %s ${shq(b64)} | base64 -d > ${shq(rel)}` : `printf %s ${shq(b64)} | base64 -d >> ${shq(rel)}`),
  };
  const stripBom = (text) => text.replace(/^\uFEFF/, '');
  async function nativeRead(root, rel) {
    const result = await adapter.run(adapter.read(root, rel));
    if (result.code !== 0) throw new Error((result.stderr || 'read failed').trim());
    return stripBom(result.stdout);
  }
  async function nativeWrite(root, rel, value) {
    const b64 = toB64(value);
    for (let i = 0, first = true; first || i < b64.length; i += adapter.chunk, first = false) {
      const result = await adapter.run(adapter.write(root, rel, b64.slice(i, i + adapter.chunk), first));
      if (result.code !== 0) throw new Error((result.stderr || 'write failed').trim());
    }
  }
  function makeNativeHandle(root, path) { return { nativeWrite: (value) => nativeWrite(root, path, value) }; }
  // Prompt for a path using the palette (dark, in-app) instead of a browser dialog.
  let pathResolver = null;
  function askPath(title, initial = '') {
    return new Promise((resolve) => {
      closeAllMenus();
      if (pathResolver) pathResolver(null);
      pathResolver = resolve;
      paletteMode = 'path';
      paletteInput.placeholder = title;
      paletteInput.value = initial;
      const last = lsGet(LAST_FOLDER_KEY);
      paletteList.innerHTML = `<div class="ide-command-empty">${ideEscape(title)} — press Enter</div>` + (last ? `<button class="ide-command-item" data-recent="${ideEscape(last)}">${ideEscape(last)}<span class="ide-command-shortcut">recent</span></button>` : '');
      paletteList.querySelectorAll('[data-recent]').forEach((button) => button.addEventListener('click', () => finishPath(button.dataset.recent)));
      // Defer so the click that opened this doesn't immediately close it via the document click handler.
      setTimeout(() => { commandPalette.hidden = false; paletteInput.focus(); paletteInput.select(); }, 0);
    });
  }
  function finishPath(value) {
    const resolve = pathResolver; pathResolver = null;
    commandPalette.hidden = true;
    if (resolve) resolve(value == null ? null : normalizeUserPath(value));
  }
  function splitAbsolute(raw) { const cut = Math.max(raw.lastIndexOf('/'), raw.lastIndexOf('\\')); return { root: raw.slice(0, cut) || raw.slice(0, cut + 1) || '/', rel: raw.slice(cut + 1) }; }
  async function openFolderNative() {
    if (!shellAvailable()) return openFolderPicker();
    let raw = null;
    try { raw = await ModAPI.ide.dialog.pickFolder({ title: 'Open Folder', defaultDir: lsGet(LAST_FOLDER_KEY) }); }
    catch (error) { raw = await askPath('Open folder (full path)', lsGet(LAST_FOLDER_KEY) || ''); }
    if (!raw) return;
    const check = await adapter.run(adapter.check(raw)).catch((error) => ({ code: 1, stdout: '', stderr: String(error) }));
    if (check.code !== 0) { notify(`Cannot open folder: ${raw} ${(check.stderr || '').trim().split('\n')[0]}`); return; }
    const list = await adapter.run(adapter.list(raw));
    if (list.code !== 0 && !list.stdout) { notify(`Cannot read folder: ${raw}`); return; }
    const lines = stripBom(list.stdout).split('\n').map((line) => line.replace(/\r$/, '').replace(/^\.\//, '')).filter(Boolean);
    const paths = lines.filter((line) => !BINARY_EXT.test(line)).sort((x, y) => {
      const dx = x.includes('/'), dy = y.includes('/');
      return dx === dy ? x.localeCompare(y) : dx ? -1 : 1;
    });
    const truncated = paths.length > MAX_FILES;
    const shown = paths.slice(0, MAX_FILES);
    const name = raw.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || raw;
    await resetWorkspace(name, null);
    workspaceRoot = raw;
    lsSet(LAST_FOLDER_KEY, raw);
    for (const path of shown) {
      files.push({ name: path, language: languageFor(path.split('/').pop()), value: '', lazy: true, open: false, dirty: false, imported: true, fsRoot: raw, handle: makeNativeHandle(raw, path) });
    }
    buildFileTree();
    renderFiles();
    const preferred = ['README.md', 'readme.md', 'mod.json', 'package.json'].find((n) => files.some((f) => f.name === n));
    if (preferred) selectFile(preferred);
    notify(`Opened ${name}: ${shown.length} files` + (lines.length - paths.length ? `, ${lines.length - paths.length} binary skipped` : '') + (truncated ? `, stopped at ${MAX_FILES} files` : ''));
  }
  function resolveTarget(raw) {
    if (isAbsolutePath(raw)) return splitAbsolute(raw);
    if (workspaceRoot) return { root: workspaceRoot, rel: cleanRel(raw) };
    return null;
  }
  // Paths from the native dialogs are absolute. Inside the open folder they become folder-relative so the tree stays consistent.
  function targetForAbsolute(abs) {
    const norm = (value) => value.replace(/\\/g, '/');
    if (workspaceRoot) {
      const prefix = norm(workspaceRoot).replace(/\/+$/, '') + '/';
      const full = norm(abs);
      if (full.toLowerCase().startsWith(prefix.toLowerCase())) return { root: workspaceRoot, rel: full.slice(prefix.length) };
    }
    return splitAbsolute(abs);
  }
  async function openTarget(target, label) {
    const existing = files.find((f) => f.name === target.rel && f.fsRoot === target.root);
    if (existing) { selectFile(existing.name); return; }
    try {
      const text = await nativeRead(target.root, target.rel);
      files.push({ name: target.rel, language: languageFor(target.rel.split('/').pop()), value: text, lazy: false, open: false, dirty: false, imported: true, fsRoot: target.root, handle: makeNativeHandle(target.root, target.rel) });
      buildFileTree(); renderFiles(); selectFile(target.rel);
    } catch (error) { notify(`Cannot open file: ${label}`); }
  }
  async function openFileNative() {
    if (!shellAvailable()) return openFilePicker();
    let picked;
    try { picked = await ModAPI.ide.dialog.pickFiles({ title: 'Open File', defaultDir: workspaceRoot || lsGet(LAST_FOLDER_KEY), multiple: true }); }
    catch (error) {
      const raw = await askPath(workspaceRoot ? 'Open file (path, relative to folder or absolute)' : 'Open file (full path)', '');
      const target = raw ? resolveTarget(raw) : null;
      if (raw && !target) notify('Open a folder first, or use a full path');
      if (target) await openTarget(target, raw);
      return;
    }
    for (const abs of picked) await openTarget(targetForAbsolute(abs), abs);
  }
  async function saveNative(file) {
    try {
      if (!file.handle) {
        let target = null;
        try {
          const abs = await ModAPI.ide.dialog.pickSaveFile({ title: 'Save As', defaultDir: workspaceRoot || lsGet(LAST_FOLDER_KEY), defaultName: file.name.split('/').pop() });
          if (!abs) return;
          target = targetForAbsolute(abs);
        } catch (error) {
          const raw = await askPath('Save as (path, relative to folder or absolute)', '');
          if (!raw) return;
          target = resolveTarget(raw);
          if (!target) { notify('Open a folder first, or use a full path'); return; }
        }
        file.fsRoot = target.root; file.handle = makeNativeHandle(target.root, target.rel);
        file.name = target.rel; file.language = languageFor(target.rel.split('/').pop());
      }
      await writeToHandle(file.handle, file.value);
      file.dirty = false;
      renderFiles();
    } catch (error) { notify(`Save failed: ${error.message || error}`); }
  }
  async function writeToHandle(handle, value) {
    if (handle.nativeWrite) return handle.nativeWrite(value);
    const writable = await handle.createWritable();
    await writable.write(value);
    await writable.close();
  }
  async function saveActive() {
    if (!active) return;
    if (shellAvailable()) return saveNative(active);
    try {
      if (!active.handle && typeof window.showSaveFilePicker === 'function') {
        active.handle = await window.showSaveFilePicker({ suggestedName: active.name.split('/').pop() });
      }
      if (active.handle) {
        await writeToHandle(active.handle, active.value);
        active.dirty = false;
        renderFiles();
        return;
      }
    } catch (error) {
      if (error && error.name === 'AbortError') return;
      console.warn('Direct save failed, falling back to download', error);
    }
    const blob = new Blob([active.value], { type: 'text/plain;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = active.name.split('/').pop();
    link.click();
    URL.revokeObjectURL(link.href);
    active.dirty = false;
    renderFiles();
  }
  async function saveAll() {
    const current = active;
    for (const file of files.filter((item) => item.dirty && item.handle)) {
      try { await writeToHandle(file.handle, file.value); file.dirty = false; } catch (error) { console.warn('Save failed for', file.name, error); }
    }
    active = current;
    renderFiles();
  }
  function openQuickPick() {
    closeAllMenus();
    paletteMode = 'files';
    paletteInput.placeholder = 'Search files by name';
    paletteInput.value = '';
    renderPaletteList('');
    commandPalette.hidden = false;
    paletteInput.focus();
  }
  function createFallback() {
    fallback = document.createElement('textarea');
    fallback.className = 'ide-editor-fallback';
    fallback.spellcheck = false;
    fallback.value = active ? active.value : '';
    fallback.addEventListener('input', () => changed(fallback.value));
    mount.replaceChildren(fallback);
  }
  function createEditor() {
    if (!window.monaco) return createFallback();
    if (fallback) { fallback.remove(); fallback = null; }
    window.monaco.editor.defineTheme('modapp-black', { base: 'vs-dark', inherit: true, rules: [], colors: {
      'editor.background': '#000000', 'editorGutter.background': '#000000', 'minimap.background': '#000000',
      'editor.lineHighlightBackground': '#0d0d0d', 'editorWidget.background': '#0a0a0a', 'scrollbarSlider.background': '#ffffff18',
      'editorIndentGuide.background1': '#1a1a1a', 'editorLineNumber.foreground': '#555555' } });
    editor = window.monaco.editor.create(mount, { value: active ? active.value : '', language: active ? active.language : 'javascript', theme: 'modapp-black', automaticLayout: true, minimap: { enabled: true }, fontSize: 13, lineHeight: 21, padding: { top: 16 }, scrollBeyondLastLine: false, tabSize: 2 });
    editor.onDidChangeModelContent(() => changed(editor.getValue()));
    editor.onDidChangeCursorPosition((event) => { container.querySelector('[data-cursor]').textContent = `Ln ${event.position.lineNumber}, Col ${event.position.column}`; });
  }
  function loadMonaco() {
    if (window.monaco) return createEditor();
    if (!window.__ideMonacoLoad) {
      window.__ideMonacoLoad = new Promise((resolve, reject) => {
        const base = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs';
        const loader = document.createElement('script');
        loader.src = `${base}/loader.js`;
        loader.onload = () => { window.require.config({ paths: { vs: base } }); window.require(['vs/editor/editor.main'], resolve, reject); };
        loader.onerror = () => { window.__ideMonacoLoad = null; reject(new Error('Monaco failed to load')); };
        document.head.appendChild(loader);
      });
    }
    window.__ideMonacoLoad.then(() => { if (!editor) createEditor(); }, () => { if (!editor && !fallback) createFallback(); });
    setTimeout(() => { if (!editor && !fallback) createFallback(); }, 3500);
  }
  // --- xterm.js terminal ---------------------------------------------
  let term;
  let fitAddon;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      const amd = window.define && window.define.amd;
      if (amd) window.define.amd = undefined;
      const restore = () => { if (amd && window.define) window.define.amd = amd; };
      script.onload = () => { restore(); resolve(); };
      script.onerror = () => { restore(); reject(new Error(`Failed to load ${src}`)); };
      document.head.appendChild(script);
    });
  }
  function ensureXtermStyles() {
    if (document.querySelector('link[data-ide-xterm-css]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'http://localhost:1430/mods/ide/vendor/xterm.css';
    link.dataset.ideXtermCss = 'true';
    document.head.appendChild(link);
  }
  let ptySession = null;
  let currentShell = lsGet('ide.shell');
  const shellSelect = container.querySelector('[data-shell-select]');

  async function stopTerminalSession() {
    const old = ptySession;
    ptySession = null;
    if (old) await old.close();
  }
  async function startTerminalSession(shellId) {
    await stopTerminalSession();
    term.reset();
    let mine = null;
    try {
      mine = await ModAPI.ide.pty.open({
        shell: shellId,
        cols: term.cols,
        rows: term.rows,
        cwd: workspaceRoot,
        onData: (data) => term.write(data),
        onExit: (code) => {
          if (!mine || ptySession !== mine) return;
          ptySession = null;
          mine.close();
          term.write(`\r\n[Process exited with code ${code}. Press any key to restart.]\r\n`);
        },
      });
      ptySession = mine;
    } catch (error) {
      term.write(`\r\n${error && error.message ? error.message : error}\r\n`);
    }
  }
  function sendToTerminal(text) {
    if (ptySession) ModAPI.ide.pty.write(ptySession.session, text).catch(() => {});
  }
  function clearTerminal() { term.clear(); }
  function newTerminalSession() { startTerminalSession(currentShell); }
  function fitTerminal() { if (fitAddon) { try { fitAddon.fit(); } catch { /* mount not visible yet */ } } }
  async function initTerminal() {
    ensureXtermStyles();
    if (!window.Terminal) await loadScript('http://localhost:1430/mods/ide/vendor/xterm.js');
    if (!window.FitAddon) await loadScript('http://localhost:1430/mods/ide/vendor/addon-fit.js');
    const TerminalCtor = typeof window.Terminal === 'function' ? window.Terminal : window.Terminal && window.Terminal.Terminal;
    const FitCtor = typeof window.FitAddon === 'function' ? window.FitAddon : window.FitAddon && window.FitAddon.FitAddon;
    if (!TerminalCtor) throw new Error('xterm.js did not expose a Terminal constructor');
    term = new TerminalCtor({
      fontFamily: 'ui-monospace, "Cascadia Mono", "SF Mono", Consolas, monospace',
      fontSize: 13,
      cursorBlink: true,
      allowProposedApi: true,
      theme: { background: '#000000', foreground: '#cccccc', cursor: '#cccccc', selectionBackground: '#264f78' },
    });
    fitAddon = new FitCtor();
    term.loadAddon(fitAddon);
    term.open(termMount);
    fitTerminal();
    term.onData((data) => { if (ptySession) sendToTerminal(data); else newTerminalSession(); });
    term.onResize(({ cols, rows }) => { if (ptySession) ModAPI.ide.pty.resize(ptySession.session, cols, rows).catch(() => {}); });
    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true;
      const ctrl = event.ctrlKey || event.metaKey;
      if (ctrl && event.key === '`') return false; // let the IDE toggle the panel
      if (ctrl && event.shiftKey && event.key.toLowerCase() === 'c') { navigator.clipboard.writeText(term.getSelection()); return false; }
      if (ctrl && event.shiftKey && event.key.toLowerCase() === 'v') { navigator.clipboard.readText().then((text) => term.paste(text)); return false; }
      if (ctrl && !event.shiftKey && event.key.toLowerCase() === 'c' && term.hasSelection()) { navigator.clipboard.writeText(term.getSelection()); return false; }
      return true;
    });
    termMount.addEventListener('click', () => term.focus());
    new ResizeObserver(() => fitTerminal()).observe(termMount);

    let shells = [];
    try { shells = await ModAPI.ide.pty.shells(); } catch (error) { term.write(`${error && error.message ? error.message : error}\r\n`); return; }
    shellSelect.innerHTML = shells.map((shell) => `<option value="${ideEscape(shell.id)}">${ideEscape(shell.label)}</option>`).join('');
    if (!shells.some((shell) => shell.id === currentShell)) currentShell = shells[0] && shells[0].id;
    shellSelect.value = currentShell || '';
    shellSelect.addEventListener('change', () => { currentShell = shellSelect.value; lsSet('ide.shell', currentShell); newTerminalSession(); term.focus(); });
    await startTerminalSession(currentShell);
    term.focus();
  }

  function openContextMenu(event, path) {
    contextMenu.hidden = false;
    contextMenu.style.left = `${event.clientX}px`;
    contextMenu.style.top = `${event.clientY}px`;
    contextMenu.dataset.target = path;
  }
  function closeContextMenu() { contextMenu.hidden = true; }
  contextMenu.addEventListener('click', (event) => {
    const action = event.target.dataset.menuAction;
    const target = contextMenu.dataset.target;
    if (!action || !target) return;
    if (action === 'close') closeFile(target);
    else if (action === 'close-others') closeOthers(target);
    else if (action === 'close-all') closeAll();
    closeContextMenu();
  });
  document.addEventListener('click', (event) => { if (!contextMenu.contains(event.target)) closeContextMenu(); });

  function cycleTabs(direction) {
    const open = files.filter((file) => file.open);
    if (open.length < 2) return;
    const index = open.indexOf(active);
    const next = open[(index + direction + open.length) % open.length];
    selectFile(next.name);
  }

  function setSidebarCollapsed(collapsed) {
    container.querySelector('.ide-grid').classList.toggle('sidebar-collapsed', collapsed);
    const explorerButton = activityItems.find((item) => item.dataset.activity === 'explorer');
    if (explorerButton) explorerButton.classList.toggle('active', !collapsed);
  }
  function toggleSidebar() {
    const grid = container.querySelector('.ide-grid');
    setSidebarCollapsed(!grid.classList.contains('sidebar-collapsed'));
  }
  function setTerminalCollapsed(collapsed) {
    container.querySelector('.ide-main').classList.toggle('terminal-collapsed', collapsed);
    const terminalButton = activityItems.find((item) => item.dataset.activity === 'terminal');
    if (terminalButton) terminalButton.classList.toggle('active', !collapsed);
  }
  function toggleTerminal() {
    const main = container.querySelector('.ide-main');
    const collapsing = !main.classList.contains('terminal-collapsed');
    setTerminalCollapsed(collapsing);
    if (!collapsing) setTimeout(fitTerminal, 0);
  }
  function toggleMinimap() {
    if (!editor) return;
    minimapEnabled = !minimapEnabled;
    editor.updateOptions({ minimap: { enabled: minimapEnabled } });
  }
  function undoEdit() {
    if (editor) editor.trigger('menu', 'undo', null);
    else if (fallback) document.execCommand('undo');
  }
  function redoEdit() {
    if (editor) editor.trigger('menu', 'redo', null);
    else if (fallback) document.execCommand('redo');
  }
  function findInEditor() {
    if (editor) editor.getAction('actions.find')?.run();
    else if (fallback) fallback.focus();
  }

  const COMMANDS = [
    { id: 'new-file', label: 'File: New File', shortcut: 'Ctrl+N', run: newFile },
    { id: 'open-file', label: 'File: Open File...', shortcut: 'Ctrl+O', run: openFileNative },
    { id: 'open-folder', label: 'File: Open Folder...', run: openFolderNative },
    { id: 'save', label: 'File: Save', shortcut: 'Ctrl+S', run: saveActive },
    { id: 'close-folder', label: 'File: Close Folder', run: closeFolder },
    { id: 'toggle-autosave', label: 'File: Toggle Auto Save', run: () => { autoSave = !autoSave; notify(`Auto Save ${autoSave ? 'on' : 'off'}`); } },
    { id: 'save-all', label: 'File: Save All', shortcut: 'Ctrl+Shift+S', run: saveAll },
    { id: 'close-editor', label: 'View: Close Editor', shortcut: 'Ctrl+W', run: () => active && closeFile(active.name) },
    { id: 'close-all', label: 'View: Close All Editors', run: closeAll },
    { id: 'undo', label: 'Edit: Undo', shortcut: 'Ctrl+Z', run: undoEdit },
    { id: 'redo', label: 'Edit: Redo', shortcut: 'Ctrl+Y', run: redoEdit },
    { id: 'find', label: 'Edit: Find', shortcut: 'Ctrl+F', run: findInEditor },
    { id: 'command-palette', label: 'View: Command Palette', shortcut: 'Ctrl+Shift+P', run: () => openCommandPalette() },
    { id: 'toggle-sidebar', label: 'View: Toggle Explorer', shortcut: 'Ctrl+B', run: toggleSidebar },
    { id: 'toggle-terminal', label: 'View: Toggle Terminal', shortcut: 'Ctrl+`', run: toggleTerminal },
    { id: 'toggle-minimap', label: 'View: Toggle Minimap', run: toggleMinimap },
    { id: 'new-terminal', label: 'Terminal: New Terminal', run: newTerminalSession },
    { id: 'clear-terminal', label: 'Terminal: Clear', run: clearTerminal },
    { id: 'run-file', label: 'Terminal: Run Active File', run: () => active && sendToTerminal(`node --check "${active.name}"\r`) },
  ];
  function runCommandById(id) {
    const command = COMMANDS.find((item) => item.id === id);
    if (command) command.run();
  }
  let paletteMode = 'commands';
  function openCommandPalette() {
    closeAllMenus();
    paletteMode = 'commands';
    paletteInput.placeholder = 'Type a command...';
    paletteInput.value = '';
    renderPaletteList('');
    commandPalette.hidden = false;
    paletteInput.focus();
  }
  function closeCommandPalette() { if (pathResolver) { finishPath(null); return; } commandPalette.hidden = true; }
  function renderPaletteList(query) {
    if (paletteMode === 'path') return;
    const q = query.toLowerCase();
    if (paletteMode === 'files') {
      const matches = files.filter((file) => file.name.toLowerCase().includes(q)).slice(0, 50);
      paletteList.innerHTML = matches.length
        ? matches.map((file, index) => {
            const parts = file.name.split('/');
            const dir = parts.slice(0, -1).join('/');
            return `<button class="ide-command-item${index === 0 ? ' active' : ''}" data-file-pick="${ideEscape(file.name)}">${ideEscape(parts[parts.length - 1])}<span class="ide-command-shortcut">${ideEscape(dir)}</span></button>`;
          }).join('')
        : '<div class="ide-command-empty">No matching files</div>';
      paletteList.querySelectorAll('[data-file-pick]').forEach((button) => button.addEventListener('click', () => { selectFile(button.dataset.filePick); closeCommandPalette(); }));
      return;
    }
    const matches = COMMANDS.filter((command) => command.label.toLowerCase().includes(q));
    paletteList.innerHTML = matches.length
      ? matches.map((command, index) => `<button class="ide-command-item${index === 0 ? ' active' : ''}" data-command-id="${command.id}">${ideEscape(command.label)}${command.shortcut ? `<span class="ide-command-shortcut">${ideEscape(command.shortcut)}</span>` : ''}</button>`).join('')
      : '<div class="ide-command-empty">No matching commands</div>';
    paletteList.querySelectorAll('[data-command-id]').forEach((button) => button.addEventListener('click', () => { runCommandById(button.dataset.commandId); closeCommandPalette(); }));
  }
  function paletteItems() { return [...paletteList.querySelectorAll('.ide-command-item')]; }
  function movePaletteSelection(delta) {
    const items = paletteItems(); if (!items.length) return;
    const current = Math.max(0, items.findIndex((item) => item.classList.contains('active')));
    items[current].classList.remove('active');
    const next = items[(current + delta + items.length) % items.length];
    next.classList.add('active'); next.scrollIntoView({ block: 'nearest' });
  }
  paletteInput.addEventListener('input', () => renderPaletteList(paletteInput.value));
  paletteInput.addEventListener('keydown', (event) => {
    if (paletteMode === 'path') {
      if (event.key === 'Enter') { event.preventDefault(); finishPath(paletteInput.value); }
      if (event.key === 'Escape') finishPath(null);
      return;
    }
    if (event.key === 'Escape') { closeCommandPalette(); }
    if (event.key === 'ArrowDown') { event.preventDefault(); movePaletteSelection(1); }
    if (event.key === 'ArrowUp') { event.preventDefault(); movePaletteSelection(-1); }
    if (event.key === 'Enter') {
      const item = paletteItems().find((el) => el.classList.contains('active')) || paletteItems()[0];
      if (item) item.click();
    }
  });
  document.addEventListener('click', (event) => { if (!commandPalette.hidden && !commandPalette.contains(event.target)) closeCommandPalette(); });

  const menus = [...container.querySelectorAll('[data-menu]')];
  function closeAllMenus() { menus.forEach((menu) => { menu.querySelector('[data-menu-dropdown]').hidden = true; }); }
  menus.forEach((menu) => {
    const trigger = menu.querySelector('[data-menu-trigger]');
    const dropdown = menu.querySelector('[data-menu-dropdown]');
    trigger.addEventListener('click', (event) => {
      event.stopPropagation();
      const wasOpen = !dropdown.hidden;
      closeAllMenus();
      dropdown.hidden = wasOpen;
    });
    dropdown.querySelectorAll('[data-command-id]').forEach((button) => {
      button.addEventListener('click', () => { runCommandById(button.dataset.commandId); closeAllMenus(); });
    });
  });
  document.addEventListener('click', () => closeAllMenus());
  emptyState.querySelectorAll('[data-command-id]').forEach((button) => button.addEventListener('click', () => runCommandById(button.dataset.commandId)));

  activityItems.forEach((button) => {
    button.addEventListener('click', () => {
      const activity = button.dataset.activity;
      if (activity === 'explorer') toggleSidebar();
      else if (activity === 'search') openQuickPick();
      else if (activity === 'terminal') toggleTerminal();
    });
  });

  container.querySelector('[data-action="focus"]')?.addEventListener('click', () => term && term.focus());
  container.querySelector('[data-action="run"]').addEventListener('click', () => active && sendToTerminal(`node --check "${active.name}"\r`));
  container.querySelector('[data-action="open-file"]').addEventListener('click', openFileNative);
  container.querySelector('[data-action="open-folder"]').addEventListener('click', openFolderNative);
  container.querySelector('[data-action="new"]').addEventListener('click', newFile);
  fileInput.addEventListener('change', () => { importFiles([...fileInput.files]); fileInput.value = ''; });
  folderInput.addEventListener('change', () => { importFiles([...folderInput.files]); folderInput.value = ''; });
  treeRoot.addEventListener('click', () => {
    const collapsed = fileList.hasAttribute('hidden');
    if (collapsed) fileList.removeAttribute('hidden'); else fileList.setAttribute('hidden', '');
    treeRoot.querySelector('.ide-tree-chevron').textContent = collapsed ? 'expand_more' : 'chevron_right';
    
    // Update the root folder expanded state
    if (fileTree.length > 0) {
      fileTree[0].expanded = !collapsed;
    }
  });
  container.addEventListener('keydown', (event) => {
    const key = event.key.toLowerCase();
    const mod = event.ctrlKey || event.metaKey;
    if (mod && event.shiftKey && key === 'p') { event.preventDefault(); openCommandPalette(); return; }
    if (mod && key === 'p') { event.preventDefault(); openQuickPick(); return; }
    if (mod && key === 's') { event.preventDefault(); if (event.shiftKey) saveAll(); else saveActive(); return; }
    if (mod && key === 'w') { event.preventDefault(); if (active) closeFile(active.name); return; }
    if (mod && key === 'n') { event.preventDefault(); newFile(); return; }
    if (mod && key === 'o') { event.preventDefault(); openFileNative(); return; }
    if (mod && key === 'b') { event.preventDefault(); toggleSidebar(); return; }
    if (mod && key === '`') { event.preventDefault(); toggleTerminal(); return; }
    if (mod && key === 'w') { event.preventDefault(); active && closeFile(active.name); return; }
    if (mod && key === 'tab') { event.preventDefault(); cycleTabs(event.shiftKey ? -1 : 1); return; }
  });
  files[0].open = true;
  files[1].open = true;
  buildFileTree();
  renderFiles();
  initTerminal().catch((error) => console.warn('[IDE] terminal init failed', error)).finally(loadMonaco);
}

ModAPI.registerTab({ id: 'ide', label: 'IDE', icon: 'terminal', render: renderIde });