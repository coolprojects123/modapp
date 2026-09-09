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
      <header class="ide-header">
        <div class="ide-brand"><span class="ide-kicker">MODAPP WORKSPACE</span><h1>IDE</h1></div>
        <div class="ide-header-actions"><span class="ide-branch"><span class="material-symbols-outlined">account_tree</span> mods</span><button class="ide-icon-button" data-action="focus" title="Focus terminal"><span class="material-symbols-outlined">search</span></button><button class="ide-run-button" data-action="run"><span class="material-symbols-outlined">play_arrow</span>Run</button></div>
      </header>
      <div class="ide-toolbar"><span class="ide-breadcrumb"><span class="material-symbols-outlined">folder_open</span> mods <span>/</span> <strong data-breadcrumb>scratch.js</strong></span><span class="ide-sync"><span class="material-symbols-outlined">cloud_done</span> local workspace</span></div>
      <div class="ide-grid">
        <aside class="ide-files"><div class="ide-sidebar-heading"><span>Explorer</span><div class="ide-explorer-actions"><button class="ide-icon-button" data-action="open-file" title="Open file"><span class="material-symbols-outlined">note_add</span></button><button class="ide-icon-button" data-action="open-folder" title="Open folder"><span class="material-symbols-outlined">create_new_folder</span></button><button class="ide-icon-button" data-action="new" title="New file"><span class="material-symbols-outlined">add</span></button></div></div><div class="ide-tree-root"><span class="material-symbols-outlined">expand_more</span><span class="material-symbols-outlined folder-icon">folder</span> mods</div><div class="ide-file-list"></div><div class="ide-sidebar-footer"><span class="material-symbols-outlined">info</span> Local mod workspace</div><input class="ide-hidden-input" data-file-input type="file" multiple><input class="ide-hidden-input" data-folder-input type="file" webkitdirectory multiple></aside>
        <section class="ide-editor-panel"><div class="ide-tabs"></div><div class="ide-editor-mount"></div><footer class="ide-statusbar"><span><span class="material-symbols-outlined">code</span><strong data-language>JavaScript</strong></span><span>Spaces: 2</span><span>UTF-8</span><span data-cursor>Ln 1, Col 1</span></footer></section>
        <section class="ide-terminal-panel"><div class="ide-panel-bar"><span><span class="material-symbols-outlined">terminal</span> Terminal</span><span class="ide-status"><span class="ide-live-dot"></span> native bash</span></div><pre class="ide-output"><span class="ide-output-muted">modapp terminal</span>\nReady in <span class="ide-output-accent">mods/</span>\nType a command below.</pre><form class="ide-command-form"><span class="ide-prompt">$</span><input class="ide-command" autocomplete="off" spellcheck="false" placeholder="run a command..."><button class="ide-send" title="Run command"><span class="material-symbols-outlined">arrow_upward</span></button></form></section>
      </div>
    </div>`;

  const files = IDE_FILES.map((file) => ({ ...file }));
  let active = files[0];
  let editor;
  let fallback;
  const fileList = container.querySelector('.ide-file-list');
  const tabs = container.querySelector('.ide-tabs');
  const mount = container.querySelector('.ide-editor-mount');
  const output = container.querySelector('.ide-output');
  const input = container.querySelector('.ide-command');
  const fileInput = container.querySelector('[data-file-input]');
  const folderInput = container.querySelector('[data-folder-input]');

  function fileIcon(file) { return file.language === 'json' ? 'data_object' : file.language === 'markdown' ? 'article' : 'javascript'; }
  function renderFiles() {
    fileList.innerHTML = files.map((file) => `<button class="ide-file${file === active ? ' active' : ''}" data-file="${ideEscape(file.name)}"><span class="material-symbols-outlined">${fileIcon(file)}</span>${ideEscape(file.name)}${file.dirty ? '<span class="ide-dirty-dot"></span>' : ''}</button>`).join('');
    tabs.innerHTML = files.filter((file) => file.open).map((file) => `<button class="ide-tab${file === active ? ' active' : ''}" data-file="${ideEscape(file.name)}"><span class="material-symbols-outlined">${fileIcon(file)}</span>${ideEscape(file.name)}<span class="ide-tab-close" data-close="${ideEscape(file.name)}">close</span></button>`).join('');
    fileList.querySelectorAll('[data-file]').forEach((button) => button.addEventListener('click', () => selectFile(button.dataset.file)));
    tabs.querySelectorAll('[data-file]').forEach((button) => button.addEventListener('click', () => selectFile(button.dataset.file)));
    tabs.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', (event) => { event.stopPropagation(); closeFile(button.dataset.close); }));
  }
  function selectFile(name) {
    const next = files.find((file) => file.name === name);
    if (!next) return;
    active.open = true;
    active = next;
    container.querySelector('[data-breadcrumb]').textContent = next.name;
    container.querySelector('[data-language]').textContent = next.language === 'javascript' ? 'JavaScript' : next.language[0].toUpperCase() + next.language.slice(1);
    renderFiles();
    if (editor) editor.setValue(next.value);
    else if (fallback) fallback.value = next.value;
  }
  function closeFile(name) {
    const file = files.find((item) => item.name === name);
    if (!file || files.filter((item) => item.open).length < 2) return;
    file.open = false;
    if (file === active) selectFile(files.find((item) => item.open).name);
    renderFiles();
  }
  function changed(value) { active.value = value; active.dirty = true; renderFiles(); }
  function languageFor(name) { const extension = name.split('.').pop().toLowerCase(); return extension === 'json' ? 'json' : extension === 'md' ? 'markdown' : extension === 'css' ? 'css' : extension === 'html' ? 'html' : 'javascript'; }
  async function importFiles(selectedFiles) {
    for (const selected of selectedFiles) {
      const name = selected.webkitRelativePath || selected.name;
      if (files.some((file) => file.name === name)) continue;
      files.push({ name, language: languageFor(name), value: await selected.text(), open: true, dirty: false, imported: true });
    }
    if (files.length) selectFile(files[files.length - 1].name);
  }
  function saveActive() {
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
    fallback.value = active.value;
    fallback.addEventListener('input', () => changed(fallback.value));
    mount.replaceChildren(fallback);
  }
  function createEditor() {
    if (!window.monaco) return createFallback();
    editor = window.monaco.editor.create(mount, { value: active.value, language: active.language, theme: 'vs-dark', automaticLayout: true, minimap: { enabled: true }, fontSize: 13, lineHeight: 21, padding: { top: 16 }, scrollBeyondLastLine: false, tabSize: 2 });
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
  function appendOutput(text, className = '') { const line = document.createElement('span'); line.className = className; line.textContent = text; output.append('\n', line); output.scrollTop = output.scrollHeight; }
  async function runCommand(command) { if (!command.trim()) return; appendOutput(`$ ${command}`, 'ide-output-command'); input.value = ''; try { const result = await ModAPI.ide.runCommand(command); appendOutput(result.stdout || result.stderr || `(exit ${result.code})`, result.code ? 'ide-output-error' : ''); } catch (error) { appendOutput(error.message, 'ide-output-error'); } }

  container.querySelector('.ide-command-form').addEventListener('submit', (event) => { event.preventDefault(); runCommand(input.value); });
  container.querySelector('[data-action="focus"]').addEventListener('click', () => input.focus());
  container.querySelector('[data-action="run"]').addEventListener('click', () => runCommand(`node --check ${active.name}`));
  container.querySelector('[data-action="open-file"]').addEventListener('click', () => fileInput.click());
  container.querySelector('[data-action="open-folder"]').addEventListener('click', () => folderInput.click());
  container.querySelector('[data-action="new"]').addEventListener('click', () => { const file = { name: `untitled-${files.length + 1}.js`, language: 'javascript', value: '// New mod file\n', open: true, dirty: true }; files.push(file); selectFile(file.name); });
  fileInput.addEventListener('change', () => { importFiles([...fileInput.files]); fileInput.value = ''; });
  folderInput.addEventListener('change', () => { importFiles([...folderInput.files]); folderInput.value = ''; });
  container.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'p') { event.preventDefault(); openQuickPick(); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); saveActive(); }
  });
  files[0].open = true;
  files[1].open = true;
  renderFiles();
  loadMonaco();
}

ModAPI.registerTab({ id: 'ide', label: 'IDE', icon: 'terminal', render: renderIde });
