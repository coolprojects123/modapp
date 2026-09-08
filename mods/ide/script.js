function renderIde(container) {
  container.innerHTML = `
    <div class="ide-workspace">
      <header class="ide-header">
        <div>
          <span class="ide-kicker">Workspace</span>
          <h1>IDE</h1>
        </div>
        <span class="ide-path">mods/</span>
      </header>
      <div class="ide-grid">
        <aside class="ide-files">
          <div class="ide-panel-label">Files</div>
          <button class="ide-file active"><span class="material-symbols-outlined">description</span>scratch.js</button>
          <button class="ide-file"><span class="material-symbols-outlined">data_object</span>mod.json</button>
        </aside>
        <section class="ide-editor-panel">
          <div class="ide-panel-bar"><span>scratch.js</span><span class="ide-language">JavaScript</span></div>
          <textarea class="ide-editor" spellcheck="false">// Start shaping your mod.\n\nModAPI.registerTab({\n  id: 'hello',\n  label: 'Hello',\n  icon: 'code',\n  render(container) {\n    container.textContent = 'Hello from a mod';\n  },\n});</textarea>
        </section>
        <section class="ide-terminal-panel">
          <div class="ide-panel-bar"><span><span class="material-symbols-outlined">terminal</span> Bash</span><span class="ide-status">native shell</span></div>
          <pre class="ide-output" aria-live="polite">modapp shell\nType a command below.</pre>
          <form class="ide-command-form">
            <span class="ide-prompt">$</span>
            <input class="ide-command" autocomplete="off" spellcheck="false" placeholder="run a command...">
          </form>
        </section>
      </div>
    </div>
  `;

  const form = container.querySelector('.ide-command-form');
  const input = container.querySelector('.ide-command');
  const output = container.querySelector('.ide-output');
  const editor = container.querySelector('.ide-editor');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const command = input.value.trim();
    if (!command) return;
    output.textContent += `\n$ ${command}\n`;
    input.value = '';
    if (!ModAPI.ide?.runCommand) {
      output.textContent += 'Native shell is available in the desktop build.\n';
      return;
    }
    const result = await ModAPI.ide.runCommand(command);
    output.textContent += result.stdout || result.stderr || `(exit ${result.code})\n`;
    output.scrollTop = output.scrollHeight;
  });

  editor.addEventListener('keydown', (event) => {
    if (event.key === 'Tab') {
      event.preventDefault();
      const start = editor.selectionStart;
      editor.value = `${editor.value.slice(0, start)}  ${editor.value.slice(editor.selectionEnd)}`;
      editor.selectionStart = editor.selectionEnd = start + 2;
    }
  });
}

ModAPI.registerTab({
  id: 'ide',
  label: 'IDE',
  icon: 'terminal',
  render: renderIde,
});
