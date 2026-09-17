/**
 * Browser mod — embeds a real native OS webview inside a tab, instead of an
 * <iframe>. This sidesteps X-Frame-Options / CSP framing restrictions that
 * would block most real sites in an iframe.
 *
 * How it works:
 * - All webview lifecycle (create/close/show/hide/position/size) goes
 *   through ModAPI.native.webview, which is backed by permission-gated Rust
 *   commands (see lib.rs) rather than this mod touching Tauri's own webview
 *   API directly. That's what makes 'webview.access' in this mod's mod.json
 *   meaningful — a mod without that permission simply can't create one.
 *   UA selection (matched to the real host engine, not hardcoded) also lives
 *   entirely on the Rust side now, so it's consistent for every mod that
 *   uses this, not just this one.
 * - The mod webview is a separate, parented native window (not a true child
 *   webview) — see lib.rs for why. Because of that, it does NOT
 *   automatically follow the main app window when it's dragged or resized.
 *   lib.rs emits a 'mod-webview:reposition-needed' event whenever the main
 *   window moves/resizes; this mod listens for that and recomputes/resends
 *   its bounds in response, which is what keeps the webview glued to the
 *   toolbar/viewport visually even though it's a separate OS window under
 *   the hood.
 * - There is no JS-side "navigate" API for an existing webview in Tauri 2 at
 *   the time this was written, so every navigation (address bar, back,
 *   forward, reload) closes the old native webview and creates a new one at
 *   the same position/size with the new URL. This means in-page state
 *   (scroll position, unsaved form input, JS state) is not preserved across
 *   navigations — only the browsing history (as a list of URLs) is tracked
 *   by this mod itself.
 * - The native webview floats above the DOM at fixed screen coordinates, so
 *   this mod repositions/resizes it on window resize and hides/shows it in
 *   sync with this tab's own visibility (tracked via a MutationObserver on
 *   the tab container's inline `style.display`, which is how site.js now
 *   toggles active tabs — the `hidden` attribute is no longer used for this).
 *
 * QOL additions:
 * - Last URL + history persisted to localStorage, restored on next launch
 *   instead of always reopening to HOME_URL.
 * - A thin animated progress bar under the toolbar during navigation,
 *   instead of only a text status line.
 * - Toolbar controls (back/forward/reload/home/url/go) are disabled while a
 *   navigation is in flight, since each navigation destroys and recreates
 *   the native webview — clicking again mid-navigation could otherwise
 *   race destroyWebview()/create() against each other.
 * - Escape in the URL bar reverts the input to the current page's URL
 *   (without navigating) and blurs it, instead of leaving stray edits.
 * - Clicking into the URL bar selects its full contents, like a normal
 *   browser address bar, so retyping doesn't require manually clearing it.
 * - reposition() calls are debounced -- window drag/resize can otherwise
 *   fire many times per second, each one an IPC round-trip.
 */
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

  // The mod webview is a separate native window now (see lib.rs), so it
  // won't drag/resize along with the main window on its own — lib.rs emits
  // this event whenever the main window moves or resizes, and this is what
  // actually keeps the browser webview glued in place in response.
  if (window.__TAURI__?.event?.listen) {
    window.__TAURI__.event.listen('mod-webview:reposition-needed', () => {
      reposition();
    });
  } else {
    console.warn(
      '[browser mod] window.__TAURI__.event is not available — the browser ' +
      'webview will not follow the app window when it is moved or resized. ' +
      'Make sure "withGlobalTauri" is enabled in tauri.conf.json.'
    );
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
        if (isVisible(container)) reposition();
      });
      resizeObserver.observe(viewportEl);
      window.addEventListener('resize', () => {
        if (isVisible(container)) reposition();
      });

      // The tab view is created once and then just toggled via inline
      // style.display on every subsequent switch (see site.js) — this
      // observer is what lets us show/hide the native webview (which floats
      // independent of the DOM) in sync with that.
      const visibilityObserver = new MutationObserver(() => {
        if (!isVisible(container)) {
          if (hasWebview) window.ModAPI.native.webview.setVisible(MOD_ID, INSTANCE, false).catch(() => {});
        } else {
          reposition();
          if (hasWebview) window.ModAPI.native.webview.setVisible(MOD_ID, INSTANCE, true).catch(() => {});
        }
      });
      visibilityObserver.observe(container, { attributes: true, attributeFilter: ['style'] });

      updateNavButtons();
      openUrl(currentUrl, { recordHistory: navHistory.length === 0 });
    },
  });
})();