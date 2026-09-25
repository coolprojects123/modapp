/**
 * settings-api.js — a settings tab, nothing else.
 *
 * Any mod can add a section to Core's Settings panel:
 *
 *   ModAPI.registerSettingsSection({
 *     id: 'calendar',
 *     label: 'Calendar',
 *     icon: 'calendar_month',
 *     render(container) { ... build whatever UI you want ... },
 *   });
 *
 * That's the whole API. No field schemas, no built-in persistence, no
 * grouping, no "go to this section" wiring -- your render(container) owns
 * its own UI and its own saving (e.g. via ModAPI.native.fs.forMod(yourModId),
 * the same way calendar's own settings.js does).
 */
(function () {
  'use strict';

  const sections = []; // [{ id, label, icon, render }]

  function registerSettingsSection({ id, label, icon, width, height, render } = {}) {
    if (typeof id !== 'string' || !id) {
      console.warn('[settings] registerSettingsSection needs an id.');
      return;
    }
    if (typeof render !== 'function') {
      console.warn(`[settings] section "${id}" needs a render(container) function.`);
      return;
    }
    // width/height are optional CSS size strings (e.g. '640px'); the panel
    // resizes to them while this section is open, and back to the default
    // Settings size for any section that doesn't set one.
    sections.push({ id, label: label || id, icon: icon || 'tune', width: width || null, height: height || null, render });
    document.dispatchEvent(new CustomEvent('mods:settings-sections-changed'));
  }

  function getSettingsSections() {
    return [...sections];
  }

  async function renderSettingsSection(section, container) {
    container.replaceChildren();
    try {
      await section.render(container);
    } catch (err) {
      console.error(`[settings] section "${section.id}" failed:`, err);
      const p = document.createElement('p');
      p.className = 'error';
      p.textContent = `This section failed to load: ${err.message || err}`;
      container.replaceChildren(p);
    }
  }

  Object.assign(window.ModAPI, {
    registerSettingsSection,
    getSettingsSections,
    renderSettingsSection,
  });
})();