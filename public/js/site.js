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
  const tabViews = new Map();   // id -> view element
  const viewReady = new Map();  // id -> promise (render + activate hooks finished)
  let activationToken = 0;      // bumped on every tab click; only the latest may touch the display

  // Electron <webview> elements are contained by their host and can layer
  // with CSS, but overlays still hide them to avoid showing content through
  // translucent panels. Counted in case multiple overlays are open.
  let openOverlayCount = 0;

  // Inactive tab views are hidden by a stylesheet rule with !important, so a
  // mod that sets `style.display` on its own container (or has CSS like
  // `.my-tab { display: flex }`) can't leave itself visible behind another tab.
  const shellStyle = document.createElement('style');
  shellStyle.textContent = '.tab-view:not(.is-active) { display: none !important; }';
  document.head.appendChild(shellStyle);

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

    if (entry.onKeydown) {
      document.removeEventListener('keydown', entry.onKeydown);
    }

    openWidgets.delete(id);

    // Widget close lifecycle
    if (typeof entry.onClose === 'function') {
      try {
        entry.onClose();
      } catch (err) {
        console.error(`[mods] widget "${id}" onClose failed:`, err);
      }
    }

    if (entry.overlay) {
      openOverlayCount--;

      if (openOverlayCount === 0) {
        document.dispatchEvent(
          new CustomEvent('mods:overlay-closed')
        );
      }
    }
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
    openWidgets.set(w.id, {
      root,
      onKeydown: w.overlay ? onKeydown : null,
      overlay: w.overlay,
      onOpen: w.onOpen,
      onClose: w.onClose
    });

    if (w.overlay) {
      openOverlayCount++;

      if (openOverlayCount === 1) {
        document.dispatchEvent(
          new CustomEvent('mods:overlay-opened')
        );
      }
    }

    w.mount(body, close);

    if (typeof w.onOpen === 'function') {
      try {
        w.onOpen();
      } catch (err) {
        console.error(`[mods] widget "${w.id}" onOpen failed:`, err);
      }
    }
  }

  // ---------------- tab activation ----------------
  // Creates the tab's view once and runs render + activate hooks once. The
  // promise is cached, so a superseded activation still lets the render finish
  // in the background and the tab is ready the next time it's opened.
  function ensureView(id) {
    if (viewReady.has(id)) return viewReady.get(id);

    const view = document.createElement('div');
    view.className = 'tab-view';
    view.dataset.tabId = id;
    content.appendChild(view);
    tabViews.set(id, view);

    const ready = (async () => {
      const override = window.ModAPI._overrides.get(id);
      const modTab = window.ModAPI._tabs.get(id);
      try {
        if (override) await override(view);
        else if (modTab) await modTab.render(view);
      } catch (err) {
        const failure = document.createElement('p');
        failure.className = 'error';
        failure.textContent = `This tab failed to load: ${err.message}`;
        view.replaceChildren(failure);
      }

      const hooks = window.ModAPI._activateHooks.get(id) || [];
      for (const hook of hooks) {
        try { hook(view); } catch (err) { console.error('[mods] activate hook failed:', err); }
      }
    })();

    viewReady.set(id, ready);
    return ready;
  }

  async function activateTab(id) {
    const token = ++activationToken;
    activeTabId = id;

    // Full-bleed is whatever the tab asked for at registration (or its
    // overrider asked for) -- the shell keeps no list of mods.
    const tabEntry = window.ModAPI._tabs.get(id);
    const overrideOpts = window.ModAPI._overrideOptions.get(id);
    main.classList.toggle('full-bleed', overrideOpts ? overrideOpts.fullBleed : !!(tabEntry && tabEntry.fullBleed));
    [...tabNav.children].forEach((btn) => btn.classList.toggle('active', btn.dataset.id === id));

    content.classList.add('fading');
    await new Promise((r) => setTimeout(r, 90));
    if (token !== activationToken) return; // a newer click owns the display

    await ensureView(id);
    if (token !== activationToken) return; // superseded while rendering

    for (const [tabId, tabView] of tabViews) tabView.classList.toggle('is-active', tabId === id);

    content.classList.remove('fading');
  }

  // ---------------- wiring ----------------
  // A mod was unloaded (disabled, deleted or replaced): drop its tab's view. If it was the open tab, remember
  // it so that a replaced mod comes back on the same tab instead of jumping to the first one.
  let reopenTabId = null;
  document.addEventListener('mods:tab-removed', (event) => {
    const id = event.detail.id;
    tabViews.get(id)?.remove();
    tabViews.delete(id);
    viewReady.delete(id);
    if (activeTabId === id) {
      reopenTabId = id;
      activeTabId = null;
      activationToken++; // cancel an activation that is still waiting on this tab
      main.classList.remove('full-bleed');
      content.classList.remove('fading');
    }
  });

  document.addEventListener('mods:widget-removed', (event) => closeWidget(event.detail.id));

  document.addEventListener('mods:tabs-changed', () => {
    const shouldAutoActivate = activeTabId === null;
    buildNav();
    if (shouldAutoActivate) {
      const tabs = window.ModAPI._tabs;
      const target = (reopenTabId && tabs.get(reopenTabId)) || [...tabs.values()][0];
      reopenTabId = null;
      if (target) activateTab(target.id);
    }
  });

  document.addEventListener('mods:widgets-changed', buildWidgetBar);

  // Initial render: at this point no mods have loaded yet (this script runs
  // before bootstrap.js starts fetching them), so this is genuinely just
  // the bare topbar over blank space.
  buildNav();
  buildWidgetBar();
})();