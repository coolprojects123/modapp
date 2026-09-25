/**
 * settings.js — Calendar's own Settings section (Settings > Calendar).
 * Lets you recolor (palette or any custom color) and rename each calendar:
 * "My events" (manual) and every synced source, plus remove a source.
 * Reads/writes the same sources.json and prefs.json files js/tab.js
 * already owns, via the same fs.forMod('calendar') sandbox -- no separate
 * settings.json, so there's only one place calendar data lives.
 *
 * NOTE: keeps its own small copies of the file read/write helpers and the
 * PALETTE array rather than sharing tab.js's (private to its closure). If
 * tab.js's storage shape for sources.json/prefs.json ever changes, this
 * file needs the matching update.
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
  // Merge, don't overwrite -- tab.js's own persist() writes other prefs
  // keys (view, hidden, collapsed); stomping the whole file here would
  // lose those, same bug that was just fixed on tab.js's side.
  const savePrefs = async (changes) => writeJson('prefs.json', { ...(await loadPrefs()), ...changes });

  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  };

  function colorPicker(current, onPick) {
    const wrap = el('div', 'calx-settings-colors');

    const swatches = el('div', 'calx-settings-swatches');
    for (const c of PALETTE) {
      const b = el('button', 'calx-settings-swatch');
      b.type = 'button';
      b.style.setProperty('--c', c);
      b.classList.toggle('calx-settings-swatch--on', c.toLowerCase() === (current || '').toLowerCase());
      b.setAttribute('aria-label', `Color ${c}`);
      b.addEventListener('click', () => onPick(c));
      swatches.appendChild(b);
    }

    // A custom color isn't necessarily one of the seven swatches, so it
    // gets its own always-visible picker rather than a "custom..." button
    // that has to first be clicked to reveal it.
    const custom = el('input', 'calx-settings-custom-color');
    custom.type = 'color';
    custom.title = 'Custom color';
    custom.value = /^#[0-9a-f]{6}$/i.test(current || '') ? current : '#000000';
    custom.addEventListener('input', () => onPick(custom.value));

    wrap.append(swatches, custom);
    return wrap;
  }

  window.ModAPI.registerSettingsSection?.({
    id: 'colors',
    label: 'Calendar',
    icon: 'calendar_month',

    async render(container) {
      if (!fs) {
        container.replaceChildren(el('p', 'muted', 'Calendar settings need the desktop build.'));
        return;
      }
      container.replaceChildren(el('p', 'muted', 'Loading\u2026'));

      const [sources, prefs] = await Promise.all([loadSources(), loadPrefs()]);
      let manualColor = prefs[MANUAL_COLOR_KEY] || DEFAULT_MANUAL_COLOR;

      const title = el('div', 'settings-section-title', 'Calendar colors');
      const list = el('div', 'calx-settings-list');
      container.replaceChildren(title, list);

      function drawManualRow() {
        const card = el('div', 'calx-settings-card');
        const dot = el('span', 'calx-settings-dot');
        dot.style.setProperty('--dot', manualColor);
        const info = el('div', 'calx-settings-info');
        info.append(el('div', 'calx-settings-name-text', 'My events'), el('div', 'calx-settings-sub', 'Manually added events'));
        const controls = el('div', 'calx-settings-controls');
        controls.appendChild(
          colorPicker(manualColor, async (c) => {
            manualColor = c;
            dot.style.setProperty('--dot', c);
            await savePrefs({ [MANUAL_COLOR_KEY]: c });
          })
        );
        card.append(dot, info, controls);
        return card;
      }

      function drawSourceRow(source) {
        const card = el('div', 'calx-settings-card');
        const dot = el('span', 'calx-settings-dot');
        dot.style.setProperty('--dot', source.color);

        const info = el('div', 'calx-settings-info');
        const nameInput = el('input', 'settings-input calx-settings-name-input');
        nameInput.type = 'text';
        nameInput.value = source.name;
        nameInput.addEventListener('change', async () => {
          const next = nameInput.value.trim();
          if (!next) { nameInput.value = source.name; return; }
          source.name = next;
          await saveSources(sources);
        });
        const sub = el('div', 'calx-settings-sub', source.url);
        info.append(nameInput, sub);

        const controls = el('div', 'calx-settings-controls');
        controls.appendChild(
          colorPicker(source.color, async (c) => {
            source.color = c;
            dot.style.setProperty('--dot', c);
            await saveSources(sources);
          })
        );

        const removeBtn = el('button', 'calx-settings-remove');
        removeBtn.type = 'button';
        removeBtn.title = `Remove "${source.name}"`;
        removeBtn.appendChild(Icon('delete', { size: '16px' }));
        removeBtn.addEventListener('click', async () => {
          if (!window.confirm(`Remove "${source.name}"?`)) return;
          const idx = sources.indexOf(source);
          if (idx !== -1) sources.splice(idx, 1);
          await saveSources(sources);
          // Its cached cache-<id>.ics is left behind -- small, harmless,
          // and there's no fs.remove exposed to mods here to clean it up
          // (only read/write/ensureDir are used elsewhere in this codebase).
          card.remove();
        });
        controls.appendChild(removeBtn);

        card.append(dot, info, controls);
        return card;
      }

      list.appendChild(drawManualRow());
      for (const source of sources) list.appendChild(drawSourceRow(source));

      if (!sources.length) {
        list.appendChild(el('p', 'muted', 'Add a calendar from the Calendar tab to give it its own color.'));
      }
      container.appendChild(el('p', 'muted settings-note', 'Color and name changes show up next time the Calendar tab refreshes.'));
    },
  });
})();