// This mod provides the app's settings widgets.

function escapeHtml(str) { return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function colorForId(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return `hsl(${hash % 360}, 70%, 60%)`;
}

const DEFAULT_SETTINGS = {
  siteTitle: 'modapp',
  siteIcon: 'M',
  tagline: 'a modular desktop app',
  defaultTab: 'home',
  accentColor: '#3b82f6',
  reduceMotion: false,
  updateModal: true, // show the update pop-up on startup (off = small notice instead)
  themeVars: {},
};

function readSettings() {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem('modapp_settings') || '{}') }; }
  catch { return { ...DEFAULT_SETTINGS }; }
}

async function loadSettings() {
  if (window.nativeAPIReady) await window.nativeAPIReady;
  return window.appAPI ? window.appAPI.readSettings() : readSettings();
}

async function writeSettings(changes) {
  if (window.nativeAPIReady) await window.nativeAPIReady;
  if (window.appAPI) return window.appAPI.writeSettings(changes);
  const updated = { ...readSettings(), ...changes };
  localStorage.setItem('modapp_settings', JSON.stringify(updated));
  return updated;
}

async function readMods() {
  if (window.nativeAPIReady) await window.nativeAPIReady;

  if (window.appAPI?.listMods) {
    const mods = await window.appAPI.listMods();

    return mods.map((mod) => ({
      ...mod,
      core: mod.id === 'core',
      enabled: mod.id === 'core' ? true : !!mod.enabled,
    }));
  }

  // Browser fallback
  const saved = JSON.parse(localStorage.getItem('modapp_mods') || '{}');

  return (window.MOD_MANIFESTS || []).map((mod) => ({
    ...mod,
    core: mod.id === 'core',
    enabled:
      mod.id === 'core'
        ? true
        : saved[mod.id] !== undefined
          ? !!saved[mod.id]
          : mod.enabled !== undefined
            ? !!mod.enabled
            : mod.enabledByDefault !== false,
  }));
}

// ---------------- Home Page ----------------

function renderHomePage(container) {
  container.innerHTML = `
    <div class="home-content">
      <h1>Welcome to modapp</h1>
      <p class="muted">This is your modular dashboard. Customize it with mods to make it your own.</p>
      <div class="home-features">
        <div class="feature-card">
          <span class="feature-icon">extension</span>
          <h3>Mods</h3>
          <p>Add functionality with modular components</p>
        </div>
        <div class="feature-card">
          <span class="feature-icon">settings</span>
          <h3>Customize</h3>
          <p>Tailor the experience to your needs</p>
        </div>
        <div class="feature-card">
          <span class="feature-icon">tune</span>
          <h3>Configure</h3>
          <p>Fine-tune every aspect of your dashboard</p>
        </div>
      </div>
    </div>
  `;
}

// ---------------- Settings ----------------

function applySettingsToShell(settings) {
  // --accent has its own legacy fallback chain (older saves only ever set
  // accentColor); every other var only gets touched if the user actually
  // customized it, so the shell's own CSS defaults keep working otherwise.
  const accent = settings.themeVars?.['--accent'] || settings.accentColor || '#3b82f6';
  document.documentElement.style.setProperty('--accent', accent);

  if (settings.themeVars) {
    for (const [key, value] of Object.entries(settings.themeVars)) {
      if (key === '--accent' || !value || !key.startsWith('--')) continue;
      document.documentElement.style.setProperty(key, value);
    }
  }

  document.body.classList.toggle('reduce-motion', !!settings.reduceMotion);
}

const SETTINGS_SECTIONS = [
  { id: 'general', label: 'General', icon: 'tune', width: '480px', height: '520px', render: renderGeneralSection },
  { id: 'mods', label: 'Mods', icon: 'extension', width: '640px', height: 'min(650px, 90vh)', contentHeight: 'min(600px, calc(90vh - 50px))', render: renderModsSection },
  { id: 'updates', label: 'Updates', icon: 'update', width: '480px', height: '340px', render: renderUpdatesSection },
];

// Every CSS var the shell exposes for theming (colors only -- fonts are a
// separate concern from a color picker). Order here is render order.
const THEME_VARS = [
  { key: '--bg', label: 'Background' },
  { key: '--panel', label: 'Panel' },
  { key: '--panel-2', label: 'Panel (alt)' },
  { key: '--border', label: 'Border' },
  { key: '--text', label: 'Text' },
  { key: '--muted', label: 'Muted text' },
  { key: '--accent', label: 'Accent' },
  { key: '--warm', label: 'Warm accent' },
  { key: '--danger', label: 'Danger' },
];

// Full palettes, not just an accent swap -- each preset sets every var above
// as one coherent bundle. --bg sits a shade darker than --panel so surfaces
// still layer correctly (mirrors the shell's own bg/panel/panel-2 relationship).
const THEME_PRESETS = [
  { id: 'midnight', label: 'Midnight', vars: { '--bg': '#0b111c', '--panel': '#111827', '--panel-2': '#1a2333', '--border': '#242e3f', '--text': '#e5e9f0', '--muted': '#8b93a3', '--accent': '#3b82f6', '--warm': '#f59e0b', '--danger': '#ef4444' } },
  { id: 'aurora', label: 'Aurora', vars: { '--bg': '#0d0c17', '--panel': '#14121f', '--panel-2': '#1e1a30', '--border': '#2c2645', '--text': '#ece9f7', '--muted': '#9a92b8', '--accent': '#8b5cf6', '--warm': '#fb923c', '--danger': '#f43f5e' } },
  { id: 'sunset', label: 'Sunset', vars: { '--bg': '#140d0a', '--panel': '#1c1410', '--panel-2': '#2a1d15', '--border': '#3d2a1c', '--text': '#f3e9df', '--muted': '#b09a89', '--accent': '#f59e0b', '--warm': '#f43f5e', '--danger': '#ef4444' } },
  { id: 'forest', label: 'Forest', vars: { '--bg': '#0a100c', '--panel': '#0f1712', '--panel-2': '#16221b', '--border': '#243b2d', '--text': '#e3f0e8', '--muted': '#8fab9b', '--accent': '#22c55e', '--warm': '#f59e0b', '--danger': '#f87171' } },
  { id: 'rose', label: 'Rose', vars: { '--bg': '#120a0c', '--panel': '#1a1013', '--panel-2': '#26161b', '--border': '#3a2129', '--text': '#f5e6ea', '--muted': '#b28e96', '--accent': '#f43f5e', '--warm': '#fbbf24', '--danger': '#dc2626' } },
  { id: 'ocean', label: 'Ocean', vars: { '--bg': '#070f11', '--panel': '#0c1618', '--panel-2': '#132025', '--border': '#1d3238', '--text': '#e2eef0', '--muted': '#87a3a8', '--accent': '#14b8a6', '--warm': '#fb923c', '--danger': '#ef4444' } },
  { id: 'slate', label: 'Slate', vars: { '--bg': '#0d0f12', '--panel': '#12151a', '--panel-2': '#1b1f26', '--border': '#2a2f38', '--text': '#e8eaed', '--muted': '#9098a3', '--accent': '#64748b', '--warm': '#f59e0b', '--danger': '#ef4444' } },
  { id: 'cyber', label: 'Cyber', vars: { '--bg': '#05070d', '--panel': '#0b1020', '--panel-2': '#121a33', '--border': '#20304f', '--text': '#e6f1ff', '--muted': '#7c93b8', '--accent': '#22d3ee', '--warm': '#f472b6', '--danger': '#f43f5e' } },
  { id: 'coral', label: 'Coral', vars: { '--bg': '#160d0d', '--panel': '#1f1312', '--panel-2': '#2c1b19', '--border': '#402823', '--text': '#f7e9e4', '--muted': '#c4a89d', '--accent': '#fb7185', '--warm': '#fb923c', '--danger': '#dc2626' } },
  { id: 'lavender', label: 'Lavender', vars: { '--bg': '#100c17', '--panel': '#171223', '--panel-2': '#211a31', '--border': '#312748', '--text': '#efe9f9', '--muted': '#a99cc4', '--accent': '#c084fc', '--warm': '#f0abfc', '--danger': '#f43f5e' } },
  { id: 'emerald', label: 'Emerald', vars: { '--bg': '#08120d', '--panel': '#0d1a13', '--panel-2': '#14261c', '--border': '#1f3a2c', '--text': '#e5f5ec', '--muted': '#8ab29c', '--accent': '#10b981', '--warm': '#fbbf24', '--danger': '#ef4444' } },
  { id: 'crimson', label: 'Crimson', vars: { '--bg': '#150707', '--panel': '#1e0c0c', '--panel-2': '#2b1212', '--border': '#421c1c', '--text': '#f6e6e6', '--muted': '#c79797', '--accent': '#e11d48', '--warm': '#f97316', '--danger': '#f87171' } },
  { id: 'arctic', label: 'Arctic', vars: { '--bg': '#0a1014', '--panel': '#101820', '--panel-2': '#182430', '--border': '#24343f', '--text': '#eaf4f8', '--muted': '#93aab5', '--accent': '#38bdf8', '--warm': '#fcd34d', '--danger': '#f87171' } },
  { id: 'mocha', label: 'Mocha', vars: { '--bg': '#120d0a', '--panel': '#1c140e', '--panel-2': '#281d14', '--border': '#3a2c1e', '--text': '#f1e4d3', '--muted': '#b89e83', '--accent': '#d97706', '--warm': '#f59e0b', '--danger': '#ef4444' } },
  // "Noir" family: same near-black bg/panel scale throughout, only the accent (and a
  // matching warm tone) changes between them.
  { id: 'noir-red', label: 'Noir Red', vars: { '--bg': '#000000', '--panel': '#0a0a0a', '--panel-2': '#141414', '--border': '#242424', '--text': '#f5f5f5', '--muted': '#8a8a8a', '--accent': '#ef4444', '--warm': '#f97316', '--danger': '#f87171' } },
  { id: 'noir-blue', label: 'Noir Blue', vars: { '--bg': '#000000', '--panel': '#0a0a0a', '--panel-2': '#141414', '--border': '#242424', '--text': '#f5f5f5', '--muted': '#8a8a8a', '--accent': '#3b82f6', '--warm': '#f59e0b', '--danger': '#ef4444' } },
  { id: 'noir-green', label: 'Noir Green', vars: { '--bg': '#000000', '--panel': '#0a0a0a', '--panel-2': '#141414', '--border': '#242424', '--text': '#f5f5f5', '--muted': '#8a8a8a', '--accent': '#22c55e', '--warm': '#fbbf24', '--danger': '#ef4444' } },
  { id: 'noir-purple', label: 'Noir Purple', vars: { '--bg': '#000000', '--panel': '#0a0a0a', '--panel-2': '#141414', '--border': '#242424', '--text': '#f5f5f5', '--muted': '#8a8a8a', '--accent': '#a855f7', '--warm': '#f472b6', '--danger': '#ef4444' } },
  { id: 'noir-orange', label: 'Noir Orange', vars: { '--bg': '#000000', '--panel': '#0a0a0a', '--panel-2': '#141414', '--border': '#242424', '--text': '#f5f5f5', '--muted': '#8a8a8a', '--accent': '#f97316', '--warm': '#fbbf24', '--danger': '#ef4444' } },
  { id: 'noir-cyan', label: 'Noir Cyan', vars: { '--bg': '#000000', '--panel': '#0a0a0a', '--panel-2': '#141414', '--border': '#242424', '--text': '#f5f5f5', '--muted': '#8a8a8a', '--accent': '#06b6d4', '--warm': '#f472b6', '--danger': '#ef4444' } },
  { id: 'noir-pink', label: 'Noir Pink', vars: { '--bg': '#000000', '--panel': '#0a0a0a', '--panel-2': '#141414', '--border': '#242424', '--text': '#f5f5f5', '--muted': '#8a8a8a', '--accent': '#ec4899', '--warm': '#fbbf24', '--danger': '#ef4444' } },
];

function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toHex = (x) => Math.round(255 * x).toString(16).padStart(2, '0');
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
}

function randomThemeVars() {
  const hue = Math.floor(Math.random() * 360);
  const warmHue = 20 + Math.random() * 30; // stays in the orange/amber range regardless of the base hue
  return {
    '--bg': hslToHex(hue, 30, 6),
    '--accent': hslToHex(hue, 70, 60),
    '--warm': hslToHex(warmHue, 75, 62),
    '--panel': hslToHex(hue, 30, 10),
    '--panel-2': hslToHex(hue, 28, 14),
    '--border': hslToHex(hue, 25, 20),
    '--text': hslToHex(hue, 15, 92),
    '--muted': hslToHex(hue, 12, 60),
    '--danger': '#ef4444',
  };
}

// Converts any valid CSS color (hex, rgb(), hsl(), named) to #rrggbb so it
// can seed an <input type="color">, which only accepts that format.
function toHexColor(cssColor) {
  if (!cssColor) return '#3b82f6';
  const probe = document.createElement('div');
  probe.style.color = cssColor;
  document.body.appendChild(probe);
  const rgb = getComputedStyle(probe).color;
  document.body.removeChild(probe);
  const nums = rgb.match(/[\d.]+/g);
  if (!nums) return '#3b82f6';
  const [r, g, b] = nums.map(Number);
  const toHex = (x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

async function renderGeneralSection(container) {
  container.innerHTML = '<p class="muted">Loading\u2026</p>';
  const s = await loadSettings();
  const themeVars = { ...s.themeVars };

  function currentValue(key) {
    if (themeVars[key]) return themeVars[key];
    if (key === '--accent' && s.accentColor) return s.accentColor;
    return getComputedStyle(document.documentElement).getPropertyValue(key).trim() || '#3b82f6';
  }

  async function applyAndSave(vars) {
    for (const [key, value] of Object.entries(vars)) {
      document.documentElement.style.setProperty(key, value);
    }
    const latest = await loadSettings();
    await writeSettings({ themeVars: { ...latest.themeVars, ...vars }, accentColor: vars['--accent'] || latest.accentColor });
  }

  container.innerHTML = `
    <div class="settings-section-title">Presets</div>
    <div class="theme-preset-row"></div>
    <div class="settings-section-title" style="margin-top:18px;">Customize</div>
    <div class="theme-vars-list"></div>
    <button type="button" class="theme-reset-btn">Reset to default</button>
  `;

  const presetRow = container.querySelector('.theme-preset-row');
  const isActivePreset = (preset) => THEME_VARS.every(
    ({ key }) => preset.vars[key] && toHexColor(currentValue(key)).toLowerCase() === preset.vars[key].toLowerCase()
  );

  const select = document.createElement('select');
  select.className = 'theme-preset-select settings-select';

  const customOption = document.createElement('option');
  customOption.value = '';
  customOption.textContent = 'Custom';
  select.appendChild(customOption);

  for (const preset of THEME_PRESETS) {
    const opt = document.createElement('option');
    opt.value = preset.id;
    opt.textContent = preset.label;
    select.appendChild(opt);
  }

  const activePreset = THEME_PRESETS.find(isActivePreset);
  select.value = activePreset ? activePreset.id : '';

  select.addEventListener('change', async () => {
    if (!select.value) return; // "Custom" is just the current-state placeholder, not a pickable action
    const preset = THEME_PRESETS.find((p) => p.id === select.value);
    if (!preset) return;
    await applyAndSave(preset.vars);
    renderGeneralSection(container);
  });
  presetRow.appendChild(select);

  const randomBtn = document.createElement('button');
  randomBtn.type = 'button';
  randomBtn.className = 'theme-preset-random';
  randomBtn.title = 'Random theme';
  randomBtn.textContent = '\u{1F3B2}';
  randomBtn.addEventListener('click', async () => {
    await applyAndSave(randomThemeVars());
    renderGeneralSection(container);
  });
  presetRow.appendChild(randomBtn);

  const varsList = container.querySelector('.theme-vars-list');
  for (const varDef of THEME_VARS) {
    const row = document.createElement('div');
    row.className = 'theme-var-row';

    const label = document.createElement('span');
    label.className = 'theme-var-label';
    label.textContent = varDef.label;

    const input = document.createElement('input');
    input.type = 'color';
    input.className = 'settings-color';
    input.value = toHexColor(currentValue(varDef.key));

    // Live preview while dragging, persist once the picker closes.
    input.addEventListener('input', () => {
      document.documentElement.style.setProperty(varDef.key, input.value);
    });
    input.addEventListener('change', async () => {
      await applyAndSave({ [varDef.key]: input.value });
    });

    row.append(label, input);
    varsList.appendChild(row);
  }

  container.querySelector('.theme-reset-btn').addEventListener('click', async () => {
    for (const varDef of THEME_VARS) document.documentElement.style.removeProperty(varDef.key);
    document.documentElement.style.setProperty('--accent', '#3b82f6');
    await writeSettings({ themeVars: {}, accentColor: null });
    renderGeneralSection(container);
  });
}

let modsChanged = false;

// ---------------- updates ----------------
// The confirmation lives in the page, not in a native dialog: an overlay shows the
// version change and the release notes (markdown) and asks before installing.

let updateDialogOpen = false;

function formatUpdateDate(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime())
    ? date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
    : '';
}

// Resolves when the dialog closes. If an install starts, it stays open until the app restarts.
function showUpdateDialog(info) {
  if (updateDialogOpen) return Promise.resolve();
  updateDialogOpen = true;
  const returnFocus = document.activeElement;

  const overlay = document.createElement('div');
  overlay.className = 'update-overlay';
  overlay.innerHTML = `
    <div class="update-dialog" role="dialog" aria-modal="true" aria-labelledby="update-dialog-title">
      <h2 id="update-dialog-title" class="update-title">Update available</h2>
      <div class="update-versions"></div>
      <div class="update-notes" tabindex="0" aria-label="Release notes"></div>
      <div class="update-progress" hidden><div class="update-progress-bar"></div></div>
      <p class="update-message" role="status"></p>
      <div class="update-actions">
        <button type="button" class="update-link-btn" data-action="release">View on GitHub</button>
        <span class="update-spacer"></span>
        <button type="button" class="theme-reset-btn" data-action="later">Later</button>
        <button type="button" class="save-btn" data-action="install">Install and restart</button>
      </div>
    </div>
  `;

  const versions = overlay.querySelector('.update-versions');
  const date = formatUpdateDate(info.date);
  versions.textContent = `Version ${info.currentVersion} \u2192 ${info.version}${date ? ` \u00b7 ${date}` : ''}`;

  const notes = overlay.querySelector('.update-notes');
  if (info.body && ModAPI.setMarkdown) {
    ModAPI.setMarkdown(notes, info.body);
  } else if (info.body) {
    notes.classList.add('update-notes-plain');
    notes.textContent = info.body;
  } else {
    notes.classList.add('update-notes-empty');
    notes.textContent = 'No release notes were published for this version.';
  }

  const progress = overlay.querySelector('.update-progress');
  const bar = overlay.querySelector('.update-progress-bar');
  const message = overlay.querySelector('.update-message');
  const installBtn = overlay.querySelector('[data-action="install"]');
  const laterBtn = overlay.querySelector('[data-action="later"]');
  const releaseBtn = overlay.querySelector('[data-action="release"]');
  if (!info.releaseUrl || !window.electronAPI?.openExternal) releaseBtn.hidden = true;

  let installing = false;
  let stopProgress = null;

  return new Promise((resolve) => {
    function close() {
      if (installing) return;
      document.removeEventListener('keydown', onKeydown, true);
      overlay.remove();
      updateDialogOpen = false;
      document.dispatchEvent(new CustomEvent('mods:overlay-closed'));
      if (returnFocus?.focus) returnFocus.focus();
      resolve();
    }

    function onKeydown(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close();
      } else if (event.key === 'Tab') {
        const focusable = [...overlay.querySelectorAll('button:not([disabled]):not([hidden]), [tabindex="0"]')];
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    }

    async function install() {
      installing = true;
      installBtn.disabled = true;
      laterBtn.disabled = true;
      message.classList.remove('error');
      message.textContent = 'Downloading update\u2026';
      progress.hidden = false;
      bar.style.width = '0%';
      stopProgress = window.electronAPI?.onUpdateProgress?.((p) => {
        const percent = Math.max(0, Math.min(100, Math.round(p.percent || 0)));
        bar.style.width = `${percent}%`;
        message.textContent = `Downloading update\u2026 ${percent}%`;
      });

      try {
        const result = await window.appAPI.installUpdate();
        if (result.installed) {
          bar.style.width = '100%';
          message.textContent = 'Restarting to finish the update\u2026';
          return; // the app quits; the dialog stays up until then
        }
        if (result.busy) throw new Error('an update is already being installed');
        throw new Error('this update is no longer available');
      } catch (error) {
        installing = false;
        progress.hidden = true;
        message.classList.add('error');
        message.textContent = `Update failed: ${error.message || error}`;
        installBtn.textContent = 'Try again';
        installBtn.disabled = false;
        laterBtn.disabled = false;
      } finally {
        if (stopProgress) { stopProgress(); stopProgress = null; }
      }
    }

    installBtn.addEventListener('click', install);
    laterBtn.addEventListener('click', close);
    releaseBtn.addEventListener('click', () => window.electronAPI.openExternal(info.releaseUrl).catch(() => {}));
    overlay.addEventListener('mousedown', (event) => { if (event.target === overlay) close(); });
    document.addEventListener('keydown', onKeydown, true);

    document.body.appendChild(overlay);
    document.dispatchEvent(new CustomEvent('mods:overlay-opened'));
    installBtn.focus();
  });
}

// A small non-modal notice for "an update is available". It is what the user sees when the startup
// pop-up is turned off (Settings > Updates), and after they pick "Later" on the pop-up. Clicking it opens
// the same dialog, which is where they request the install.
let updateBadge = null;

function showUpdateBadge(info) {
  if (updateBadge?.isConnected) return;
  const badge = document.createElement('div');
  badge.className = 'update-badge';
  badge.innerHTML = `
    <button type="button" class="update-badge-main" title="View release notes and install">
      <span class="update-badge-icon" aria-hidden="true">system_update_alt</span>
      <span class="update-badge-text"></span>
    </button>
    <button type="button" class="update-badge-close" aria-label="Dismiss" title="Dismiss">\u00d7</button>
  `;
  badge.querySelector('.update-badge-text').textContent = `Update ${info.version} available`;
  badge.querySelector('.update-badge-main').addEventListener('click', () => showUpdateDialog(info));
  badge.querySelector('.update-badge-close').addEventListener('click', () => badge.remove());
  document.body.appendChild(badge);
  updateBadge = badge;
}

async function renderUpdatesSection(container) {
  container.innerHTML = `
    <div class="settings-section-title">Updates</div>
    <p class="muted update-status">Checking for updates\u2026</p>
    <button type="button" class="theme-reset-btn update-action-btn" style="display:none;"></button>
    <div class="settings-field-wrap update-pref">
      <div class="settings-field">
        <div class="settings-field-text">
          <label class="settings-field-label" for="update-modal-toggle">Show update pop-up</label>
          <div class="settings-field-desc">Open the update window at startup when a new version is available. When off, a small notice appears instead.</div>
        </div>
        <input type="checkbox" id="update-modal-toggle" class="update-modal-toggle" checked>
      </div>
    </div>
  `;

  const status = container.querySelector('.update-status');
  const actionBtn = container.querySelector('.update-action-btn');
  const modalToggle = container.querySelector('.update-modal-toggle');

  loadSettings().then((saved) => { modalToggle.checked = saved.updateModal !== false; }).catch(() => {});
  modalToggle.addEventListener('change', async () => {
    try {
      await writeSettings({ updateModal: modalToggle.checked });
    } catch (error) {
      console.error('Failed to save update pop-up setting:', error);
      modalToggle.checked = !modalToggle.checked;
    }
  });

  async function check() {
    status.textContent = 'Checking for updates\u2026';
    actionBtn.style.display = 'none';

    let result;
    try {
      result = await window.appAPI.checkForUpdates();
    } catch (error) {
      status.textContent = `Couldn't check for updates: ${error?.message || error}`;
      return;
    }

    if (result.configured === false) {
      status.textContent = 'Updates aren\u2019t configured for this build.';
      return;
    }

    if (!result.available) {
      status.textContent = 'You\u2019re up to date.';
      actionBtn.textContent = 'Check again';
      actionBtn.style.display = '';
      actionBtn.onclick = check;
      return;
    }

    status.textContent = `Version ${result.version} is available (you have ${result.currentVersion}).`;
    actionBtn.textContent = 'View update\u2026';
    actionBtn.style.display = '';
    actionBtn.onclick = () => showUpdateDialog(result);
  }

  check();
}

// A file dropped anywhere else must not make the window navigate to it.
for (const type of ['dragover', 'drop']) {
  document.addEventListener(type, (event) => {
    if ([...(event.dataTransfer?.types || [])].includes('Files')) event.preventDefault();
  });
}

// IPC errors arrive as "Error invoking remote method 'x': Error: message"; show just the message.
const cleanError = (error) => String(error?.message || error).replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '');

// The "Install mod" pop-up: pick where the mod comes from. Resolves with { kind: 'zip' | 'folder' },
// { kind: 'url', url }, or null if cancelled. The actual file/folder picking happens in a native dialog afterwards.
function chooseModSource() {
  const SOURCES = {
    zip: { label: 'Zip file', text: 'Pick a .zip file from your computer.', action: 'Choose zip…' },
    folder: { label: 'Folder', text: 'Pick a mod folder, the one that contains mod.json.', action: 'Choose folder…' },
    url: {
      label: 'Zip URL',
      text: 'Paste a link to a .zip file, or to a GitHub repository (github.com/owner/repo, a branch or a release tag).',
      action: 'Install',
    },
  };

  return new Promise((resolve) => {
    const previousFocus = document.activeElement;
    const overlay = document.createElement('div');
    overlay.className = 'update-overlay';
    overlay.innerHTML = `
      <div class="update-dialog install-dialog" role="dialog" aria-modal="true" aria-labelledby="install-title">
        <h2 class="update-title" id="install-title">Install a mod</h2>
        <div class="install-tabs">
          ${Object.entries(SOURCES).map(([kind, source]) => `
            <button type="button" class="install-tab" data-kind="${kind}" aria-pressed="false">${source.label}</button>`).join('')}
        </div>
        <p class="install-text"></p>
        <input type="text" class="settings-input install-url" placeholder="https://example.com/my-mod.zip"
          spellcheck="false" aria-label="Zip or GitHub link" hidden>
        <p class="update-message error install-error"></p>
        <div class="update-actions">
          <span class="update-spacer"></span>
          <button type="button" class="theme-reset-btn" data-cancel>Cancel</button>
          <button type="button" class="save-btn install-go"></button>
        </div>
      </div>
    `;

    const text = overlay.querySelector('.install-text');
    const input = overlay.querySelector('.install-url');
    const error = overlay.querySelector('.install-error');
    const go = overlay.querySelector('.install-go');
    let kind = 'zip';

    const finish = (value) => {
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      previousFocus?.focus?.();
      resolve(value);
    };

    const select = (next) => {
      kind = next;
      overlay.querySelectorAll('.install-tab').forEach((tab) => tab.setAttribute('aria-pressed', String(tab.dataset.kind === kind)));
      text.textContent = SOURCES[kind].text;
      go.textContent = SOURCES[kind].action;
      input.hidden = kind !== 'url';
      error.textContent = '';
      (kind === 'url' ? input : go).focus();
    };

    const submit = () => {
      if (kind !== 'url') return finish({ kind });
      const url = input.value.trim();
      if (!url) { error.textContent = 'Paste a link first.'; input.focus(); return; }
      finish({ kind: 'url', url });
    };

    const onKey = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish(null); }
      else if (event.key === 'Enter' && event.target === input) { event.preventDefault(); submit(); }
    };

    overlay.querySelectorAll('.install-tab').forEach((tab) => tab.addEventListener('click', () => select(tab.dataset.kind)));
    overlay.querySelector('[data-cancel]').addEventListener('click', () => finish(null));
    go.addEventListener('click', submit);
    document.addEventListener('keydown', onKey, true);

    document.body.appendChild(overlay);
    select('zip');
  });
}

async function renderModsSection(container, notice = '', noticeIsError = false) {
  container.innerHTML = '<p class="muted">Loading mods…</p>';

  try {
    const mods = await window.appAPI.listMods();
    const list = Array.isArray(mods) ? mods : [];
    // Core is always first and can't be moved or deleted; the arrows only reorder the rest.
    const movable = list.filter((mod) => !mod.core).map((mod) => mod.id);

    container.innerHTML = `
      <div class="settings-section-title">Mods</div>

      <div class="mods-toolbar">
        <button type="button" class="save-btn" data-install>Install mod…</button>
        <span class="settings-note muted mods-hint">or drop a .zip or a folder here. Drag mods to change their load order.</span>
      </div>
      <p class="settings-note muted mods-message" role="status"></p>

      ${list.length === 0 ? '<p class="muted">No mods found.</p>' : `
      <div class="mod-list">
        ${list.map((mod) => {
          const position = movable.indexOf(mod.id);
          return `
          <div class="mod-row" ${mod.core ? '' : `draggable="true" data-mod-id="${escapeHtml(mod.id)}"`}>
            <span class="mod-handle" aria-hidden="true">${mod.core ? '' : 'drag_indicator'}</span>
            <span class="connector" style="background:${colorForId(mod.id)}"></span>

            <div class="mod-info">
              <div class="mod-name">${escapeHtml(mod.name || mod.id)}</div>
              <div class="mod-desc">${escapeHtml(mod.description || '')}</div>
            </div>

            ${mod.core ? '<span class="core-badge">Core</span>' : `
              <div class="mod-actions">
                <button type="button" class="mod-icon-btn" data-move="-1" data-mod-id="${escapeHtml(mod.id)}"
                  aria-label="Load earlier" title="Load earlier" ${position <= 0 ? 'disabled' : ''}>keyboard_arrow_up</button>
                <button type="button" class="mod-icon-btn" data-move="1" data-mod-id="${escapeHtml(mod.id)}"
                  aria-label="Load later" title="Load later" ${position === movable.length - 1 ? 'disabled' : ''}>keyboard_arrow_down</button>
                <button type="button" class="mod-icon-btn danger" data-delete data-mod-id="${escapeHtml(mod.id)}"
                  aria-label="Delete mod" title="Delete mod">delete</button>
              </div>
              <button class="toggle ${mod.enabled ? 'on' : ''}" data-mod-id="${escapeHtml(mod.id)}" type="button">
                ${mod.enabled ? 'On' : 'Off'}
              </button>`}
          </div>`;
        }).join('')}
      </div>`}
    `;

    const message = container.querySelector('.mods-message');
    const setMessage = (text, isError = false) => {
      message.textContent = text;
      message.classList.toggle('error', isError);
    };
    setMessage(notice, noticeIsError);

    // One place for "do something, then redraw". Any change reloads the app when Settings closes.
    const run = async (task, success) => {
      container.querySelectorAll('button').forEach((button) => { button.disabled = true; });
      try {
        const result = await task();
        const nothingDone = result?.canceled || result?.removed === false || (Array.isArray(result) && result.length === 0);
        if (nothingDone) return renderModsSection(container);
        modsChanged = true;
        return renderModsSection(container, typeof success === 'function' ? success(result) : success);
      } catch (error) {
        console.error('Mod change failed:', error);
        return renderModsSection(container, cleanError(error), true);
      }
    };

    const installed = (result) => (Array.isArray(result)
      ? `Installed ${result.map((item) => `"${item.name}"`).join(', ')}. ${result.length > 1 ? 'They load' : 'It loads'} when you close Settings.`
      : `${result.replaced ? 'Replaced' : 'Installed'} "${result.name}". It loads when you close Settings.`);

    container.querySelector('[data-install]').addEventListener('click', async () => {
      const choice = await chooseModSource();
      if (!choice) return;
      run(
        () => (choice.kind === 'url' ? window.appAPI.installModFromUrl(choice.url) : window.appAPI.installMod(choice.kind)),
        installed,
      );
    });

    container.querySelectorAll('.toggle').forEach((button) => {
      button.addEventListener('click', () => run(() => window.appAPI.toggleMod(button.dataset.modId)));
    });

    container.querySelectorAll('[data-move]').forEach((button) => {
      button.addEventListener('click', () => {
        const order = [...movable];
        const from = order.indexOf(button.dataset.modId);
        const to = from + Number(button.dataset.move);
        if (from < 0 || to < 0 || to >= order.length) return;
        [order[from], order[to]] = [order[to], order[from]];
        run(() => window.appAPI.reorderMods(order), 'Load order saved. It applies when you close Settings.');
      });
    });

    container.querySelectorAll('[data-delete]').forEach((button) => {
      button.addEventListener('click', () => run(
        () => window.appAPI.removeMod(button.dataset.modId),
        'Mod deleted.',
      ));
    });

    // ---- drag and drop ----
    // 1) Drag a mod row to change its load order (Core is fixed at the top).
    let draggedId = null;
    const clearDropMarks = () => container.querySelectorAll('.drop-before, .drop-after')
      .forEach((row) => row.classList.remove('drop-before', 'drop-after'));
    // Where would the dragged mod land? Dropping on Core means "first", otherwise before/after the row under the pointer.
    const dropTarget = (row, event) => {
      if (row.classList.contains('core-row')) return { id: movable[0], after: false };
      const box = row.getBoundingClientRect();
      return { id: row.dataset.modId, after: event.clientY > box.top + box.height / 2 };
    };

    container.querySelectorAll('.mod-row').forEach((row) => {
      if (!row.dataset.modId) row.classList.add('core-row');

      row.addEventListener('dragstart', (event) => {
        if (!row.dataset.modId) return;
        draggedId = row.dataset.modId;
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('application/x-modapp-mod', draggedId);
        row.classList.add('dragging');
      });
      row.addEventListener('dragend', () => { draggedId = null; row.classList.remove('dragging'); clearDropMarks(); });

      row.addEventListener('dragover', (event) => {
        if (!draggedId) return; // a file drag is handled by the panel below
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        const target = dropTarget(row, event);
        clearDropMarks();
        container.querySelector(`.mod-row[data-mod-id="${CSS.escape(target.id)}"]`)
          ?.classList.add(target.after ? 'drop-after' : 'drop-before');
      });
      row.addEventListener('drop', (event) => {
        if (!draggedId) return;
        event.preventDefault();
        const moving = draggedId;
        const target = dropTarget(row, event);
        draggedId = null;
        clearDropMarks();
        const order = movable.filter((id) => id !== moving);
        const at = order.indexOf(target.id);
        if (at < 0 || moving === target.id) return;
        order.splice(target.after ? at + 1 : at, 0, moving);
        if (order.join() === movable.join()) return;
        run(() => window.appAPI.reorderMods(order), 'Load order saved. It applies when you close Settings.');
      });
    });

    // 2) Drop a .zip or a folder anywhere on the panel to install it.
    const hasFiles = (event) => [...(event.dataTransfer?.types || [])].includes('Files');
    container.ondragover = (event) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
      container.classList.add('mods-dropping');
    };
    container.ondragleave = (event) => {
      if (!container.contains(event.relatedTarget)) container.classList.remove('mods-dropping');
    };
    container.ondrop = (event) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      container.classList.remove('mods-dropping');
      const files = [...event.dataTransfer.files]; // read now: the list is cleared once the event ends
      if (files.length) run(() => window.appAPI.installDroppedMods(files), installed);
    };
  } catch (error) {
    console.error('Failed to load mods:', error);

    container.innerHTML = `
      <div class="settings-section-title">Mods</div>
      <p class="muted">Failed to load mods.</p>
    `;
  }
}

ModAPI.registerTab({
  id: 'home',
  label: 'Home',
  icon: 'home',
  render: renderHomePage,
});

ModAPI.registerWidget({
  id: 'settings',
  label: 'Settings',
  icon: 'settings',
  center: true,
  width: '680px',
  height: '600px',

  mount(container) {
    container.classList.add('settings-layout');
    container.innerHTML = `
      <div class="settings-sidebar"></div>
      <div class="settings-content"></div>
    `;

    const sidebar = container.querySelector('.settings-sidebar');
    const content = container.querySelector('.settings-content');

    // Core's own sections first, then whatever other mods registered
    // through ModAPI.registerSettingsSection -- a flat list, in
    // registration order. Each entry owns its own render(container).
    const registered = typeof ModAPI.getSettingsSections === 'function' ? ModAPI.getSettingsSections() : [];
    const entries = [
      ...SETTINGS_SECTIONS.map((s) => ({ id: s.id, label: s.label, icon: s.icon, width: s.width, height: s.height, contentHeight: s.contentHeight, render: s.render })),
      ...registered.map((s) => ({
        id: `x:${s.id}`, label: s.label, icon: s.icon, width: s.width, height: s.height,
        render: (target) => ModAPI.renderSettingsSection(s, target),
      })),
    ];

    // What the modal opens at (also set in the registerWidget call below) --
    // a section with no width/height of its own resets back to this.
    const DEFAULT_WIDTH = '680px';
    const DEFAULT_HEIGHT = '600px';
    const panel = container.closest('.floating-widget');

    for (const entry of entries) {
      const item = document.createElement('button');
      item.className = 'settings-nav-item';
      item.dataset.section = entry.id;
      item.title = entry.label;

      item.appendChild(Icon(entry.icon, { size: '17px' }));

      const label = document.createElement('span');
      label.textContent = entry.label;
      item.appendChild(label);

      item.addEventListener('click', () => selectSection(entry.id));

      sidebar.appendChild(item);
    }

    function selectSection(id) {
      const entry = entries.find((e) => e.id === id);
      if (!entry) return;

      sidebar
        .querySelectorAll('.settings-nav-item')
        .forEach((el) => el.classList.toggle('active', el.dataset.section === id));

      if (panel) {
        panel.style.width = entry.width || DEFAULT_WIDTH;
        panel.style.height = entry.height || DEFAULT_HEIGHT;
      }
      // Sections that want more room than the default scroll area (400px) say so with contentHeight.
      content.style.maxHeight = entry.contentHeight || '';

      // A fresh pane per selection: sections render asynchronously, so a slow
      // one (General) must not paint over the section picked after it.
      const pane = document.createElement('div');
      content.replaceChildren(pane);
      Promise.resolve().then(() => entry.render(pane)).catch((error) => {
        console.error(`[settings] section "${entry.id}" failed:`, error);
        const p = document.createElement('p');
        p.className = 'error';
        p.textContent = `This section failed to load: ${error?.message || error}`;
        pane.replaceChildren(p);
      });
    }

    selectSection('general');
  },

  onClose() {
    if (modsChanged) {
      modsChanged = false;
      window.location.reload();
    }
  },
});

// Apply saved settings once everything has loaded, and honor defaultTab by
// clicking the matching nav button.
document.addEventListener('mods:ready', async () => {
  try {
    const s = await loadSettings();
    ModAPI.setIdentity({ title: s.siteTitle, icon: s.siteIcon });
    applySettingsToShell(s);
    if (s.defaultTab) {
      const btn = document.querySelector(`.tab[data-id="${CSS.escape(s.defaultTab)}"]`);
      if (btn) btn.click();
    }
  } catch (error) {
    console.error('Failed to apply saved settings:', error);
  }
  checkForUpdatesOnStartup();
});

async function checkForUpdatesOnStartup() {
  if (!window.appAPI?.checkForUpdates) return;
  try {
    const result = await window.appAPI.checkForUpdates();
    if (!result?.available) return;
    const prefs = await loadSettings();
    // Pop-up on (the default): show it, and leave the notice behind if they pick "Later".
    // Pop-up off: just the notice.
    if (prefs.updateModal !== false) await showUpdateDialog(result);
    showUpdateBadge(result);
  } catch (error) {
    console.error('Update check failed:', error);
  }
}