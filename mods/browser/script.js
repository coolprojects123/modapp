/**
 * Browser tab: many tabs without lag.
 *
 * Every live <webview> is its own renderer process, so the cost of "many tabs" is
 * the number of live pages, not the number of tab buttons. This mod keeps that
 * number small:
 *
 *  - Lazy: restored tabs start asleep (URL and title only). A page loads the
 *    first time its tab is opened.
 *  - Capped: at most MAX_LIVE pages are alive. Opening another puts the
 *    least-recently-used background tab to sleep.
 *  - Idle: background tabs unused for IDLE_SLEEP_MS go to sleep.
 *  - Audible tabs (music, calls) are never put to sleep.
 *  - Background tabs are hidden with visibility + z-index, never display:none,
 *    and stay mounted, so switching tabs does no layout work and no reload.
 *
 * A sleeping tab reloads its page when you open it again (scroll position and
 * unsaved form data are lost), which is what makes the saving possible.
 */
(function () {
  'use strict';

  const MOD_ID = 'browser';
  const FILE = 'tabs.json';
  const LS_KEY = 'modapp:browser';
  const PARTITION = 'persist:browser';
  const SEARCH_URL = 'https://duckduckgo.com/?q=';

  const MAX_LIVE = 5;
  const IDLE_SLEEP_MS = 10 * 60 * 1000;
  const SWEEP_MS = 60 * 1000;
  const SAVE_DELAY_MS = 800;

  const newId = () =>
    (window.crypto && crypto.randomUUID)
      ? crypto.randomUUID()
      : `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  const icon = (name) => el('span', 'br-icon', name);

  function toUrl(input) {
    const text = input.trim();
    if (!text) return '';
    if (/^https?:\/\//i.test(text)) return text;
    if (/^(localhost|\d{1,3}(\.\d{1,3}){3})(:\d+)?(\/.*)?$/i.test(text)) return `http://${text}`;
    if (/^([\w-]+\.)+[a-z]{2,}(:\d+)?(\/.*)?$/i.test(text)) return `https://${text}`;
    return SEARCH_URL + encodeURIComponent(text);
  }

  function hostOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
  }

  function tabLabel(tab) {
    return tab.title || hostOf(tab.url) || 'New tab';
  }

  // ---------------------------------------------------------------- storage

  function createStore() {
    // Each mod automatically uses its own ID - no forMod() needed
    const fs = ModAPI.native?.fs;
    if (fs) {
      return {
        async load() {
          try {
            return (await fs.exists(FILE)) ? JSON.parse(await fs.readFile(FILE)) : null;
          } catch (err) {
            console.error('[browser] load failed:', err);
            return null;
          }
        },
        save: (data) => fs.writeFile(FILE, JSON.stringify(data)),
      };
    }
    return {
      async load() {
        try { return JSON.parse(localStorage.getItem(LS_KEY)); } catch { return null; }
      },
      async save(data) { localStorage.setItem(LS_KEY, JSON.stringify(data)); },
    };
  }

  // The main process checks the permission, that the mod is enabled, and that the URL is http(s).
  // ModAPI.native sends this mod's id with the call; no id is passed or defaulted here.
  async function gate(tab) {
    const webview = ModAPI.native?.webview;
    if (webview?.authorize) await webview.authorize(tab.id, tab.url);
  }

  // ------------------------------------------------------------------- build

  const store = createStore();
  let root = null;

  function build() {
    if (root) return root;

    let tabs = [];
    let activeId = null;
    let saveTimer = null;
    const tabEls = new Map(); // id -> { root, title, audio }

    // ---- DOM

    const tabList = el('div', 'br-tab-list');
    tabList.setAttribute('role', 'tablist');
    tabList.setAttribute('aria-label', 'Browser tabs');
    const addBtn = el('button', 'br-btn');
    addBtn.type = 'button';
    addBtn.title = 'New tab';
    addBtn.setAttribute('aria-label', 'New tab');
    addBtn.appendChild(icon('add'));
    const tabBar = el('div', 'br-tabbar');
    tabBar.append(tabList, addBtn);

    function navButton(name, label) {
      const b = el('button', 'br-btn');
      b.type = 'button';
      b.title = label;
      b.setAttribute('aria-label', label);
      b.appendChild(icon(name));
      return b;
    }
    const backBtn = navButton('arrow_back', 'Back');
    const forwardBtn = navButton('arrow_forward', 'Forward');
    const reloadBtn = navButton('refresh', 'Reload');
    const urlInput = el('input', 'br-url');
    urlInput.type = 'text';
    urlInput.placeholder = 'Search or enter a web address';
    urlInput.spellcheck = false;
    urlInput.setAttribute('aria-label', 'Address');
    const toolbar = el('div', 'br-toolbar');
    toolbar.append(backBtn, forwardBtn, reloadBtn, urlInput);

    const empty = el('div', 'br-empty');
    const stack = el('div', 'br-stack');
    stack.appendChild(empty);

    root = el('div', 'br-root');
    root.append(tabBar, toolbar, stack);

    // ---- helpers

    const active = () => tabs.find((t) => t.id === activeId);

    function persist() {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        const data = {
          version: 1,
          activeId,
          tabs: tabs.map((t) => ({ id: t.id, url: t.url, title: t.title })),
        };
        Promise.resolve(store.save(data)).catch((err) => console.error('[browser] save failed:', err));
      }, SAVE_DELAY_MS);
    }

    function makeTab(url = '', title = '', id = newId()) {
      return {
        id, url, title,
        view: null, waking: false, error: '',
        loading: false, audible: false,
        lastActive: Date.now(),
      };
    }

    // ---- tab strip

    function patchTab(tab) {
      const parts = tabEls.get(tab.id);
      if (!parts) return;
      parts.title.textContent = tabLabel(tab);
      parts.audio.hidden = !tab.audible;
      parts.root.classList.toggle('asleep', !tab.view && !tab.waking && !!tab.url);
      parts.root.title = tab.url ? `${tabLabel(tab)}\n${tab.url}${tab.view ? '' : '\n(asleep, loads when opened)'}` : '';
    }

    function renderTabs() {
      tabEls.clear();
      const nodes = tabs.map((tab) => {
        const selected = tab.id === activeId;
        const node = el('div', 'br-tab');
        node.setAttribute('role', 'tab');
        node.setAttribute('aria-selected', String(selected));
        node.tabIndex = selected ? 0 : -1;

        const audio = icon('volume_up');
        audio.classList.add('br-tab-audio');
        audio.hidden = true;
        const title = el('span', 'br-tab-title');
        const close = el('button', 'br-tab-close');
        close.type = 'button';
        close.tabIndex = -1;
        close.title = 'Close tab';
        close.setAttribute('aria-label', 'Close tab');
        close.appendChild(icon('close'));
        node.append(audio, title, close);

        node.addEventListener('click', (event) => {
          if (!event.target.closest('.br-tab-close')) select(tab.id);
        });
        node.addEventListener('auxclick', (event) => { if (event.button === 1) closeTab(tab.id); });
        close.addEventListener('click', () => closeTab(tab.id));
        node.addEventListener('keydown', (event) => {
          const i = tabs.findIndex((t) => t.id === tab.id);
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(tab.id); }
          else if (event.key === 'Delete') { event.preventDefault(); closeTab(tab.id); }
          else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
            event.preventDefault();
            const step = event.key === 'ArrowRight' ? 1 : -1;
            select(tabs[(i + step + tabs.length) % tabs.length].id);
            tabList.querySelector('[aria-selected="true"]')?.focus();
          }
        });

        tabEls.set(tab.id, { root: node, title, audio });
        patchTab(tab);
        return node;
      });
      tabList.replaceChildren(...nodes);
      tabList.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }

    // ---- toolbar + empty state

    function syncToolbar() {
      const tab = active();
      const view = tab?.view;
      let canBack = false, canForward = false;
      try { canBack = !!view?.canGoBack(); canForward = !!view?.canGoForward(); } catch { /* not ready yet */ }
      backBtn.disabled = !canBack;
      forwardBtn.disabled = !canForward;
      reloadBtn.disabled = !view;
      const loading = !!tab?.loading;
      reloadBtn.replaceChildren(icon(loading ? 'close' : 'refresh'));
      reloadBtn.title = loading ? 'Stop' : 'Reload';
      reloadBtn.setAttribute('aria-label', reloadBtn.title);
      if (document.activeElement !== urlInput) urlInput.value = tab?.url || '';

      if (!tab || (!tab.view && !tab.waking)) {
        empty.hidden = false;
        empty.textContent = tab?.error
          ? tab.error
          : tab?.url ? 'Loading...' : 'Search or enter a web address above.';
      } else {
        empty.hidden = true;
      }
    }

    function applyStacking() {
      for (const t of tabs) if (t.view) t.view.classList.toggle('active', t.id === activeId);
    }

    // ---- page lifecycle

    async function wake(tab) {
      if (tab.view || tab.waking || !tab.url) return;
      tab.waking = true;
      tab.error = '';
      patchTab(tab);
      try {
        await gate(tab);
      } catch (err) {
        tab.waking = false;
        tab.error = `This page can't be opened: ${err.message || err}`;
        patchTab(tab);
        syncToolbar();
        return;
      }
      tab.waking = false;
      if (tab.view || !tabs.includes(tab)) return;

      const view = document.createElement('webview');
      view.className = 'br-view';
      view.setAttribute('partition', PARTITION);
      view.setAttribute('src', tab.url);
      // No nodeintegration / allowpopups / contextisolation attributes here: Electron treats them as boolean
      // attributes, so setting them to "false" would switch them ON. Node access, preloads and popups are
      // locked down in main.js (will-attach-webview and the webview window-open handler).

      let titleFrame = 0;
      view.addEventListener('page-title-updated', (e) => {
        tab.title = e.title || '';
        if (!titleFrame) titleFrame = requestAnimationFrame(() => { titleFrame = 0; patchTab(tab); });
        persist();
      });
      const onNavigate = (e) => {
        if (e.isMainFrame === false) return;
        tab.url = e.url;
        if (tab.id === activeId) syncToolbar();
        persist();
      };
      view.addEventListener('did-navigate', onNavigate);
      view.addEventListener('did-navigate-in-page', onNavigate);
      view.addEventListener('did-start-loading', () => { tab.loading = true; if (tab.id === activeId) syncToolbar(); });
      view.addEventListener('did-stop-loading', () => { tab.loading = false; if (tab.id === activeId) syncToolbar(); });
      view.addEventListener('dom-ready', () => { if (tab.id === activeId) syncToolbar(); });
      view.addEventListener('media-started-playing', () => { tab.audible = true; patchTab(tab); });
      view.addEventListener('media-paused', () => { tab.audible = false; patchTab(tab); });

      stack.appendChild(view);
      tab.view = view;
      applyStacking();
      patchTab(tab);
      syncToolbar();
      enforceCap();
    }

    function sleep(tab) {
      if (!tab.view) return;
      tab.view.remove();
      tab.view = null;
      tab.loading = false;
      tab.audible = false;
      patchTab(tab);
    }

    function enforceCap() {
      for (;;) {
        const live = tabs.filter((t) => t.view);
        if (live.length <= MAX_LIVE) return;
        const candidates = live
          .filter((t) => t.id !== activeId && !t.audible)
          .sort((a, b) => a.lastActive - b.lastActive);
        if (!candidates.length) return;
        sleep(candidates[0]);
      }
    }

    setInterval(() => {
      const now = Date.now();
      for (const t of tabs) {
        if (t.view && t.id !== activeId && !t.audible && now - t.lastActive > IDLE_SLEEP_MS) sleep(t);
      }
    }, SWEEP_MS);

    // ---- actions

    function select(id) {
      const tab = tabs.find((t) => t.id === id);
      if (!tab) return;
      activeId = id;
      tab.lastActive = Date.now();
      wake(tab);
      applyStacking();
      enforceCap();
      renderTabs();
      syncToolbar();
      persist();
    }

    function addTab(url = '') {
      const tab = makeTab(url);
      tabs.push(tab);
      select(tab.id);
      if (!url) urlInput.focus();
    }

    function closeTab(id) {
      const index = tabs.findIndex((t) => t.id === id);
      if (index === -1) return;
      const [tab] = tabs.splice(index, 1);
      sleep(tab);
      if (!tabs.length) tabs.push(makeTab());
      if (activeId === id) select(tabs[Math.min(index, tabs.length - 1)].id);
      else { renderTabs(); persist(); }
    }

    function go(input) {
      const tab = active();
      const url = toUrl(input);
      if (!tab || !url) return;
      tab.url = url;
      tab.title = '';
      if (tab.view) {
        try {
          Promise.resolve(tab.view.loadURL(url)).catch(() => { /* navigation aborted or superseded */ });
        } catch {
          // loadURL throws until the webview has fired dom-ready; setting src is always safe.
          tab.view.setAttribute('src', url);
        }
      } else {
        wake(tab);
      }
      patchTab(tab);
      syncToolbar();
      persist();
    }

    // ---- wiring

    addBtn.addEventListener('click', () => addTab());
    backBtn.addEventListener('click', () => { try { active()?.view?.goBack(); } catch { /* ignore */ } });
    forwardBtn.addEventListener('click', () => { try { active()?.view?.goForward(); } catch { /* ignore */ } });
    reloadBtn.addEventListener('click', () => {
      const tab = active();
      if (!tab?.view) return;
      try {
        if (tab.loading) tab.view.stop(); else tab.view.reload();
      } catch { /* page not ready yet */ }
    });
    urlInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { go(urlInput.value); urlInput.blur(); }
      else if (event.key === 'Escape') { urlInput.value = active()?.url || ''; urlInput.blur(); }
    });
    urlInput.addEventListener('focus', () => urlInput.select());
    urlInput.addEventListener('blur', syncToolbar);

    // ---- restore: every tab starts asleep, only the active one loads

    store.load().then((data) => {
      const saved = Array.isArray(data?.tabs)
        ? data.tabs.filter((t) => t && typeof t.id === 'string')
        : [];
      tabs = saved.map((t) => makeTab(
        typeof t.url === 'string' ? t.url : '',
        typeof t.title === 'string' ? t.title : '',
        t.id,
      ));
      if (!tabs.length) tabs = [makeTab()];
      select(tabs.some((t) => t.id === data?.activeId) ? data.activeId : tabs[0].id);
    });

    return root;
  }

  ModAPI.registerTab({
    id: 'browser',
    label: 'Browser',
    icon: 'language',
    render(container) {
      const node = build();
      // Moving a <webview> in the DOM reloads its page, so only attach when needed.
      if (node.parentNode !== container) container.replaceChildren(node);
    },
  });
})();