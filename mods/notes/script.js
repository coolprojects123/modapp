/**
 * Notes widget: a floating notepad with tabs.
 *
 * - One tab per note. Tab titles come from the note's first line; double-click
 *   (or press F2) to give a tab its own name.
 * - Everything autosaves to notes.json in the mod's own data directory
 *   (ModAPI.native.fs.forMod, no extra permission needed), including which tabs
 *   are open and which one was active. Falls back to localStorage in browser-only mode.
 * - Notes from the first version of this mod (notes.txt) are imported as the first tab.
 * - Closing a tab can be undone for a few seconds.
 */
(function () {
  'use strict';

  const MOD_ID = 'notes';
  const FILE = 'notes.json';
  const LEGACY_FILE = 'notes.txt';
  const LS_KEY = 'modapp:notes';
  const SAVE_DELAY_MS = 600;
  const UNDO_MS = 8000;
  const MAX_TITLE = 40;

  const newId = () =>
    (window.crypto && crypto.randomUUID)
      ? crypto.randomUUID()
      : `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const blankNote = () => ({ id: newId(), title: '', text: '' });

  // ---------------------------------------------------------------- storage

  function createStore() {
    const fs = ModAPI.native?.fs?.forMod?.(MOD_ID);
    if (fs) {
      return {
        async load() {
          try {
            if (await fs.exists(FILE)) return JSON.parse(await fs.readFile(FILE));
            if (await fs.exists(LEGACY_FILE)) return { legacyText: await fs.readFile(LEGACY_FILE) };
          } catch (err) {
            console.error('[notes] load failed:', err);
          }
          return null;
        },
        save: (data) => fs.writeFile(FILE, JSON.stringify(data)),
      };
    }
    return {
      async load() {
        let raw = null;
        try { raw = localStorage.getItem(LS_KEY); } catch { /* storage unavailable */ }
        if (!raw) return null;
        try { return JSON.parse(raw); } catch { return { legacyText: raw }; }
      },
      async save(data) { localStorage.setItem(LS_KEY, JSON.stringify(data)); },
    };
  }

  function normalize(data) {
    let notes = Array.isArray(data?.notes)
      ? data.notes
          .filter((n) => n && typeof n.id === 'string')
          .map((n) => ({
            id: n.id,
            title: typeof n.title === 'string' ? n.title : '',
            text: typeof n.text === 'string' ? n.text : '',
          }))
      : [];
    if (!notes.length) {
      const first = blankNote();
      if (typeof data?.legacyText === 'string') first.text = data.legacyText;
      notes = [first];
    }
    const activeId = notes.some((n) => n.id === data?.activeId) ? data.activeId : notes[0].id;
    return { notes, activeId };
  }

  function displayTitle(note) {
    if (note.title) return note.title;
    const firstLine = note.text.split('\n').find((line) => line.trim());
    return firstLine ? firstLine.trim().slice(0, 24) : 'Untitled';
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function icon(name) {
    return el('span', 'notes-icon', name);
  }

  // ----------------------------------------------------------------- widget

  const store = createStore();
  let flushNow = null; // set while the widget is mounted

  ModAPI.registerWidget({
    id: 'notes',
    label: 'Notes',
    icon: 'sticky_note_2',
    width: '440px',
    height: '400px',

    mount(container) {
      container.classList.add('notes-widget');

      const tabList = el('div', 'notes-tab-list');
      tabList.setAttribute('role', 'tablist');
      tabList.setAttribute('aria-label', 'Notes');

      const addBtn = el('button', 'notes-add');
      addBtn.type = 'button';
      addBtn.title = 'New note';
      addBtn.setAttribute('aria-label', 'New note');
      addBtn.appendChild(icon('add'));

      const tabBar = el('div', 'notes-tabbar');
      tabBar.append(tabList, addBtn);

      const area = el('textarea', 'notes-area');
      area.placeholder = 'Start typing...';
      area.spellcheck = false;
      area.disabled = true;

      const count = el('span', 'notes-count');
      const status = el('span', 'notes-status');
      const footer = el('div', 'notes-footer');
      footer.append(count, status);

      container.replaceChildren(tabBar, area, footer);

      let state = { notes: [], activeId: null };
      let saveTimer = null;
      let dirty = false;
      let undoTimer = null;
      let lastClosed = null;

      const active = () => state.notes.find((n) => n.id === state.activeId);

      // ---- saving

      async function flush() {
        clearTimeout(saveTimer);
        saveTimer = null;
        if (!dirty) return;
        dirty = false;
        try {
          await store.save({ version: 1, activeId: state.activeId, notes: state.notes });
          if (!lastClosed) setStatus('Saved');
        } catch (err) {
          dirty = true;
          console.error('[notes] save failed:', err);
          setStatus('Save failed');
        }
      }

      function scheduleSave() {
        dirty = true;
        if (!lastClosed) setStatus('Editing...');
        clearTimeout(saveTimer);
        saveTimer = setTimeout(flush, SAVE_DELAY_MS);
      }

      function setStatus(text) {
        status.replaceChildren(document.createTextNode(text));
      }

      // ---- rendering

      function updateCount() {
        const n = area.value.length;
        count.textContent = n === 1 ? '1 character' : `${n} characters`;
      }

      function renderTabs() {
        const tabs = state.notes.map((note) => {
          const selected = note.id === state.activeId;
          const tab = el('div', 'notes-tab');
          tab.dataset.id = note.id;
          tab.setAttribute('role', 'tab');
          tab.setAttribute('aria-selected', String(selected));
          tab.tabIndex = selected ? 0 : -1;

          const title = el('span', 'notes-tab-title', displayTitle(note));
          const close = el('button', 'notes-tab-close');
          close.type = 'button';
          close.tabIndex = -1;
          close.title = 'Close note';
          close.setAttribute('aria-label', `Close ${displayTitle(note)}`);
          close.appendChild(icon('close'));

          tab.append(title, close);

          tab.addEventListener('click', (event) => {
            if (event.target.closest('.notes-tab-close')) return;
            select(note.id);
          });
          tab.addEventListener('dblclick', (event) => {
            if (event.target.closest('.notes-tab-close')) return;
            startRename(note.id);
          });
          tab.addEventListener('auxclick', (event) => {
            if (event.button === 1) closeNote(note.id);
          });
          close.addEventListener('click', () => closeNote(note.id));
          tab.addEventListener('keydown', (event) => onTabKey(event, note.id));
          return tab;
        });
        tabList.replaceChildren(...tabs);
        tabList.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }

      function refreshActiveTitle() {
        const tab = tabList.querySelector('[aria-selected="true"] .notes-tab-title');
        const note = active();
        if (tab && note) tab.textContent = displayTitle(note);
      }

      // ---- actions

      function select(id, { focusArea = true } = {}) {
        if (!state.notes.some((n) => n.id === id)) return;
        state.activeId = id;
        area.value = active().text;
        updateCount();
        renderTabs();
        scheduleSave();
        if (focusArea) area.focus();
      }

      function addNote() {
        const note = blankNote();
        state.notes.push(note);
        select(note.id);
      }

      function closeNote(id) {
        const index = state.notes.findIndex((n) => n.id === id);
        if (index === -1) return;
        const [removed] = state.notes.splice(index, 1);
        if (!state.notes.length) state.notes.push(blankNote());

        if (removed.text.trim() || removed.title) {
          lastClosed = { note: removed, index };
          showUndo(removed);
        }

        if (state.activeId === id) {
          const next = state.notes[Math.min(index, state.notes.length - 1)];
          select(next.id);
        } else {
          renderTabs();
          scheduleSave();
        }
      }

      function showUndo(note) {
        clearTimeout(undoTimer);
        const message = document.createTextNode(`Closed "${displayTitle(note)}" `);
        const undo = el('button', 'notes-undo', 'Undo');
        undo.type = 'button';
        undo.addEventListener('click', undoClose);
        status.replaceChildren(message, undo);
        undoTimer = setTimeout(() => {
          lastClosed = null;
          setStatus(dirty ? 'Editing...' : 'Saved');
        }, UNDO_MS);
      }

      function undoClose() {
        if (!lastClosed) return;
        clearTimeout(undoTimer);
        const { note, index } = lastClosed;
        lastClosed = null;
        // Drop the replacement blank note if closing the last tab created one.
        if (state.notes.length === 1 && !state.notes[0].text && !state.notes[0].title) state.notes = [];
        state.notes.splice(Math.min(index, state.notes.length), 0, note);
        select(note.id);
      }

      function startRename(id) {
        const note = state.notes.find((n) => n.id === id);
        const tab = tabList.querySelector(`[data-id="${CSS.escape(id)}"]`);
        const title = tab?.querySelector('.notes-tab-title');
        if (!note || !title) return;

        const input = el('input', 'notes-rename');
        input.type = 'text';
        input.maxLength = MAX_TITLE;
        input.value = note.title || displayTitle(note);
        input.setAttribute('aria-label', 'Note name');
        title.replaceWith(input);
        input.focus();
        input.select();

        let done = false;
        const finish = (commit) => {
          if (done) return;
          done = true;
          if (commit) {
            const value = input.value.trim();
            // Unchanged auto-title stays automatic.
            note.title = value === displayTitle({ ...note, title: '' }) ? '' : value;
            scheduleSave();
          }
          renderTabs();
          area.focus();
        };
        input.addEventListener('keydown', (event) => {
          event.stopPropagation();
          if (event.key === 'Enter') finish(true);
          else if (event.key === 'Escape') finish(false);
        });
        input.addEventListener('blur', () => finish(true));
      }

      function onTabKey(event, id) {
        const index = state.notes.findIndex((n) => n.id === id);
        let target = null;
        if (event.key === 'ArrowRight') target = state.notes[(index + 1) % state.notes.length];
        else if (event.key === 'ArrowLeft') target = state.notes[(index - 1 + state.notes.length) % state.notes.length];
        else if (event.key === 'Home') target = state.notes[0];
        else if (event.key === 'End') target = state.notes[state.notes.length - 1];
        else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(id); return; }
        else if (event.key === 'F2') { event.preventDefault(); startRename(id); return; }
        else if (event.key === 'Delete') { event.preventDefault(); closeNote(id); return; }
        if (target) {
          event.preventDefault();
          select(target.id, { focusArea: false });
          tabList.querySelector('[aria-selected="true"]')?.focus();
        }
      }

      // ---- wiring

      addBtn.addEventListener('click', addNote);

      area.addEventListener('input', () => {
        const note = active();
        if (!note) return;
        note.text = area.value;
        updateCount();
        refreshActiveTitle();
        scheduleSave();
      });

      flushNow = flush;

      store.load().then((data) => {
        state = normalize(data);
        area.value = active().text;
        area.disabled = false;
        updateCount();
        renderTabs();
        // Persist the first-run state (and any imported notes.txt) right away.
        if (!data || data.legacyText !== undefined) { dirty = true; flush(); }
        area.focus();
      });
    },

    async onClose() {
      if (flushNow) await flushNow();
      flushNow = null;
    },
  });
})();