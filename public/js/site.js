// site.js — this is the bare site: a topbar with an iconic mark and wordmark
// below it. No tabs, no settings, nothing else is baked in. If a mod calls
// ModAPI.registerTab or ModAPI.registerWidget, this is what wires that
// registration into something visible (a nav button, a floating panel) —
// but it never assumes any exist.

(function () {
  const SITE_TITLE = 'modapp';

  function Icon(name, opts = {}) {
    const span = document.createElement('span');
    span.className = 'material-symbols-outlined';
    span.textContent = name;
    span.style.fontSize = opts.size || '18px';
    span.style.lineHeight = '1';
    span.style.userSelect = 'none';
    span.style.display = 'inline-flex';
    span.style.alignItems = 'center';
    span.style.justifyContent = 'center';
    if (opts.color) span.style.color = opts.color;
    if (opts.title) span.title = opts.title;
    return span;
  }
  window.Icon = Icon;

  function colorForId(id) {
    let hash = 0;
    for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
    return `hsl(${hash % 360}, 70%, 60%)`;
  }

  let activeTabId = null;
  const openWidgets = new Map();

  // ---------------- bare shell ----------------
  const app = document.getElementById('app');
  app.innerHTML = '';

  const topbar = document.createElement('div');
  topbar.className = 'topbar';

  const logoWrap = document.createElement('div');
  logoWrap.className = 'logo-wrap';
  const logoMark = document.createElement('div');
  logoMark.className = 'logo-mark';
  logoMark.textContent = 'M';
  const wordmark = document.createElement('div');
  wordmark.className = 'wordmark';
  wordmark.textContent = SITE_TITLE;
  logoWrap.append(logoMark, wordmark);

  const tabNav = document.createElement('div');
  tabNav.className = 'tab-nav'; // empty until a mod registers a tab

  const spacer = document.createElement('div');
  spacer.className = 'spacer';

  const widgetBar = document.createElement('div');
  widgetBar.className = 'widget-bar'; // empty until a mod registers a widget

  topbar.append(logoWrap, tabNav, spacer, widgetBar);

  const main = document.createElement('main');
  main.className = 'main';
  const content = document.createElement('div');
  content.className = 'content-panel'; // blank — nothing renders here by default
  content.id = 'content';
  main.appendChild(content);

  app.append(topbar, main);
  document.title = SITE_TITLE;

  function applyIdentity(identity) {
    wordmark.textContent = identity.title || SITE_TITLE;
    logoMark.replaceChildren();
    if (/^(https?:|file:|data:image\/)/i.test(identity.icon || '')) {
      const image = document.createElement('img');
      image.src = identity.icon;
      image.alt = `${identity.title || SITE_TITLE} icon`;
      logoMark.appendChild(image);
    } else {
      logoMark.textContent = identity.icon || 'M';
    }
    document.title = identity.title || SITE_TITLE;
  }

  document.addEventListener('mods:identity-changed', (event) => applyIdentity(event.detail));
  applyIdentity(window.ModAPI.identity);

  // ---------------- nav (mod-tabs only) ----------------
  function buildNav() {
    tabNav.innerHTML = '';
    for (const tab of window.ModAPI._tabs.values()) {
      const btn = document.createElement('button');
      btn.className = 'tab' + (tab.id === activeTabId ? ' active' : '');
      btn.dataset.id = tab.id;

      const dot = document.createElement('span');
      dot.className = 'connector';
      dot.style.background = colorForId(tab.source || tab.id);
      btn.appendChild(dot);

      btn.appendChild(Icon(tab.icon, { size: '16px' }));
      const label = document.createElement('span');
      label.textContent = tab.label;
      btn.appendChild(label);

      btn.addEventListener('click', () => activateTab(tab.id));
      tabNav.appendChild(btn);
    }
  }

  // ---------------- widget bar (mod-widgets only) ----------------
  function buildWidgetBar() {
    widgetBar.innerHTML = '';
    for (const w of window.ModAPI._widgets.values()) {
      const btn = document.createElement('button');
      btn.className = 'icon-btn';
      btn.title = w.label;
      btn.appendChild(Icon(w.icon, { size: '18px' }));
      btn.addEventListener('click', () => toggleWidget(w));
      widgetBar.appendChild(btn);
    }
  }

  function closeWidget(id) {
    const entry = openWidgets.get(id);
    if (!entry) return;
    entry.root.remove();
    if (entry.onKeydown) document.removeEventListener('keydown', entry.onKeydown);
    openWidgets.delete(id);
  }

  function toggleWidget(w) {
    if (openWidgets.has(w.id)) {
      closeWidget(w.id);
      return;
    }

    const panel = document.createElement('div');
    panel.className = 'floating-widget';
    if (w.center) panel.classList.add('modal');
    if (w.center && !w.overlay) panel.classList.add('centered');
    if (w.width) panel.style.width = w.width;
    if (w.height) panel.style.height = w.height;

    const body = document.createElement('div');
    body.className = 'floating-widget-body';

    const close = () => closeWidget(w.id);

    if (!w.noChrome) {
      const header = document.createElement('div');
      header.className = 'floating-widget-header';
      const title = document.createElement('span');
      title.textContent = w.label;
      const closeBtn = document.createElement('span');
      closeBtn.className = 'floating-widget-close';
      closeBtn.appendChild(Icon('close', { size: '16px' }));
      closeBtn.addEventListener('click', close);
      header.append(title, closeBtn);
      panel.appendChild(header);

      const isDraggable = w.draggable !== false && !w.center && !w.overlay;
      header.style.cursor = isDraggable ? 'move' : 'default';
      if (isDraggable) {
        let ox, oy;
        header.addEventListener('mousedown', (e) => {
          ox = e.clientX - panel.offsetLeft;
          oy = e.clientY - panel.offsetTop;
          const onMove = (m) => {
            panel.style.left = `${m.clientX - ox}px`;
            panel.style.top = `${m.clientY - oy}px`;
          };
          const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
          };
          document.addEventListener('mousemove', onMove);
          document.addEventListener('mouseup', onUp);
        });
      }
    }

    panel.appendChild(body);

    let root = panel;
    if (w.overlay) {
      const backdrop = document.createElement('div');
      backdrop.className = 'widget-backdrop';
      backdrop.appendChild(panel);
      backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(); });
      root = backdrop;
    } else if (!w.center) {
      panel.style.top = '76px';
      panel.style.left = `${40 + openWidgets.size * 24}px`;
    }

    // Attach BEFORE mount() runs so mount() can rely on the panel already
    // being in the document (e.g. for measuring or focusing an input).
    document.body.appendChild(root);

    const onKeydown = (e) => { if (e.key === 'Escape') close(); };
    if (w.overlay) document.addEventListener('keydown', onKeydown);
    openWidgets.set(w.id, { root, onKeydown: w.overlay ? onKeydown : null });

    w.mount(body, close);
  }

  // ---------------- tab activation ----------------
  async function activateTab(id) {
    activeTabId = id;
    main.classList.toggle('full-bleed', id === 'music-player' || id === 'ide');
    [...tabNav.children].forEach((btn) => btn.classList.toggle('active', btn.dataset.id === id));

    content.classList.add('fading');
    await new Promise((r) => setTimeout(r, 90));

    const override = window.ModAPI._overrides.get(id);
    const modTab = window.ModAPI._tabs.get(id);

    try {
      if (override) await override(content);
      else if (modTab) await modTab.render(content);
      else content.innerHTML = '';
    } catch (err) {
      content.innerHTML = `<p class="error">This tab failed to load: ${err.message}</p>`;
    }

    const hooks = window.ModAPI._activateHooks.get(id) || [];
    for (const hook of hooks) {
      try { hook(content); } catch (err) { console.error('[mods] activate hook failed:', err); }
    }

    content.classList.remove('fading');
  }

  // ---------------- wiring ----------------
  document.addEventListener('mods:tabs-changed', () => {
    const shouldAutoActivate = activeTabId === null;
    buildNav();
    if (shouldAutoActivate) {
      const first = [...window.ModAPI._tabs.values()][0];
      if (first) activateTab(first.id);
    }
  });

  document.addEventListener('mods:widgets-changed', buildWidgetBar);

  // Initial render: at this point no mods have loaded yet (this script runs
  // before bootstrap.js starts fetching them), so this is genuinely just
  // the bare topbar over blank space.
  buildNav();
  buildWidgetBar();
})();
