/**
 * settings.js â Calendar's own Settings section (Settings > Tabs > Calendar).
 * Lets you recolor and rename each calendar: "My events" (manual) and every
 * synced source. Reads/writes the same sources.json and prefs.json files
 * js/tab.js already owns, via the same fs.forMod('calendar') sandbox -- no
 * separate settings.json, so there's only one place calendar data lives.
 *
 * NOTE: this file keeps its own small copies of the file read/write helpers
 * and the PALETTE array rather than sharing tab.js's (which are private to
 * its closure). If tab.js's storage shape for sources.json/prefs.json ever
 * changes, this file needs the matching update.
 */
(function () {
  const MOD_ID = 'calendar';
  const MANUAL_COLOR_KEY = 'manualColor';
  const DEFAULT_MANUAL_COLOR = '#4caf6a'; // must match tab.js's MANUAL_CAL default
  const PALETTE = ['#5a8cff', '#e5a23c', '#b26be0', '#2fb8b0', '#e97a4b', '#e5484d', '#8a8f98'];

  const nativeFs = window.ModAPI.native.fs;
  const fs = nativeFs && nativeFs.forMod ? nativeFs.forMod(MOD_ID) : null;

  async function readJson(name, fallback) {
    if (!fs) return fallback;
    try {
      return JSON.parse(await fs.readFile(name));
    } catch {
      return fallback;
    }
  }
  const writeJson = (name, data) => (fs ? fs.writeFile(name, JSON.stringify(data, null, 2)) : Promise.resolve());

  const loadSources = () => readJson('sources.json', []);
  const saveSources = (s) => writeJson('sources.json', s);
  const loadPrefs = () => readJson('prefs.json', {});
  const savePrefs = (p) => writeJson('prefs.json', p);

  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  };

  function swatchRow(current, onPick) {
    const row = el('div', 'calx-settings-swatches');
    for (const c of PALETTE) {
      const b = el('button', 'calx-settings-swatch');
      b.type = 'button';
      b.style.setProperty('--c', c);
      b.classList.toggle('calx-settings-swatch--on', c.toLowerCase() === (current || '').toLowerCase());
      b.setAttribute('aria-label', `Color ${c}`);
      b.addEventListener('click', () => onPick(c));
      row.appendChild(b);
    }
    return row;
  }

  const SECTION = {
    id: 'colors',
    tab: 'calendar',
    label: 'Calendar',
    icon: 'calendar_month',

    async render(container) {
      if (!fs) {
        container.replaceChildren(el('p', 'muted', 'Calendar settings need the desktop build.'));
        return;
      }
      container.replaceChildren(el('p', 'muted', 'Loading\u2026'));

      let [sources, prefs] = await Promise.all([loadSources(), loadPrefs()]);

      const title = el('div', 'settings-section-title', 'Calendar colors');
      const list = el('div', 'calx-settings-list');
      const note = el('p', 'muted settings-note', 'Color changes show up next time the Calendar tab refreshes.');
      container.replaceChildren(title, list);

      function addRow({ name, color, editableName, onColor, onRename }) {
        const wrap = el('div', 'calx-settings-row');

        let nameEl;
        if (editableName) {
          nameEl = el('input', 'settings-input calx-settings-name');
          nameEl.type = 'text';
          nameEl.value = name;
          nameEl.addEventListener('change', () => {
            const next = nameEl.value.trim();
            if (next && next !== name) onRename(next);
            else nameEl.value = name;
          });
        } else {
          nameEl = el('span', 'calx-settings-name', name);
        }

        wrap.append(nameEl, swatchRow(color, onColor));
        list.appendChild(wrap);
      }

      const manualColor = prefs[MANUAL_COLOR_KEY] || DEFAULT_MANUAL_COLOR;
      addRow({
        name: 'My events',
        color: manualColor,
        editableName: false,
        async onColor(c) {
          prefs = { ...prefs, [MANUAL_COLOR_KEY]: c };
          await savePrefs(prefs);
          redraw();
        },
      });

      for (const source of sources) {
        addRow({
          name: source.name,
          color: source.color,
          editableName: true,
          async onColor(c) {
            source.color = c;
            await saveSources(sources);
            redraw();
          },
          async onRename(newName) {
            source.name = newName;
            await saveSources(sources);
            redraw();
          },
        });
      }

      if (!sources.length) {
        list.appendChild(el('p', 'muted', 'Add a calendar from the Calendar tab to give it its own color.'));
      }
      container.appendChild(note);

      function redraw() {
        // Re-render in place rather than re-running render() from scratch,
        // so a click's own swatch row updates immediately without an extra
        // disk round-trip for data we already have in memory.
        list.replaceChildren();
        addRow({
          name: 'My events',
          color: prefs[MANUAL_COLOR_KEY] || DEFAULT_MANUAL_COLOR,
          editableName: false,
          async onColor(c) {
            prefs = { ...prefs, [MANUAL_COLOR_KEY]: c };
            await savePrefs(prefs);
            redraw();
          },
        });
        for (const source of sources) {
          addRow({
            name: source.name,
            color: source.color,
            editableName: true,
            async onColor(c) {
              source.color = c;
              await saveSources(sources);
              redraw();
            },
            async onRename(newName) {
              source.name = newName;
              await saveSources(sources);
              redraw();
            },
          });
        }
      }
    },
  };

  // Register robustly: immediately if ModAPI is ready, otherwise keep
  // retrying until the host defines the API. The old
  // `registerSettingsSection?.()` silently no-op'd when this file loaded
  // before the host did, which is why the Calendar entry never showed up.
  let registered = false;
  function tryRegister() {
    if (registered) return true;
    if (typeof window.ModAPI?.registerSettingsSection === 'function') {
      window.ModAPI.registerSettingsSection(SECTION);
      registered = true;
      return true;
    }
    return false;
  }

  if (!tryRegister()) {
    document.addEventListener('mods:ready', tryRegister, { once: true });
    let tries = 0;
    const timer = setInterval(() => {
      if (tryRegister() || ++tries >= 40) clearInterval(timer); // ~10s max
    }, 250);
  }
})();