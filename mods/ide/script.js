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
      <header class="ide-header">
        <div class="ide-brand"><span class="ide-kicker">MODAPP WORKSPACE</span><h1>IDE</h1></div>
        <div class="ide-header-actions"><span class="ide-branch"><span class="material-symbols-outlined">account_tree</span> mods</span><button class="ide-icon-button" data-action="focus" title="Focus terminal"><span class="material-symbols-outlined">search</span></button><button class="ide-run-button" data-action="run"><span class="material-symbols-outlined">play_arrow</span>Run</button></div>
      </header>
      <div class="ide-toolbar"><span class="ide-breadcrumb"><span class="material-symbols-outlined">folder_open</span> mods <span>/</span> <strong data-breadcrumb>scratch.js</strong></span><span class="ide-sync"><span class="material-symbols-outlined">cloud_done</span> local workspace</span></div>
      <div class="ide-grid">
        <div class="ide-activitybar">
          <button class="ide-activity-item active" data-activity="explorer" title="Explorer"><span class="material-symbols-outlined">description</span></button>
          <button class="ide-activity-item" data-activity="search" title="Search"><span class="material-symbols-outlined">search</span></button>
          <div class="ide-activity-spacer"></div>
          <button class="ide-activity-item" data-activity="terminal" title="Toggle Terminal"><span class="material-symbols-outlined">terminal</span></button>
        </div>
        <aside class="ide-files"><div class="ide-sidebar-heading"><span>Explorer</span><div class="ide-explorer-actions"><button class="ide-icon-button" data-action="open-file" title="Open file"><span class="material-symbols-outlined">note_add</span></button><button class="ide-icon-button" data-action="open-folder" title="Open folder"><span class="material-symbols-outlined">create_new_folder</span></button><button class="ide-icon-button" data-action="new" title="New file"><span class="material-symbols-outlined">add</span></button></div></div><button class="ide-tree-root" data-action="toggle-tree"><span class="material-symbols-outlined ide-tree-chevron">expand_more</span><span class="material-symbols-outlined folder-icon">folder</span> mods</button><div class="ide-file-list"></div><div class="ide-sidebar-footer"><span class="material-symbols-outlined">info</span> Local mod workspace</div><input class="ide-hidden-input" data-file-input type="file" multiple><input class="ide-hidden-input" data-folder-input type="file" webkitdirectory multiple></aside>
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
            <footer class="ide-statusbar"><span><span class="material-symbols-outlined">code</span><strong data-language>JavaScript</strong></span><span>Spaces: 2</span><span>UTF-8</span><span data-cursor>Ln 1, Col 1</span></footer>
          </section>
          <section class="ide-terminal-panel"><div class="ide-panel-bar"><span><span class="material-symbols-outlined">terminal</span> Terminal</span><span class="ide-status"><span class="ide-live-dot"></span> native bash</span></div><div class="ide-term-mount"></div></section>
        </div>
      </div>
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
  let fileTree = [{ type: 'folder', name: 'mods', path: 'mods', children: [], expanded: true }];
  
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
          <button class="ide-tree-toggle" data-action="toggle" data-path="${ideEscape(node.path)}">
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
        <button class="ide-tree-node file ${isActive ? 'active' : ''}" data-file="${ideEscape(node.path)}" style="padding-left: ${depth * 16 + 32}px">
          <span class="material-symbols-outlined">${fileIcon(node)}</span>
          <span class="ide-tree-label">${ideEscape(node.name.split('/').pop())}</span>${dirty}
        </button>`;
    }
  }
  
  function renderFiles() {
    // Rebuild tree from files
    buildFileTree();
    
    // Render tree
    fileList.innerHTML = fileTree.map(node => renderTreeNode(node, 0)).join('');
    
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
    container.querySelector('[data-breadcrumb]').textContent = next.name.split('/').pop();
    container.querySelector('[data-language]').textContent = next.language === 'javascript' ? 'JavaScript' : next.language[0].toUpperCase() + next.language.slice(1);
    renderFiles();
    if (editor) editor.setValue(next.value);
    else if (fallback) fallback.value = next.value;
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
    if (file.dirty && !skipConfirm && !window.confirm(`${file.name.split('/').pop()} has unsaved changes. Close anyway?`)) return;
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
  function changed(value) { if (!active) return; active.value = value; active.dirty = true; renderFiles(); }
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
    fileTree = [{ type: 'folder', name: 'mods', path: 'mods', children: [], expanded: true }];
    fileTreeMap.clear();
    fileTreeMap.set('mods', fileTree[0]);
    
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
  function saveActive() {
    if (!active) return;
    const blob = new Blob([active.value], { type: 'text/plain;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = active.name.split('/').pop();
    link.click();
    URL.revokeObjectURL(link.href);
    active.dirty = false;
    renderFiles();
  }
  function openQuickPick() {
    const query = window.prompt('Quick Open', '');
    if (query === null) return;
    const match = files.find((file) => file.name.toLowerCase().includes(query.toLowerCase()));
    if (match) selectFile(match.name);
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
    editor = window.monaco.editor.create(mount, { value: active ? active.value : '', language: active ? active.language : 'javascript', theme: 'vs-dark', automaticLayout: true, minimap: { enabled: true }, fontSize: 13, lineHeight: 21, padding: { top: 16 }, scrollBeyondLastLine: false, tabSize: 2 });
    editor.onDidChangeModelContent(() => changed(editor.getValue()));
    editor.onDidChangeCursorPosition((event) => { container.querySelector('[data-cursor]').textContent = `Ln ${event.position.lineNumber}, Col ${event.position.column}`; });
  }
  function loadMonaco() {
    if (window.monaco) return createEditor();
    const loader = document.createElement('script');
    loader.src = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs/loader.js';
    loader.onload = () => { window.require.config({ paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs' } }); window.require(['vs/editor/editor.main'], createEditor, createFallback); };
    loader.onerror = createFallback;
    document.head.appendChild(loader);
    setTimeout(() => { if (!editor && !fallback) createFallback(); }, 3500);
  }
  // --- xterm.js terminal ---------------------------------------------
  let term;
  let fitAddon;
  let lineBuffer = '';

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`Failed to load ${src}`));
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
  function writePrompt() { term.write('\r\n$ '); }
  function writeBanner() {
    term.writeln('modapp terminal');
    term.writeln('Ready in mods/');
    writePrompt();
  }
  function handleTermData(data) {
    if (data === '\r') {
      const command = lineBuffer;
      lineBuffer = '';
      term.write('\r\n');
      runCommand(command);
      return;
    }
    if (data === '\u007f') {
      if (lineBuffer.length) { lineBuffer = lineBuffer.slice(0, -1); term.write('\b \b'); }
      return;
    }
    if (data === '\u0003') { // Ctrl+C
      lineBuffer = '';
      term.write('^C');
      writePrompt();
      return;
    }
    if (data.charCodeAt(0) < 32) return; // ignore other control chars
    lineBuffer += data;
    term.write(data);
  }
  async function runCommand(command) {
    if (!command.trim()) { writePrompt(); return; }
    try {
      const result = await ModAPI.ide.runCommand(command);
      const text = (result.stdout || result.stderr || `(exit ${result.code})`).replace(/\n/g, '\r\n');
      term.write(text.endsWith('\r\n') ? text : `${text}\r\n`);
    } catch (error) {
      term.write(`${error.message}\r\n`);
    }
    writePrompt();
  }
  function clearTerminal() {
    term.reset();
    term.writeln('Terminal cleared');
    writePrompt();
  }
  function newTerminalSession() {
    lineBuffer = '';
    term.reset();
    writeBanner();
  }
  function fitTerminal() { if (fitAddon) { try { fitAddon.fit(); } catch { /* mount not visible yet */ } } }
  async function initTerminal() {
    ensureXtermStyles();
    if (!window.Terminal) await loadScript('http://localhost:1430/mods/ide/vendor/xterm.js');
    if (!window.FitAddon) await loadScript('http://localhost:1430/mods/ide/vendor/addon-fit.js');
    term = new window.Terminal({
      convertEol: true,
      fontFamily: 'ui-monospace, "SF Mono", monospace',
      fontSize: 13,
      cursorBlink: true,
      theme: { background: '#1e1e1e', foreground: '#cccccc', cursor: '#cccccc', selectionBackground: '#264f78' },
    });
    fitAddon = new window.FitAddon.FitAddon();
    term.loadAddon(fitAddon);
    term.open(termMount);
    fitTerminal();
    writeBanner();
    term.onData(handleTermData);
    termMount.addEventListener('click', () => term.focus());
    window.addEventListener('resize', fitTerminal);
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
    { id: 'open-file', label: 'File: Open File...', shortcut: 'Ctrl+O', run: () => fileInput.click() },
    { id: 'open-folder', label: 'File: Open Folder...', run: () => folderInput.click() },
    { id: 'save', label: 'File: Save', shortcut: 'Ctrl+S', run: saveActive },
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
    { id: 'run-file', label: 'Terminal: Run Active File', run: () => active && runCommand(`node --check ${active.name}`) },
  ];
  function runCommandById(id) {
    const command = COMMANDS.find((item) => item.id === id);
    if (command) command.run();
  }
  function openCommandPalette() {
    closeAllMenus();
    paletteInput.value = '';
    renderPaletteList('');
    commandPalette.hidden = false;
    paletteInput.focus();
  }
  function closeCommandPalette() { commandPalette.hidden = true; }
  function renderPaletteList(query) {
    const q = query.toLowerCase();
    const matches = COMMANDS.filter((command) => command.label.toLowerCase().includes(q));
    paletteList.innerHTML = matches.length
      ? matches.map((command, index) => `<button class="ide-command-item${index === 0 ? ' active' : ''}" data-command-id="${command.id}">${ideEscape(command.label)}${command.shortcut ? `<span class="ide-command-shortcut">${ideEscape(command.shortcut)}</span>` : ''}</button>`).join('')
      : '<div class="ide-command-empty">No matching commands</div>';
    paletteList.querySelectorAll('[data-command-id]').forEach((button) => button.addEventListener('click', () => { runCommandById(button.dataset.commandId); closeCommandPalette(); }));
  }
  paletteInput.addEventListener('input', () => renderPaletteList(paletteInput.value));
  paletteInput.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { closeCommandPalette(); }
    if (event.key === 'Enter') {
      const first = paletteList.querySelector('[data-command-id]');
      if (first) { runCommandById(first.dataset.commandId); closeCommandPalette(); }
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

  container.querySelector('[data-action="focus"]').addEventListener('click', () => term && term.focus());
  container.querySelector('[data-action="run"]').addEventListener('click', () => active && runCommand(`node --check ${active.name}`));
  container.querySelector('[data-action="open-file"]').addEventListener('click', () => fileInput.click());
  container.querySelector('[data-action="open-folder"]').addEventListener('click', () => folderInput.click());
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
    if (mod && key === 's') { event.preventDefault(); saveActive(); return; }
    if (mod && key === 'n') { event.preventDefault(); newFile(); return; }
    if (mod && key === 'o') { event.preventDefault(); fileInput.click(); return; }
    if (mod && key === 'b') { event.preventDefault(); toggleSidebar(); return; }
    if (mod && key === '`') { event.preventDefault(); toggleTerminal(); return; }
    if (mod && key === 'w') { event.preventDefault(); active && closeFile(active.name); return; }
    if (mod && key === 'tab') { event.preventDefault(); cycleTabs(event.shiftKey ? -1 : 1); return; }
  });
  files[0].open = true;
  files[1].open = true;
  buildFileTree();
  renderFiles();
  loadMonaco();
  initTerminal();
}

ModAPI.registerTab({ id: 'ide', label: 'IDE', icon: 'terminal', render: renderIde });