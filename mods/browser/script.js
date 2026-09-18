(function () {
  // Captured now, at load time, while bootstrap.js still has ModAPI's modId
  // set to this mod's own id — by the time registerTab's render() runs
  // later (on tab click), that context is gone.
  const MOD_ID = window.ModAPI.modId;
  const INSTANCE = 'main';

  const hasWebviewAPI = !!window.ModAPI?.native?.webview;

  const HOME_URL = 'https://www.google.com';
  const STORAGE_KEY = 'browser-mod:session';
  const REPOSITION_DEBOUNCE_MS = 40;

  function loadSession() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed.history) || typeof parsed.index !== 'number') return null;
      return parsed;
    } catch (err) {
      return null;
    }
  }

  function saveSession() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ history: navHistory, index: historyIndex }));
    } catch (err) {
      // Storage full/unavailable — session just won't persist, not fatal.
    }
  }

  const restored = loadSession();

  let hasWebview = false; // tracks whether the native webview currently exists
  let currentUrl = restored ? restored.history[restored.index] : HOME_URL;
  let navHistory = restored ? restored.history : [];
  let historyIndex = restored ? restored.index : -1;
  let isLoading = false;
  let repositionTimer = null;
  // A native webview is a separate OS-composited surface -- it paints on
  // top of regular DOM content (including a translucent overlay modal like
  // Settings) no matter what z-index says, so there's no CSS fix for that.
  // site.js tells every mod when an overlay widget opens/closes; hiding
  // ours for the duration is what keeps Settings/Login from having this
  // tab's page show through or on top of them.
  let overlayOpen = false;

  let viewportEl = null;
  let urlInput = null;
  let statusEl = null;
  let progressEl = null;
  let backBtn = null;
  let fwdBtn = null;
  let reloadBtn = null;
  let homeBtn = null;
  let goBtn = null;

  function isVisible(container) {
    return !!container && container.style.display !== 'none';
  }

  function computeBounds() {
    if (!viewportEl) return null;
    const rect = viewportEl.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return null;
    return {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
  }

  async function destroyWebview() {
    if (!hasWebview) return;
    hasWebview = false;
    try {
      await window.ModAPI.native.webview.close(MOD_ID, INSTANCE);
    } catch (err) {
      // Already gone / never fully created — safe to ignore.
    }
  }

  async function doReposition() {
    if (!hasWebview) return;
    const bounds = computeBounds();
    if (!bounds) return;
    try {
      await window.ModAPI.native.webview.setBounds(MOD_ID, INSTANCE, bounds);
    } catch (err) {
      console.warn('[browser mod] failed to reposition webview:', err);
    }
  }

  // Coalesces bursts of reposition requests (window drag/resize can fire
  // many times a second) into a single IPC call.
  function reposition() {
    if (repositionTimer) clearTimeout(repositionTimer);
    repositionTimer = setTimeout(() => {
      repositionTimer = null;
      doReposition();
    }, REPOSITION_DEBOUNCE_MS);
  }

  function normalizeInput(raw) {
    const value = raw.trim();
    if (!value) return HOME_URL;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return value; // already has a scheme
    const looksLikeDomain = /^[^\s]+\.[^\s]{2,}$/.test(value) && !value.includes(' ');
    return looksLikeDomain ? `https://${value}` : `https://www.google.com/search?q=${encodeURIComponent(value)}`;
  }

  function updateNavButtons() {
    if (backBtn) backBtn.disabled = isLoading || historyIndex <= 0;
    if (fwdBtn) fwdBtn.disabled = isLoading || historyIndex >= navHistory.length - 1;
  }

  function setLoading(loading) {
    isLoading = loading;
    if (progressEl) progressEl.classList.toggle('active', loading);
    if (reloadBtn) reloadBtn.disabled = loading;
    if (homeBtn) homeBtn.disabled = loading;
    if (goBtn) goBtn.disabled = loading;
    if (urlInput) urlInput.disabled = loading;
    updateNavButtons();
  }

  // Single visibility source of truth, combining the tab's own DOM
  // visibility with whether an overlay widget currently needs this
  // webview hidden out of the way.
  function shouldBeVisible(container) {
    return isVisible(container) && !overlayOpen;
  }

  async function openUrl(rawUrl, { recordHistory = true } = {}) {
    if (!hasWebviewAPI) return;
    const target = normalizeInput(rawUrl);
    currentUrl = target;
    if (urlInput) urlInput.value = target;
    setLoading(true);
    if (statusEl) statusEl.textContent = 'Loading…';

    const bounds = computeBounds() || { x: 0, y: 0, width: 800, height: 600 };
    await destroyWebview();

    try {
      await window.ModAPI.native.webview.create(MOD_ID, INSTANCE, { url: target, ...bounds });
      hasWebview = true;
      // The bounds used above may have been the 0x0 fallback, captured
      // while this tab was still `display: none` during its initial
      // render(). The ResizeObserver-driven correction can race against
      // this IPC call and lose (it checks hasWebview, which wasn't true
      // yet) with nothing left to retrigger it afterward — so force one
      // fresh measurement + reposition now that hasWebview is set and the
      // tab is (should be) actually visible.
      await doReposition();
      if (statusEl) statusEl.textContent = target;
    } catch (err) {
      hasWebview = false;
      if (statusEl) statusEl.textContent = `Failed to load: ${err.message || err}`;
    }

    if (recordHistory) {
      navHistory = navHistory.slice(0, historyIndex + 1);
      navHistory.push(target);
      historyIndex = navHistory.length - 1;
    }
    saveSession();
    setLoading(false);
  }

  window.ModAPI.registerTab({
    id: 'browser',
    label: 'Browser',
    icon: 'public',
    render(container) {
      container.classList.add('browser-tab');

      const toolbar = document.createElement('div');
      toolbar.className = 'browser-toolbar';

      backBtn = document.createElement('button');
      backBtn.className = 'browser-btn';
      backBtn.textContent = '←';
      backBtn.title = 'Back';
      backBtn.disabled = true;
      backBtn.addEventListener('click', () => {
        if (historyIndex > 0) {
          historyIndex -= 1;
          openUrl(navHistory[historyIndex], { recordHistory: false });
        }
      });

      fwdBtn = document.createElement('button');
      fwdBtn.className = 'browser-btn';
      fwdBtn.textContent = '→';
      fwdBtn.title = 'Forward';
      fwdBtn.disabled = true;
      fwdBtn.addEventListener('click', () => {
        if (historyIndex < navHistory.length - 1) {
          historyIndex += 1;
          openUrl(navHistory[historyIndex], { recordHistory: false });
        }
      });

      reloadBtn = document.createElement('button');
      reloadBtn.className = 'browser-btn';
      reloadBtn.textContent = '⟳';
      reloadBtn.title = 'Reload';
      reloadBtn.addEventListener('click', () => openUrl(currentUrl, { recordHistory: false }));

      homeBtn = document.createElement('button');
      homeBtn.className = 'browser-btn';
      homeBtn.textContent = '⌂';
      homeBtn.title = 'Home';
      homeBtn.addEventListener('click', () => openUrl(HOME_URL));

      urlInput = document.createElement('input');
      urlInput.type = 'text';
      urlInput.className = 'browser-url';
      urlInput.placeholder = 'Search or enter address';
      urlInput.value = currentUrl;
      urlInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          urlInput.blur();
          openUrl(urlInput.value);
        } else if (event.key === 'Escape') {
          urlInput.value = currentUrl;
          urlInput.blur();
        }
      });
      // Standard address-bar behavior: clicking in selects everything, so
      // typing a new URL doesn't require manually clearing the old one.
      urlInput.addEventListener('focus', () => urlInput.select());

      goBtn = document.createElement('button');
      goBtn.className = 'browser-btn browser-go';
      goBtn.textContent = 'Go';
      goBtn.addEventListener('click', () => openUrl(urlInput.value));

      toolbar.append(backBtn, fwdBtn, reloadBtn, homeBtn, urlInput, goBtn);

      progressEl = document.createElement('div');
      progressEl.className = 'browser-progress';

      viewportEl = document.createElement('div');
      viewportEl.className = 'browser-viewport';

      statusEl = document.createElement('div');
      statusEl.className = 'browser-status';

      container.append(toolbar, progressEl, viewportEl, statusEl);

      if (!hasWebviewAPI) {
        viewportEl.innerHTML =
          '<p class="browser-error">Native webview API is not available.<br>' +
          'Make sure this mod has the <code>webview.access</code> permission in its ' +
          '<code>mod.json</code> and you\'re running the desktop (Tauri) build.</p>';
        return;
      }

      const resizeObserver = new ResizeObserver(() => {
        if (shouldBeVisible(container)) reposition();
      });
      resizeObserver.observe(viewportEl);
      window.addEventListener('resize', () => {
        if (shouldBeVisible(container)) reposition();
      });

      // The tab view is created once and then just toggled via inline
      // style.display on every subsequent switch (see site.js) — this
      // observer is what lets us show/hide the native webview (which floats
      // independent of the DOM) in sync with that.
      const visibilityObserver = new MutationObserver(() => {
        if (!shouldBeVisible(container)) {
          if (hasWebview) window.ModAPI.native.webview.setVisible(MOD_ID, INSTANCE, false).catch(() => {});
        } else {
          reposition();
          if (hasWebview) window.ModAPI.native.webview.setVisible(MOD_ID, INSTANCE, true).catch(() => {});
        }
      });
      visibilityObserver.observe(container, { attributes: true, attributeFilter: ['style'] });

      // site.js dispatches these around any overlay widget (Settings,
      // Login) opening/closing. Since a native webview always composites
      // above regular DOM content regardless of z-index, hiding is the
      // only way to keep it from covering a transparent overlay panel.
      document.addEventListener('mods:overlay-opened', () => {
        overlayOpen = true;
        if (hasWebview) window.ModAPI.native.webview.setVisible(MOD_ID, INSTANCE, false).catch(() => {});
      });
      document.addEventListener('mods:overlay-closed', () => {
        overlayOpen = false;
        if (shouldBeVisible(container)) {
          reposition();
          if (hasWebview) window.ModAPI.native.webview.setVisible(MOD_ID, INSTANCE, true).catch(() => {});
        }
      });

      updateNavButtons();
      openUrl(currentUrl, { recordHistory: navHistory.length === 0 });
    },
  });
})();