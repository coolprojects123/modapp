/**
 * Calendar tab for modapp.
 *
 * Layout: collapsible left sidebar (create button, mini month, calendar
 * list with show/hide toggles, add/refresh) beside a main area with a nav
 * header, a Month / Week / Day / Agenda switch, and the current view.
 *
 *   Month   adaptive grid: as many chips per cell as fit, then "+N more";
 *           multi-day and all-day events render as bars that span cells
 *   Week    7-column hourly time grid, all-day row, now-line
 *   Day     same time grid with one column
 *   Agenda  next 30 days as a grouped list
 *
 * Events open a detail modal; create/edit uses an in-app form (window
 * prompt() is unreliable in native webviews). Sources, manual events and
 * prefs persist via native fs; each source's last good copy is cached so
 * the tab still works offline. webcal:// URLs are rewritten to https://
 * before fetch; backend.lua does the shell quoting.
 *
 * Shortcuts: T today, M/W/D/A views, ←/→ prev/next, C create.
 */
(function () {
  const MOD_ID = 'calendar';
  const REMINDER_WINDOW_MS = 15 * 60 * 1000;
  const HOUR_PX = 48;
  const DAY_MS = 86400000;
  const CHIP_H = 20;
  const CHIP_GAP = 2;
  const AGENDA_DAYS = 30;
  const MAX_BANNERS = 3;
  const MAX_SPAN_DAYS = 62;

  const MANUAL_CAL = { id: 'manual', name: 'My events', color: '#4caf6a' };
  const PALETTE = ['#5a8cff', '#e5a23c', '#b26be0', '#2fb8b0', '#e97a4b', '#e5484d', '#8a8f98'];
  const VIEWS = [
    { id: 'month', label: 'Month', key: 'm' },
    { id: 'week', label: 'Week', key: 'w' },
    { id: 'day', label: 'Day', key: 'd' },
    { id: 'agenda', label: 'Agenda', key: 'a' },
  ];

  const nativeFs = window.ModAPI.native.fs;
  const fs = nativeFs && nativeFs.forMod ? nativeFs.forMod(MOD_ID) : null;
  let SCHEME = 'dark';

  // ---------------------------------------------------------------- storage

  function assertFs() {
    if (!fs) throw new Error('Calendar needs the desktop build (native fs).');
    return fs;
  }

  async function readJson(name, fallback) {
    try {
      return JSON.parse(await assertFs().readFile(name));
    } catch {
      return fallback;
    }
  }

  const writeJson = (name, data) => assertFs().writeFile(name, JSON.stringify(data, null, 2));

  async function loadSources() {
    const list = await readJson('sources.json', []);
    let changed = false;
    list.forEach((s, i) => {
      if (!s.color) {
        s.color = PALETTE[i % PALETTE.length];
        changed = true;
      }
    });
    if (changed) {
      try { await writeJson('sources.json', list); } catch { /* read-only is fine */ }
    }
    return list;
  }
  const saveSources = (s) => writeJson('sources.json', s);
  const loadManual = () => readJson('manual-events.json', []);
  const saveManual = (e) => writeJson('manual-events.json', e);
  const loadPrefs = () => readJson('prefs.json', {});
  const savePrefs = (p) => writeJson('prefs.json', p).catch(() => {});

  // ----------------------------------------------------------- date helpers

  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const todayDate = () => startOfDay(new Date());
  const parseYmd = (s) => {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
  };
  const sameDay = (a, b) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const isMidnight = (d) => d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0;

  function addMonths(date, n) {
    const d = new Date(date.getFullYear(), date.getMonth() + n, 1);
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(date.getDate(), last));
    return d;
  }

  const weekDays = (ref) => Array.from({ length: 7 }, (_, i) => addDays(ref, i - ref.getDay()));

  function monthDays(year, month, fixedRows) {
    const lead = new Date(year, month, 1).getDay();
    const total = new Date(year, month + 1, 0).getDate();
    const rows = fixedRows || Math.ceil((lead + total) / 7);
    return Array.from({ length: rows * 7 }, (_, i) => new Date(year, month, 1 - lead + i));
  }

  const HOUR12 = new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hour12;
  const shortTime = (d) => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const compactTime = (d) =>
    HOUR12 && d.getMinutes() === 0 ? d.toLocaleTimeString(undefined, { hour: 'numeric' }) : shortTime(d);
  const fullDate = (d) =>
    d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const medDate = (d) => d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

  function rangeLabel(a, b) {
    const f = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    return typeof f.formatRange === 'function' ? f.formatRange(a, b) : `${f.format(a)} – ${f.format(b)}`;
  }

  function durationLabel(mins) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
  }

  // ------------------------------------------------------------ event model

  /**
   * Adds derived fields to a raw event: allDay, first/last (inclusive local
   * days it touches), multi, banner (renders in the all-day lane), plus the
   * owning calendar's id/name/color.
   */
  function decorate(e, cal) {
    const start = e.start;
    const end = e.end instanceof Date && !isNaN(e.end) && e.end > start ? e.end : null;
    const allDay = e.allDay !== undefined ? !!e.allDay : isMidnight(start);
    const first = startOfDay(start);
    let last = first;
    if (end) {
      last = allDay
        ? addDays(first, Math.max(0, Math.round((end - start) / DAY_MS) - 1)) // DTEND is exclusive
        : startOfDay(new Date(end.getTime() - 1));
    }
    const multi = last > first;
    return {
      ...e, end, allDay, first, last, multi,
      banner: allDay || multi,
      calId: cal.id, calName: cal.name, color: cal.color,
    };
  }

  const validStart = (e) => e && e.start instanceof Date && !isNaN(e.start);

  const manualToRuntime = (m) =>
    decorate({
      uid: m.id,
      title: m.title,
      description: m.description || null,
      start: new Date(m.startIso),
      end: m.endIso ? new Date(m.endIso) : null,
      allDay: m.allDay,
      manual: true,
    }, MANUAL_CAL);

  function parseSourceText(source, text) {
    const cal = { id: source.id, name: source.name, color: source.color };
    return window.CalendarICS.parse(text).filter(validStart).map((e) => decorate(e, cal));
  }

  const normalizeUrl = (url) => url.replace(/^webcal:\/\//i, 'https://');

  function validateUrl(url) {
    if (!/^https?:\/\//i.test(url)) throw new Error('Calendar URL must be http(s) or webcal.');
  }

  async function fetchSourceText(source) {
    const url = normalizeUrl(source.url);
    validateUrl(url);
    const text = await window.ModAPI.native.callBackend(MOD_ID, 'fetch_calendar', [url]);
    await assertFs().writeFile(`cache-${source.id}.ics`, text);
    return text;
  }

  async function readCache(source) {
    try {
      return await assertFs().readFile(`cache-${source.id}.ics`);
    } catch {
      return null;
    }
  }

  async function checkReminders(events) {
    const now = Date.now();
    const due = events.filter((e) => {
      if (e.allDay) return false;
      const delta = e.start.getTime() - now;
      return delta >= 0 && delta <= REMINDER_WINDOW_MS;
    });
    if (!due.length) return;
    const payload = JSON.stringify(due.map((e) => ({ title: e.title, when: e.start.toLocaleTimeString() })));
    try {
      // backend.lua's decode_events() still errors on this; wired up so
      // reminders work the moment that lands.
      await window.ModAPI.native.callBackend(MOD_ID, 'check_reminders', [payload]);
    } catch (err) {
      console.warn('[calendar] reminder failed:', err);
    }
  }

  /** Map of yyyy-mm-dd -> events touching that day (banners first, then by start). */
  function buildDayMap(events) {
    const map = new Map();
    for (const e of events) {
      let d = e.first;
      let guard = 0;
      while (d <= e.last && guard++ < MAX_SPAN_DAYS) {
        const k = ymd(d);
        if (!map.has(k)) map.set(k, []);
        map.get(k).push(e);
        d = addDays(d, 1);
      }
    }
    for (const list of map.values()) list.sort((a, b) => (b.banner - a.banner) || (a.start - b.start));
    return map;
  }

  const eventsOn = (dayMap, day) => dayMap.get(ymd(day)) || [];
  const isPast = (e) => (e.banner ? e.last < todayDate() : (e.end || e.start) < new Date());
  const timeLabel = (e) => (e.allDay ? 'All day' : compactTime(e.start));

  // ------------------------------------------------------------ dom helpers

  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  };

  function activatable(node, fn) {
    node.tabIndex = 0;
    node.setAttribute('role', 'button');
    node.addEventListener('click', fn);
    node.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        fn(ev);
      }
    });
  }

  function detectScheme(node) {
    const m = (getComputedStyle(node).color || '').match(/\d+(\.\d+)?/g);
    if (!m || m.length < 3) return 'dark';
    const [r, g, b] = m.map(Number);
    return 0.299 * r + 0.587 * g + 0.114 * b > 140 ? 'dark' : 'light'; // light text => dark theme
  }

  // ----------------------------------------------------------------- modals

  function openModal(overlay) {
    overlay.style.colorScheme = SCHEME;
    const close = () => {
      document.removeEventListener('keydown', onKey);
      overlay.remove();
    };
    const onKey = (ev) => {
      if (ev.key === 'Escape') close();
    };
    overlay.addEventListener('mousedown', (ev) => {
      if (ev.target === overlay) close();
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(overlay);
    const focusTarget = overlay.querySelector('[data-autofocus]') || overlay.querySelector('input, textarea, button');
    if (focusTarget) focusTarget.focus();
    return close;
  }

  function modalShell(title) {
    const overlay = el('div', 'calx-modal-overlay');
    const modal = el('div', 'calx-modal');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');

    const head = el('div', 'calx-modal-head');
    head.appendChild(typeof title === 'string' ? el('div', 'calx-modal-title', title) : title);
    const x = el('button', 'calx-icon-btn', '✕');
    x.setAttribute('aria-label', 'Close');
    head.appendChild(x);

    const body = el('div', 'calx-modal-body');
    modal.append(head, body);
    overlay.appendChild(modal);

    let closeFn = () => {};
    x.addEventListener('click', () => closeFn());
    return {
      body,
      show() { closeFn = openModal(overlay); return closeFn; },
      close: () => closeFn(),
    };
  }

  function dot(color) {
    const d = el('span', 'calx-dot');
    d.style.setProperty('--c', color);
    return d;
  }

  function showEventModal(event, { onEdit, onDelete }) {
    const title = el('div', 'calx-modal-title');
    title.append(dot(event.color), document.createTextNode(event.title || '(untitled)'));
    const shell = modalShell(title);
    const { body } = shell;

    const when = el('div', 'calx-modal-when');
    if (event.multi && !event.allDay) {
      when.appendChild(el('div', 'calx-modal-date',
        `${medDate(event.start)}, ${shortTime(event.start)} – ${medDate(event.end)}, ${shortTime(event.end)}`));
    } else if (event.multi) {
      when.appendChild(el('div', 'calx-modal-date', `${medDate(event.first)} – ${medDate(event.last)}`));
      when.appendChild(el('div', 'calx-modal-time', 'All day'));
    } else {
      when.appendChild(el('div', 'calx-modal-date', fullDate(event.start)));
      let t = 'All day';
      if (!event.allDay) {
        t = shortTime(event.start);
        if (event.end) {
          t += ` – ${shortTime(event.end)} · ${durationLabel(Math.round((event.end - event.start) / 60000))}`;
        }
      }
      when.appendChild(el('div', 'calx-modal-time', t));
    }
    body.appendChild(when);

    const calRow = el('div', 'calx-modal-cal');
    calRow.append(dot(event.color), document.createTextNode(event.calName));
    body.appendChild(calRow);

    if (event.description) body.appendChild(el('div', 'calx-modal-desc', event.description));

    if (event.manual) {
      const actions = el('div', 'calx-modal-actions');
      const edit = el('button', null, 'Edit');
      const del = el('button', 'calx-btn--danger', 'Delete');
      actions.append(edit, del);
      body.appendChild(actions);
      edit.addEventListener('click', () => { shell.close(); onEdit(); });
      let armed = false;
      del.addEventListener('click', () => {
        if (!armed) {
          armed = true;
          del.textContent = 'Click again to delete';
          return;
        }
        shell.close();
        onDelete();
      });
    } else {
      body.appendChild(el('div', 'calx-modal-note', 'Synced event — edit it in its source calendar.'));
    }
    shell.show();
  }

  function showDayModal(day, events, onPick) {
    const shell = modalShell(fullDate(day).replace(/,? \d{4}$/, ''));
    const list = el('ul', 'calx-modal-list');
    for (const e of events) {
      const row = el('li', 'calx-modal-event');
      row.append(dot(e.color), el('span', 'calx-modal-event-time', timeLabel(e)),
        el('span', 'calx-modal-event-title', e.title || '(untitled)'));
      activatable(row, () => { shell.close(); onPick(e); });
      list.appendChild(row);
    }
    shell.body.appendChild(list);
    shell.show();
  }

  function field(label, input) {
    const wrap = el('label', 'calx-field');
    wrap.append(el('span', 'calx-field-label', label), input);
    return wrap;
  }

  function input(type, value, cls) {
    const i = el('input', `calx-input ${cls || ''}`.trim());
    i.type = type;
    if (value != null) i.value = value;
    return i;
  }

  function defaultStart(day, minute) {
    const base = day || new Date();
    if (minute != null) return new Date(base.getFullYear(), base.getMonth(), base.getDate(), 0, minute);
    const now = new Date();
    if (sameDay(base, now)) {
      return new Date(base.getFullYear(), base.getMonth(), base.getDate(), Math.min(23, now.getHours() + 1));
    }
    return new Date(base.getFullYear(), base.getMonth(), base.getDate(), 9);
  }

  /** Create/edit form. onSave({title, description, start, end, allDay}) may throw to show an error. */
  function showEventForm({ existing, day, minute, allDay }, onSave) {
    const shell = modalShell(existing ? 'Edit event' : 'New event');
    const s0 = existing && !existing.allDay ? existing.start : defaultStart(existing ? existing.first : day, minute);
    const e0 = existing && !existing.allDay && existing.end ? existing.end : new Date(s0.getTime() + 3600000);
    const allDayInit = existing ? existing.allDay : !!allDay;

    const titleIn = input('text', existing ? existing.title || '' : '');
    titleIn.placeholder = 'Add title';
    titleIn.setAttribute('data-autofocus', '');

    const allDayBox = el('input');
    allDayBox.type = 'checkbox';
    allDayBox.checked = allDayInit;
    const allDayRow = el('label', 'calx-check');
    allDayRow.append(allDayBox, document.createTextNode('All day'));

    const sd = input('date', ymd(existing ? existing.first : s0));
    const st = input('time', hm(s0), 'calx-time');
    const ed = input('date', ymd(existing ? existing.last : e0));
    const et = input('time', hm(e0), 'calx-time');
    const startRow = el('div', 'calx-row');
    startRow.append(sd, st);
    const endRow = el('div', 'calx-row');
    endRow.append(ed, et);

    const desc = el('textarea', 'calx-input calx-textarea');
    desc.rows = 4;
    desc.placeholder = 'Add description';
    desc.value = existing && existing.description ? existing.description : '';

    const error = el('div', 'calx-form-error');
    const cancel = el('button', null, 'Cancel');
    const save = el('button', 'calx-btn--primary', 'Save');
    const actions = el('div', 'calx-modal-actions calx-modal-actions--end');
    actions.append(cancel, save);

    const form = el('div', 'calx-form');
    form.append(field('Title', titleIn), allDayRow, field('Starts', startRow), field('Ends', endRow),
      field('Description', desc), error, actions);
    shell.body.appendChild(form);

    const syncAllDay = () => form.classList.toggle('calx-form--allday', allDayBox.checked);
    allDayBox.addEventListener('change', syncAllDay);
    syncAllDay();
    sd.addEventListener('change', () => {
      if (sd.value && (!ed.value || ed.value < sd.value)) ed.value = sd.value;
    });

    const fail = (msg) => { error.textContent = msg; return null; };

    async function submit() {
      const title = titleIn.value.trim();
      if (!title) return fail('Give the event a title.');
      if (!sd.value || !ed.value) return fail('Choose a start and end date.');
      let start, end;
      if (allDayBox.checked) {
        start = parseYmd(sd.value);
        const lastDay = parseYmd(ed.value);
        if (lastDay < start) return fail('The end date is before the start date.');
        end = addDays(lastDay, 1); // exclusive, like ICS
      } else {
        if (!st.value || !et.value) return fail('Choose a start and end time, or mark the event all day.');
        start = new Date(`${sd.value}T${st.value}:00`);
        end = new Date(`${ed.value}T${et.value}:00`);
        if (isNaN(start) || isNaN(end)) return fail('That date or time is not valid.');
        if (end < start) return fail('The event ends before it starts.');
        if (end.getTime() === start.getTime()) end = null;
      }
      save.disabled = true;
      try {
        await onSave({ title, description: desc.value.trim() || null, start, end, allDay: allDayBox.checked });
        shell.close();
      } catch (err) {
        save.disabled = false;
        fail(err.message || String(err));
      }
    }

    save.addEventListener('click', submit);
    cancel.addEventListener('click', () => shell.close());
    form.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && ev.target.tagName === 'INPUT' && ev.target.type !== 'checkbox') {
        ev.preventDefault();
        submit();
      }
    });
    shell.show();
  }

  function showAddCalendarForm(usedColors, onSave) {
    const shell = modalShell('Add calendar');
    const nameIn = input('text', 'My calendar');
    const urlIn = input('text', '');
    urlIn.placeholder = 'https://… or webcal://…';
    urlIn.setAttribute('data-autofocus', '');

    let color = PALETTE.find((c) => !usedColors.includes(c)) || PALETTE[0];
    const swatches = el('div', 'calx-swatches');
    const swatchBtns = PALETTE.map((c) => {
      const b = el('button', 'calx-swatch');
      b.type = 'button';
      b.style.setProperty('--c', c);
      b.setAttribute('aria-label', `Color ${c}`);
      b.addEventListener('click', () => { color = c; paint(); });
      swatches.appendChild(b);
      return b;
    });
    const paint = () => swatchBtns.forEach((b, i) => b.classList.toggle('calx-swatch--on', PALETTE[i] === color));
    paint();

    const error = el('div', 'calx-form-error');
    const cancel = el('button', null, 'Cancel');
    const save = el('button', 'calx-btn--primary', 'Add calendar');
    const actions = el('div', 'calx-modal-actions calx-modal-actions--end');
    actions.append(cancel, save);

    const form = el('div', 'calx-form');
    form.append(field('Name', nameIn), field('Calendar URL (.ics or webcal)', urlIn),
      field('Color', swatches), error, actions);
    shell.body.appendChild(form);

    async function submit() {
      const url = urlIn.value.trim();
      const name = nameIn.value.trim() || url;
      try {
        if (!url) throw new Error('Paste a calendar URL.');
        validateUrl(normalizeUrl(url));
      } catch (err) {
        error.textContent = err.message;
        return;
      }
      save.disabled = true;
      try {
        await onSave({ id: `src-${Date.now()}`, name, url, color });
        shell.close();
      } catch (err) {
        save.disabled = false;
        error.textContent = err.message || String(err);
      }
    }
    save.addEventListener('click', submit);
    cancel.addEventListener('click', () => shell.close());
    form.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && ev.target.tagName === 'INPUT') {
        ev.preventDefault();
        submit();
      }
    });
    shell.show();
  }

  function showConfirm({ title, message, confirmLabel }, onConfirm) {
    const shell = modalShell(title);
    shell.body.appendChild(el('div', 'calx-modal-desc calx-modal-desc--plain', message));
    const cancel = el('button', null, 'Cancel');
    const ok = el('button', 'calx-btn--danger', confirmLabel);
    const actions = el('div', 'calx-modal-actions calx-modal-actions--end');
    actions.append(cancel, ok);
    shell.body.appendChild(actions);
    cancel.addEventListener('click', () => shell.close());
    ok.addEventListener('click', () => { shell.close(); onConfirm(); });
    shell.show();
  }

  // ------------------------------------------------------------ month view

  function makeChip(e, day, { showTitle, onEvent }) {
    const chip = el('div', 'calx-chip');
    chip.style.setProperty('--c', e.color);
    if (isPast(e)) chip.classList.add('calx-past');
    if (e.banner) {
      chip.classList.add('calx-chip--bar');
      if (day > e.first) chip.classList.add('calx-chip--cont-l');
      if (day < e.last) chip.classList.add('calx-chip--cont-r');
      chip.appendChild(el('span', 'calx-chip-title', showTitle ? e.title || '(untitled)' : '\u00a0'));
    } else {
      chip.classList.add('calx-chip--timed');
      chip.append(el('span', 'calx-chip-time', compactTime(e.start)),
        el('span', 'calx-chip-title', e.title || '(untitled)'));
    }
    chip.title = `${timeLabel(e)} · ${e.title || '(untitled)'}`;
    activatable(chip, (ev) => { ev.stopPropagation(); onEvent(e); });
    return chip;
  }

  function measureCap(container) {
    const box = container.querySelector('.calx-cell-events');
    if (!box || !box.clientHeight) return null;
    return Math.max(1, Math.floor((box.clientHeight + CHIP_GAP) / (CHIP_H + CHIP_GAP)));
  }

  /** Renders the month grid; returns the per-cell chip capacity it settled on. */
  function renderMonth({ container, refDate, dayMap, today, cap: capHint, onDay, onCreate, onEvent, onMore }) {
    const build = (cap) => {
      const wrap = el('div', 'calx-month');
      const wds = el('div', 'calx-month-wd');
      for (const d of weekDays(today)) {
        wds.appendChild(el('div', 'calx-month-wd-cell', d.toLocaleDateString(undefined, { weekday: 'short' })));
      }
      const grid = el('div', 'calx-month-grid');
      const month = refDate.getMonth();
      const days = monthDays(refDate.getFullYear(), month);
      grid.style.gridTemplateRows = `repeat(${days.length / 7}, minmax(0, 1fr))`;

      for (const day of days) {
        const cell = el('div', 'calx-cell');
        if (day.getMonth() !== month) cell.classList.add('calx-cell--outside');
        if (sameDay(day, today)) cell.classList.add('calx-cell--today');

        const num = el('span', 'calx-daynum',
          day.getDate() === 1
            ? day.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
            : String(day.getDate()));
        activatable(num, (ev) => { ev.stopPropagation(); onDay(day); });
        num.setAttribute('aria-label', fullDate(day));
        cell.appendChild(num);

        const box = el('div', 'calx-cell-events');
        const list = eventsOn(dayMap, day);
        const shown = list.length > cap ? Math.max(0, cap - 1) : list.length;
        for (const e of list.slice(0, shown)) {
          box.appendChild(makeChip(e, day, { showTitle: day.getDay() === 0 || sameDay(day, e.first), onEvent }));
        }
        if (list.length > shown) {
          const more = el('div', 'calx-more', shown ? `+${list.length - shown} more` : `${list.length} events`);
          activatable(more, (ev) => { ev.stopPropagation(); onMore(day, list); });
          box.appendChild(more);
        }
        cell.appendChild(box);
        cell.addEventListener('click', () => onCreate(day));
        grid.appendChild(cell);
      }
      wrap.append(wds, grid);
      container.replaceChildren(wrap);
    };

    let cap = capHint || 3;
    build(cap);
    const measured = measureCap(container);
    if (measured && measured !== cap) {
      cap = measured;
      build(cap);
    }
    return cap;
  }

  // -------------------------------------------------------- sidebar mini cal

  function renderMini({ container, anchor, refDate, range, dayMap, today, onPick, onBrowse }) {
    const year = anchor.getFullYear();
    const month = anchor.getMonth();

    const head = el('div', 'calx-mini-head');
    head.appendChild(el('span', 'calx-mini-month',
      anchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })));
    const nav = el('div', 'calx-mini-navs');
    const up = el('button', 'calx-icon-btn calx-icon-btn--sm', '‹');
    const down = el('button', 'calx-icon-btn calx-icon-btn--sm', '›');
    up.setAttribute('aria-label', 'Previous month');
    down.setAttribute('aria-label', 'Next month');
    up.addEventListener('click', () => onBrowse(-1));
    down.addEventListener('click', () => onBrowse(1));
    nav.append(up, down);
    head.appendChild(nav);

    const grid = el('div', 'calx-mini-grid');
    for (const d of weekDays(today)) {
      grid.appendChild(el('div', 'calx-mini-wd', d.toLocaleDateString(undefined, { weekday: 'narrow' })));
    }
    for (const day of monthDays(year, month, 6)) {
      const cell = el('div', 'calx-mini-day', String(day.getDate()));
      if (day.getMonth() !== month) cell.classList.add('calx-mini-day--outside');
      if (sameDay(day, today)) cell.classList.add('calx-mini-day--today');
      if (dayMap.has(ymd(day))) cell.classList.add('calx-mini-day--has-events');
      if (range.some((r) => sameDay(r, day))) cell.classList.add('calx-mini-day--range');
      if (sameDay(day, refDate)) cell.classList.add('calx-mini-day--selected');
      activatable(cell, () => onPick(day));
      cell.setAttribute('aria-label', fullDate(day));
      grid.appendChild(cell);
    }
    container.replaceChildren(head, grid);
  }

  // ------------------------------------------------------- week / day grid

  function layoutOverlaps(items) {
    const sorted = [...items].sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);
    const groups = [];
    let end = -Infinity;
    for (const it of sorted) {
      if (it.startMin >= end) groups.push([]);
      end = Math.max(end, it.endMin);
      groups[groups.length - 1].push(it);
    }
    for (const members of groups) {
      const colEnds = [];
      for (const it of members) {
        let col = colEnds.findIndex((t) => t <= it.startMin);
        if (col === -1) {
          col = colEnds.length;
          colEnds.push(it.endMin);
        } else {
          colEnds[col] = it.endMin;
        }
        it.col = col;
      }
      for (const it of members) it.cols = colEnds.length;
    }
    return sorted;
  }

  const hourLabel = (h) => new Date(2000, 0, 1, h).toLocaleTimeString(undefined, { hour: 'numeric' });
  const nowMinutes = () => {
    const n = new Date();
    return n.getHours() * 60 + n.getMinutes();
  };

  function renderTimeGrid({ container, days, dayMap, today, onDay, onCreateAt, onCreateAllDay, onEvent, onMore }) {
    const prevScroll = container.querySelector('.calx-tg-scroll');
    const keepScroll = prevScroll ? prevScroll.scrollTop : null;

    const cols = days.length;
    const tg = el('div', 'calx-tg');
    tg.style.setProperty('--calx-hour', `${HOUR_PX}px`);
    tg.style.setProperty('--cols', String(cols));

    // day headers
    const head = el('div', 'calx-tg-head');
    head.appendChild(el('div', 'calx-tg-corner'));
    for (const day of days) {
      const h = el('div', 'calx-tg-dayhead');
      if (sameDay(day, today)) h.classList.add('calx-tg-dayhead--today');
      h.append(el('div', 'calx-tg-dow', day.toLocaleDateString(undefined, { weekday: 'short' })),
        el('div', 'calx-tg-dom', String(day.getDate())));
      if (cols > 1) {
        activatable(h, () => onDay(day));
        h.setAttribute('aria-label', fullDate(day));
      }
      head.appendChild(h);
    }
    tg.appendChild(head);

    // all-day / multi-day lane
    let banners = null;
    if (days.some((d) => eventsOn(dayMap, d).some((e) => e.banner))) {
      banners = el('div', 'calx-tg-banners');
      banners.appendChild(el('div', 'calx-tg-corner calx-tg-corner--label', 'All day'));
      for (const day of days) {
        const cell = el('div', 'calx-tg-bcell');
        cell.addEventListener('click', () => onCreateAllDay(day));
        const list = eventsOn(dayMap, day).filter((e) => e.banner);
        const shown = list.length > MAX_BANNERS ? MAX_BANNERS - 1 : list.length;
        for (const e of list.slice(0, shown)) {
          cell.appendChild(makeChip(e, day, { showTitle: cols === 1 || day.getDay() === 0 || sameDay(day, e.first), onEvent }));
        }
        if (list.length > shown) {
          const more = el('div', 'calx-more', `+${list.length - shown} more`);
          activatable(more, (ev) => { ev.stopPropagation(); onMore(day, list); });
          cell.appendChild(more);
        }
        banners.appendChild(cell);
      }
      tg.appendChild(banners);
    }

    // scrolling hour grid
    const scroll = el('div', 'calx-tg-scroll');
    const body = el('div', 'calx-tg-body');
    body.style.height = `${24 * HOUR_PX}px`;

    const gutter = el('div', 'calx-tg-gutter');
    for (let h = 1; h < 24; h++) {
      const tick = el('div', 'calx-tg-tick', hourLabel(h));
      tick.style.top = `${h * HOUR_PX}px`;
      gutter.appendChild(tick);
    }
    body.appendChild(gutter);

    for (const day of days) {
      const col = el('div', 'calx-tg-col');
      const isToday = sameDay(day, today);
      if (isToday) col.classList.add('calx-tg-col--today');

      const dayStart = day.getTime();
      const mins = (d) => (d.getTime() - dayStart) / 60000;
      const timed = eventsOn(dayMap, day)
        .filter((e) => !e.banner)
        .map((e) => {
          const startMin = Math.max(0, Math.min(1439, mins(e.start)));
          let endMin = e.end ? mins(e.end) : startMin + 60;
          if (endMin <= startMin) endMin = startMin + 30;
          return { event: e, startMin, endMin: Math.min(1440, endMin) };
        });

      for (const it of layoutOverlaps(timed)) {
        const e = it.event;
        const dur = it.endMin - it.startMin;
        const block = el('div', 'calx-block');
        block.style.setProperty('--c', e.color);
        if (isPast(e)) block.classList.add('calx-past');
        if (dur <= 40) block.classList.add('calx-block--short');
        block.style.top = `${(it.startMin / 60) * HOUR_PX}px`;
        block.style.height = `${Math.max(20, (dur / 60) * HOUR_PX - 1)}px`;
        block.style.left = `calc(${(it.col / it.cols) * 100}% + 2px)`;
        block.style.width = `calc(${100 / it.cols}% - 5px)`;
        block.append(el('div', 'calx-block-title', e.title || '(untitled)'),
          el('div', 'calx-block-time', compactTime(e.start)));
        block.title = `${shortTime(e.start)}${e.end ? ` – ${shortTime(e.end)}` : ''} · ${e.title || '(untitled)'}`;
        activatable(block, (ev) => { ev.stopPropagation(); onEvent(e); });
        col.appendChild(block);
      }

      if (isToday) {
        const line = el('div', 'calx-now');
        line.style.top = `${(nowMinutes() / 60) * HOUR_PX}px`;
        line.appendChild(el('div', 'calx-now-dot'));
        col.appendChild(line);
      }

      col.addEventListener('click', (ev) => {
        if (ev.target.closest('.calx-block')) return;
        const y = ev.clientY - col.getBoundingClientRect().top;
        onCreateAt(day, Math.max(0, Math.min(1425, Math.floor((y / HOUR_PX) * 4) * 15)));
      });
      body.appendChild(col);
    }

    scroll.appendChild(body);
    tg.appendChild(scroll);
    container.replaceChildren(tg);

    // line the headers up with the scroll area's scrollbar
    const sbw = scroll.offsetWidth - scroll.clientWidth;
    head.style.paddingRight = `${sbw}px`;
    if (banners) banners.style.paddingRight = `${sbw}px`;

    if (keepScroll != null) {
      scroll.scrollTop = keepScroll;
    } else {
      const focusMin = days.some((d) => sameDay(d, today)) ? Math.max(0, nowMinutes() - 60) : 7 * 60;
      scroll.scrollTop = (focusMin / 60) * HOUR_PX;
    }
  }

  // ----------------------------------------------------------------- agenda

  function renderAgenda({ container, refDate, dayMap, today, onEvent, onCreate }) {
    const wrap = el('div', 'calx-agenda');
    let any = false;
    for (let i = 0; i < AGENDA_DAYS; i++) {
      const day = addDays(refDate, i);
      const list = eventsOn(dayMap, day);
      if (!list.length) continue;
      any = true;

      const row = el('div', 'calx-ag-day');
      if (sameDay(day, today)) row.classList.add('calx-ag-day--today');
      const date = el('div', 'calx-ag-date');
      date.append(el('div', 'calx-ag-dom', String(day.getDate())),
        el('div', 'calx-ag-dow', day.toLocaleDateString(undefined, { weekday: 'short', month: 'short' })));
      const items = el('div', 'calx-ag-items');
      for (const e of list) {
        const item = el('div', 'calx-ag-item');
        item.style.setProperty('--c', e.color);
        if (isPast(e)) item.classList.add('calx-past');
        let when;
        if (e.multi && e.banner) {
          const n = Math.round((e.last - e.first) / DAY_MS) + 1;
          when = `Day ${Math.round((day - e.first) / DAY_MS) + 1} of ${n}`;
        } else if (e.allDay) {
          when = 'All day';
        } else {
          when = `${compactTime(e.start)}${e.end ? ` – ${compactTime(e.end)}` : ''}`;
        }
        item.append(dot(e.color), el('span', 'calx-ag-time', when),
          el('span', 'calx-ag-title', e.title || '(untitled)'), el('span', 'calx-ag-cal', e.calName));
        activatable(item, () => onEvent(e));
        items.appendChild(item);
      }
      row.append(date, items);
      wrap.appendChild(row);
    }
    if (!any) {
      const empty = el('div', 'calx-empty');
      empty.appendChild(el('div', null, `Nothing scheduled in these ${AGENDA_DAYS} days.`));
      const btn = el('button', null, 'Create event');
      btn.addEventListener('click', () => onCreate(refDate));
      empty.appendChild(btn);
      wrap.appendChild(empty);
    }
    container.replaceChildren(wrap);
  }

  // -------------------------------------------------------------------- tab

  window.ModAPI.registerTab({
    id: 'calendar',
    label: 'Calendar',
    icon: 'calendar_month',
    fullBleed: true, // the calendar asks for the whole content area itself
    async render(container) {
      container.classList.add('calx-tab');
      SCHEME = detectScheme(container);
      container.style.colorScheme = SCHEME;

      const prefs = await loadPrefs();
      // Settings > Tabs > Calendar (js/settings.js) writes this key when the
      // user recolors "My events" there. MANUAL_CAL is a shared module-level
      // object, so mutating .color here (not reassigning the const binding)
      // is what makes every decorate() call downstream pick up the new color.
      MANUAL_CAL.color = prefs.manualColor || MANUAL_CAL.color;
      let view = VIEWS.some((v) => v.id === prefs.view) ? prefs.view : 'month';
      const hidden = new Set(prefs.hidden || []);
      const persist = () => savePrefs({ view, hidden: [...hidden], collapsed: container.classList.contains('calx-tab--collapsed') });

      let refDate = todayDate();
      let miniAnchor = refDate;
      let sources = [];
      let synced = [];
      let manualEvents = [];
      let allEvents = [];
      let dayMap = new Map();
      let monthCap = 0;
      let lastSynced = null;

      const narrow = container.clientWidth > 0 && container.clientWidth < 760; // 0 = not laid out yet
      if (prefs.collapsed ?? narrow) container.classList.add('calx-tab--collapsed');

      // ===== sidebar =====
      const sidebar = el('aside', 'calx-sidebar');
      const createBtn = el('button', 'calx-create-btn', '+  Create event');
      createBtn.title = 'Create event (C)';
      const miniCal = el('div', 'calx-mini');

      const calSection = el('div', 'calx-cals');
      calSection.appendChild(el('div', 'calx-side-heading', 'Calendars'));
      const calList = el('div', 'calx-cal-list');
      calSection.appendChild(calList);

      const sideFoot = el('div', 'calx-side-foot');
      const addCalBtn = el('button', 'calx-side-action', '+ Add calendar');
      const refreshBtn = el('button', 'calx-side-action', 'Refresh');
      const syncedLabel = el('div', 'calx-synced');
      sideFoot.append(addCalBtn, refreshBtn, syncedLabel);
      sidebar.append(createBtn, miniCal, calSection, sideFoot);

      // ===== main =====
      const main = el('div', 'calx-main');
      const header = el('div', 'calx-header');
      const menuBtn = el('button', 'calx-icon-btn', '☰');
      menuBtn.setAttribute('aria-label', 'Toggle sidebar');
      const todayBtn = el('button', null, 'Today');
      todayBtn.title = 'Go to today (T)';
      const prevBtn = el('button', 'calx-icon-btn', '‹');
      const nextBtn = el('button', 'calx-icon-btn', '›');
      prevBtn.setAttribute('aria-label', 'Previous');
      nextBtn.setAttribute('aria-label', 'Next');
      const viewLabel = el('h2', 'calx-view-label');
      const seg = el('div', 'calx-seg');
      const segBtns = {};
      for (const v of VIEWS) {
        const b = el('button', 'calx-seg-btn', v.label);
        b.title = `${v.label} (${v.key.toUpperCase()})`;
        b.addEventListener('click', () => setView(v.id));
        segBtns[v.id] = b;
        seg.appendChild(b);
      }
      header.append(menuBtn, todayBtn, prevBtn, nextBtn, viewLabel, seg);

      const status = el('div', 'calx-status');
      const stage = el('div', 'calx-stage');
      main.append(header, status, stage);
      // Own row-flex wrapper: the host's tab container may be block or a column flexbox,
      // which is what stacked the sidebar above the calendar.
      const root = el('div', 'calx-root');
      root.append(sidebar, main);
      container.appendChild(root);

      // ===== state helpers =====
      const setStatus = (text) => { status.textContent = text || ''; };

      function rebuild() {
        allEvents = [...synced, ...manualEvents];
        renderCurrentView();
      }

      function goTo(date) {
        refDate = startOfDay(date);
        miniAnchor = refDate;
        renderCurrentView();
      }

      function shift(dir) {
        if (view === 'month') refDate = addMonths(refDate, dir);
        else if (view === 'week') refDate = addDays(refDate, 7 * dir);
        else if (view === 'day') refDate = addDays(refDate, dir);
        else refDate = addDays(refDate, AGENDA_DAYS * dir);
        goTo(refDate);
      }

      function setView(next) {
        view = next;
        persist();
        renderCurrentView();
      }

      function viewRange() {
        if (view === 'week') return weekDays(refDate);
        if (view === 'month') return [];
        return [refDate];
      }

      function updateHeader() {
        for (const v of VIEWS) segBtns[v.id].classList.toggle('calx-seg-btn--active', v.id === view);
        if (view === 'month') {
          viewLabel.textContent = refDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
        } else if (view === 'week') {
          const wk = weekDays(refDate);
          viewLabel.textContent = rangeLabel(wk[0], wk[6]);
        } else if (view === 'day') {
          viewLabel.textContent = refDate.toLocaleDateString(undefined,
            { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
        } else {
          viewLabel.textContent = rangeLabel(refDate, addDays(refDate, AGENDA_DAYS - 1));
        }
      }

      function renderCalList() {
        calList.replaceChildren();
        const rows = [MANUAL_CAL, ...sources.map((s) => ({ ...s, removable: true }))];
        for (const cal of rows) {
          const row = el('div', 'calx-cal');
          row.style.setProperty('--c', cal.color);
          const on = !hidden.has(cal.id);
          row.classList.toggle('calx-cal--on', on);
          row.setAttribute('role', 'checkbox');
          row.setAttribute('aria-checked', String(on));
          row.tabIndex = 0;
          const name = el('span', 'calx-cal-name', cal.name);
          name.title = cal.name;
          row.append(el('span', 'calx-cal-box'), name);

          const toggle = () => {
            if (hidden.has(cal.id)) hidden.delete(cal.id);
            else hidden.add(cal.id);
            persist();
            renderCurrentView();
          };
          row.addEventListener('click', toggle);
          row.addEventListener('keydown', (ev) => {
            if (ev.key === ' ' || ev.key === 'Enter') {
              ev.preventDefault();
              toggle();
            }
          });

          if (cal.removable) {
            const x = el('button', 'calx-cal-x', '✕');
            x.title = `Remove ${cal.name}`;
            x.setAttribute('aria-label', `Remove ${cal.name}`);
            x.addEventListener('click', (ev) => {
              ev.stopPropagation();
              showConfirm({
                title: `Remove "${cal.name}"?`,
                message: 'Its events disappear from this tab. The calendar itself is not touched, and your own events stay.',
                confirmLabel: 'Remove',
              }, () => removeSource(cal.id));
            });
            row.appendChild(x);
          }
          calList.appendChild(row);
        }
      }

      function paintStage() {
        const today = todayDate();
        if (view === 'month') {
          monthCap = renderMonth({
            container: stage, refDate, dayMap, today, cap: monthCap,
            onDay: (d) => { refDate = d; setView('day'); },
            onCreate: (d) => createFor(d, null, true),
            onEvent: openEvent,
            onMore: (d, list) => showDayModal(d, list, openEvent),
          });
        } else if (view === 'week' || view === 'day') {
          renderTimeGrid({
            container: stage, days: view === 'week' ? weekDays(refDate) : [refDate], dayMap, today,
            onDay: (d) => { refDate = d; setView('day'); },
            onCreateAt: (d, min) => createFor(d, min, false),
            onCreateAllDay: (d) => createFor(d, null, true),
            onEvent: openEvent,
            onMore: (d, list) => showDayModal(d, list, openEvent),
          });
        } else {
          renderAgenda({
            container: stage, refDate, dayMap, today, onEvent: openEvent,
            onCreate: (d) => createFor(d, null, false),
          });
        }
      }

      function renderCurrentView() {
        const today = todayDate();
        dayMap = buildDayMap(allEvents.filter((e) => !hidden.has(e.calId)));
        updateHeader();
        renderCalList();
        renderMini({
          container: miniCal, anchor: miniAnchor, refDate, range: viewRange(), dayMap, today,
          onPick: (d) => goTo(d),
          onBrowse: (dir) => { miniAnchor = addMonths(new Date(miniAnchor.getFullYear(), miniAnchor.getMonth(), 1), dir); renderCurrentView(); },
        });
        paintStage();
      }

      // ===== events =====
      function openEvent(event) {
        showEventModal(event, {
          onEdit: () => openForm({ existing: event }),
          onDelete: () => removeManual(event),
        });
      }

      function openForm(opts) {
        showEventForm(opts, (data) => saveManualEvent(opts.existing || null, data));
      }

      const createFor = (day, minute, allDay) => openForm({ day, minute, allDay });

      async function reloadManual() {
        manualEvents = (await loadManual()).map(manualToRuntime).filter(validStart);
      }

      async function saveManualEvent(existing, data) {
        const list = await loadManual();
        const rec = {
          title: data.title,
          description: data.description,
          allDay: data.allDay,
          startIso: data.start.toISOString(),
          endIso: data.end ? data.end.toISOString() : null,
        };
        if (existing) {
          const i = list.findIndex((m) => m.id === existing.uid);
          if (i === -1) throw new Error('That event no longer exists.');
          list[i] = { ...list[i], ...rec };
        } else {
          list.push({ id: `manual-${Date.now()}`, ...rec });
        }
        await saveManual(list);
        await reloadManual();
        rebuild();
      }

      async function removeManual(event) {
        try {
          const list = (await loadManual()).filter((m) => m.id !== event.uid);
          await saveManual(list);
          await reloadManual();
          rebuild();
        } catch (err) {
          setStatus(`Couldn't delete the event: ${err.message}`);
        }
      }

      async function removeSource(id) {
        try {
          sources = sources.filter((s) => s.id !== id);
          await saveSources(sources);
          hidden.delete(id);
          persist();
          synced = synced.filter((e) => e.calId !== id);
          rebuild();
        } catch (err) {
          setStatus(`Couldn't remove the calendar: ${err.message}`);
        }
      }

      // ===== sync =====
      async function syncAll() {
        setStatus('Syncing…');
        sources = await loadSources();
        const results = await Promise.all(sources.map(async (source) => {
          try {
            return { source, events: parseSourceText(source, await fetchSourceText(source)) };
          } catch (err) {
            console.error(`[calendar] refresh "${source.name}" failed:`, err);
            const cached = await readCache(source);
            if (cached) {
              try { return { source, events: parseSourceText(source, cached), stale: true }; } catch { /* fall through */ }
            }
            return { source, error: err };
          }
        }));

        synced = results.flatMap((r) => r.events || []);
        await reloadManual();
        rebuild();

        const failed = results.filter((r) => r.error);
        const stale = results.filter((r) => r.stale);
        const notes = [];
        if (failed.length) {
          notes.push(`Couldn't sync "${failed[0].source.name}": ${failed[0].error.message}` +
            (failed.length > 1 ? ` (+${failed.length - 1} more)` : ''));
        }
        if (stale.length) notes.push(`Offline — showing the last saved copy of ${stale.map((r) => `"${r.source.name}"`).join(', ')}.`);
        setStatus(notes.join(' '));

        if (results.some((r) => r.events && !r.stale) || !sources.length) {
          lastSynced = new Date();
          syncedLabel.textContent = `Synced ${shortTime(lastSynced)}`;
        }
        await checkReminders(allEvents);
      }

      async function addSource(source) {
        sources = await loadSources();
        sources.push(source);
        await saveSources(sources);
        await syncAll();
      }

      // ===== wiring =====
      createBtn.addEventListener('click', () => createFor(refDate, null, view === 'month'));
      todayBtn.addEventListener('click', () => goTo(todayDate()));
      prevBtn.addEventListener('click', () => shift(-1));
      nextBtn.addEventListener('click', () => shift(1));
      refreshBtn.addEventListener('click', syncAll);
      addCalBtn.addEventListener('click', () =>
        showAddCalendarForm(sources.map((s) => s.color), addSource));
      menuBtn.addEventListener('click', () => {
        container.classList.toggle('calx-tab--collapsed');
        persist();
      });

      const onKey = (ev) => {
        if (!container.isConnected) {
          document.removeEventListener('keydown', onKey);
          return;
        }
        if (!container.getClientRects().length) return; // tab is hidden
        if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
        if (document.querySelector('.calx-modal-overlay')) return;
        if (ev.target.closest && ev.target.closest('input, textarea, select, [contenteditable="true"]')) return;
        const key = ev.key.toLowerCase();
        const target = VIEWS.find((v) => v.key === key);
        if (target) setView(target.id);
        else if (key === 't') goTo(todayDate());
        else if (key === 'c') createFor(refDate, null, view === 'month');
        else if (key === 'arrowleft') shift(-1);
        else if (key === 'arrowright') shift(1);
        else return;
        ev.preventDefault();
      };
      document.addEventListener('keydown', onKey);

      // month grid re-fits its chip count when the window or sidebar resizes
      let raf = 0;
      const ro = new ResizeObserver(() => {
        if (raf) return;
        raf = requestAnimationFrame(() => {
          raf = 0;
          if (!container.isConnected) { ro.disconnect(); return; }
          if (view === 'month') paintStage();
        });
      });
      ro.observe(stage);

      // keep the now-line and "today" fresh
      const tick = setInterval(() => {
        if (!container.isConnected) { clearInterval(tick); return; }
        for (const line of container.querySelectorAll('.calx-now')) {
          line.style.top = `${(nowMinutes() / 60) * HOUR_PX}px`;
        }
      }, 60000);

      // ===== first paint: cached data immediately, then the network =====
      try {
        sources = await loadSources();
        await reloadManual();
        const cached = await Promise.all(sources.map(async (s) => {
          const text = await readCache(s);
          try { return text ? parseSourceText(s, text) : []; } catch { return []; }
        }));
        synced = cached.flat();
      } catch (err) {
        console.warn('[calendar] initial load failed:', err);
      }
      rebuild();
      await syncAll();
    },
  });
})();