// This mod provides the app's settings and login widgets.

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
  document.documentElement.style.setProperty('--accent', settings.accentColor || '#3b82f6');
  document.body.classList.toggle('reduce-motion', !!settings.reduceMotion);
}

const SETTINGS_SECTIONS = [
  { id: 'general', label: 'General', icon: 'tune', render: renderGeneralSection },
  { id: 'mods', label: 'Mods', icon: 'extension', render: renderModsSection },
];

const THEMES = [
  { id: 'blue', label: 'Blue', color: '#3b82f6' },
  { id: 'violet', label: 'Violet', color: '#8b5cf6' },
  { id: 'teal', label: 'Teal', color: '#14b8a6' },
  { id: 'amber', label: 'Amber', color: '#f59e0b' },
  { id: 'rose', label: 'Rose', color: '#f43f5e' },
];

async function renderGeneralSection(container) {
  container.innerHTML = '<p class="muted">Loading\u2026</p>';
  const s = await loadSettings();

  container.innerHTML = `
    <div class="settings-section-title">Theme</div>
    <div class="theme-swatches"></div>
  `;

  const swatchRow = container.querySelector('.theme-swatches');
  for (const theme of THEMES) {
    const btn = document.createElement('button');
    btn.className = 'theme-swatch';
    btn.style.background = theme.color;
    btn.title = theme.label;
    btn.dataset.color = theme.color;
    const isActive = theme.color.toLowerCase() === (s.accentColor || '').toLowerCase();
    btn.classList.toggle('active', isActive);
    btn.textContent = isActive ? '\u2713' : '';

    btn.addEventListener('click', async () => {
      document.documentElement.style.setProperty('--accent', theme.color);
      swatchRow.querySelectorAll('.theme-swatch').forEach((el) => {
        const active = el.dataset.color === theme.color;
        el.classList.toggle('active', active);
        el.textContent = active ? '\u2713' : '';
      });
      await writeSettings({ accentColor: theme.color });
    });

    swatchRow.appendChild(btn);
  }
}

let modsChanged = false;

async function renderModsSection(container) {
  container.innerHTML = '<p class="muted">Loading modsâ¦</p>';

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

let unsubscribeGoto = null;

ModAPI.registerWidget({
  id: 'settings',
  label: 'Settings',
  icon: 'settings',
  center: true,
  overlay: true,
  width: '520px',

  mount(container, close) {
    container.classList.add('settings-layout');
    container.innerHTML = `
      <div class="settings-sidebar"></div>
      <div class="settings-content"></div>
    `;

    const sidebar = container.querySelector('.settings-sidebar');
    const content = container.querySelector('.settings-content');

    // Core's own sections first, then whatever other mods registered through
    // ModAPI.registerSettingsSection: tab-bound ones under "Tabs", the rest
    // under "More". Core doesn't know who they are.
    const registered = typeof ModAPI.getSettingsSections === 'function' ? ModAPI.getSettingsSections() : [];
    const entries = [
      ...SETTINGS_SECTIONS.map((s) => ({
        id: s.id, label: s.label, icon: s.icon, group: null,
        render: (target) => s.render(target),
      })),
      ...registered.map((s) => ({
        id: `x:${s.key || s.id}`, label: s.label, icon: s.icon, group: s.tab ? 'Tabs' : 'More', section: s,
        render: (target) => ModAPI.renderSettingsSection(s, target, { close }),
      })),
    ];

    let lastGroup = null;
    for (const entry of entries) {
      if (entry.group && entry.group !== lastGroup) {
        const heading = document.createElement('div');
        heading.className = 'settings-nav-group';
        heading.textContent = entry.group;
        sidebar.appendChild(heading);
      }
      lastGroup = entry.group;

      const item = document.createElement('button');
      item.className = 'settings-nav-item';
      item.dataset.section = entry.id;
      item.title = entry.label;

      item.appendChild(
        Icon(entry.icon, { size: '17px' })
      );

      const label = document.createElement('span');
      label.textContent = entry.label;
      item.appendChild(label);

      item.addEventListener('click', () => {
        selectSection(entry.id);
      });

      sidebar.appendChild(item);
    }

    function selectSection(id) {
      const entry = entries.find((e) => e.id === id);
      if (!entry) return;

      sidebar
        .querySelectorAll('.settings-nav-item')
        .forEach((el) => {
          el.classList.toggle(
            'active',
            el.dataset.section === id
          );
        });

      // A fresh pane per selection: sections render asynchronously, so a slow
      // one (General) must not paint over the section picked after it.
      const pane = document.createElement('div');
      content.replaceChildren(pane);
      entry.render(pane);
    }

    // A section id, a tab id or a mod id, as passed to ModAPI.openSettings().
    function resolveTarget(target) {
      if (!target) return null;
      const found =
        entries.find((e) => e.section && e.section.tab === target) ||
        entries.find((e) => e.id === target || (e.section && (e.section.id === target || e.section.source === target)));
      return found ? found.id : null;
    }

    if (typeof ModAPI.onSettingsGoto === 'function') {
      unsubscribeGoto = ModAPI.onSettingsGoto((target) => {
        const id = resolveTarget(target);
        if (id) selectSection(id);
      });
    }

    selectSection('general');
  },

  onClose() {
    if (unsubscribeGoto) {
      unsubscribeGoto();
      unsubscribeGoto = null;
    }
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

function getToken() { return localStorage.getItem('modapp_token'); }