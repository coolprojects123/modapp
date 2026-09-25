// This mod provides the app's settings widgets.

function escapeHtml(str) { return String(str ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
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

  return window.MOD_MANIFESTS.map((mod) => ({
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
      if (key === '--accent' || !value) continue;
      document.documentElement.style.setProperty(key, value);
    }
  }

  document.body.classList.toggle('reduce-motion', !!settings.reduceMotion);
}

const SETTINGS_SECTIONS = [
  { id: 'general', label: 'General', icon: 'tune', width: '480px', height: '520px', render: renderGeneralSection },
  { id: 'mods', label: 'Mods', icon: 'extension', width: '480px', height: '440px', render: renderModsSection },
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

async function renderModsSection(container) {
  container.innerHTML = '<p class="muted">Loading mods…</p>';

  try {
    const mods = await window.appAPI.listMods();

    if (!Array.isArray(mods) || mods.length === 0) {
      container.innerHTML = `
        <div class="settings-section-title">Mods</div>
        <p class="muted">No mods found.</p>
      `;
      return;
    }

    container.innerHTML = `
      <div class="settings-section-title">Mods</div>

      <div class="mod-list">
        ${mods.map((mod) => `
          <div class="mod-row">
            <span
              class="connector"
              style="background:${colorForId(mod.id)}"
            ></span>

            <div class="mod-info">
              <div class="mod-name">
                ${escapeHtml(mod.name || mod.id)}
              </div>

              <div class="mod-desc">
                ${escapeHtml(mod.description || '')}
              </div>
            </div>

            ${
              mod.core
                ? '<span class="core-badge">Core</span>'
                : `
                  <button
                    class="toggle ${mod.enabled ? 'on' : ''}"
                    data-mod-id="${escapeHtml(mod.id)}"
                    type="button"
                  >
                    ${mod.enabled ? 'On' : 'Off'}
                  </button>
                `
            }
          </div>
        `).join('')}
      </div>
    `;

    container
      .querySelectorAll('.toggle')
      .forEach((button) => {
        button.addEventListener('click', async () => {
          const modId = button.dataset.modId;

          button.disabled = true;

          try {
            await window.appAPI.toggleMod(modId);

            modsChanged = true;

            await renderModsSection(container);
          } catch (error) {
            console.error(
              `Failed to toggle mod "${modId}":`,
              error
            );

            button.disabled = false;
          }
        });
      });
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
  overlay: true,
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
      ...SETTINGS_SECTIONS.map((s) => ({ id: s.id, label: s.label, icon: s.icon, width: s.width, height: s.height, render: s.render })),
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

      // A fresh pane per selection: sections render asynchronously, so a slow
      // one (General) must not paint over the section picked after it.
      const pane = document.createElement('div');
      content.replaceChildren(pane);
      entry.render(pane);
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
  const s = await loadSettings();
  ModAPI.setIdentity({ title: s.siteTitle, icon: s.siteIcon });
  applySettingsToShell(s);
  if (s.defaultTab) {
    const btn = document.querySelector(`.tab[data-id="${s.defaultTab}"]`);
    if (btn) btn.click();
  }
});