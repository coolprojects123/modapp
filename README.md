# modapp

A lightweight Electron app where the bare engine is genuinely bare — a topbar
and blank space, nothing else — and everything visible comes from mods. The
app loads its frontend directly from local files; it does not run a web server.

```
public/js/bootstrap.js   the engine. Loads which mods are enabled, injects
                          their CSS/JS, exposes ModAPI
                          (registerTab, registerWidget, overrideTab,
                          onTabActivate). No styling or branding.

public/js/site.js         the bare site: topbar (logo + wherever mods hang
                          tabs/widgets) + blank content. If every mod were
                          disabled, this is literally all you'd see.

mods/core/                 Core mod, identified by its folder name. Currently:
                          Settings (gear icon, far right of topbar — a real
                          settings dialog with a sidebar nav, General/Mods)
                          and Login (same dialog treatment). Both dim the
                          page behind them and close on click-outside/Esc.
                          More essential features land here over time.
```

The **Official Modpack** (a separate download) adds optional content on top
— currently just a Home tab. Disable it and you lose Home; Settings and
Login are unaffected either way, since those aren't part of it anymore.

## Run it

```
npm install
npm start
```

This launches the app in a desktop window using Electron. Electron copies the
shipped mods into a writable `userData/mods` directory; that is the only live
app directory. The bundled application files remain read-only. Music files
are imported into the current app session as local object URLs and are not
uploaded anywhere.

## Faster alternative

Tauri is also configured as a lighter desktop build. It uses the operating
system WebView instead of bundling Chromium, while keeping Electron available
for the full Node-compatible build.

```sh
npm install
npm run tauri:dev
npm run tauri:build
```

The Tauri build uses the same `public/` frontend and stores live mods in its
writable application-data directory. Building it requires Rust and the Tauri
system dependencies for the target platform.

## Core mod

The mod in the `mods/core` folder is always enabled and cannot be disabled.
Core status is determined by the folder name, not by a manifest field.

## Login (read this before using it for anything real)

The Login widget is **demo-grade, not production security**:

- One hardcoded credential (`admin` / `modsite`), no password hashing
- Login state is stored in local storage
- No rate limiting, no HTTPS enforcement, no CSRF protection
- Nothing server-side is actually gated behind a valid token yet — logging
  in doesn't currently unlock or protect anything else

It's there to demonstrate the login flow end-to-end (form → token →
"logged in as" state → logout), not to guard anything. Replace the whole
auth flow before using it for real security.

## Writing a mod

Create a folder under `/mods/<your-mod-id>/` with a `mod.json` manifest:

```json
{
  "name": "My Mod",
  "version": "1.0.0",
  "author": "you",
  "description": "what it does",
  "enabledByDefault": true,
  "styles": ["style.css"],
  "scripts": ["script.js"]
}
```

Your `script.js` runs with a global `ModAPI`:

```js
// Add a tab to the nav.
ModAPI.registerTab({
  id: 'my-tab',
  label: 'My Tab',
  icon: 'star',              // any Material Symbols Outlined icon name
  render(container) {
    container.innerHTML = '<h1>Hello from my mod</h1>';
  },
});

// Add a button to the far right of the topbar that opens a panel.
ModAPI.registerWidget({
  id: 'my-widget',
  label: 'My Widget',
  icon: 'bolt',
  center: false,     // true = centered instead of cascading from top-left
  draggable: true,   // ignored if center or overlay is true
  overlay: false,    // true = dims the page, click-outside/Esc closes it
  width: null,        // e.g. '480px' — explicit size, no DOM hacks needed
  height: null,
  noChrome: false,   // true = skip the built-in title+close header; mount
                     // gets (container, close) and owns its own chrome
  mount(container, close) {
    container.innerHTML = '<p>lives in a panel</p>';
    // close() is available if you want a custom "Done" button etc.
  },
});
// Settings and Login both use center + overlay + width —
// that combination is what gives a panel real settings-dialog styling
// (bigger radius/padding, a proper header) via the .modal CSS class,
// which site.css applies automatically whenever center: true is set.


// Fully replace how an EXISTING tab renders.
ModAPI.overrideTab('my-tab', (container) => { container.innerHTML = '<h1>Different now</h1>'; });

// Hook into an existing tab without taking it over.
ModAPI.onTabActivate('my-tab', (container) => { container.insertAdjacentHTML('beforeend', '<p>added on top</p>'); });
```

`window.Icon(name, { size, color, title })` is also available (site.js sets
it up) for topbar-style icons inside your own tab/widget markup.

Mods can set the app identity:

```js
ModAPI.setIdentity({ title: 'My App', icon: '★' });
```

The title changes the wordmark and document title; the icon changes the
top-bar mark. `icon` can be text, an HTTP/file URL, a data image URL, or a
direct link to an SVG file:

```js
ModAPI.setIdentity({ title: 'My App', icon: './assets/app-icon.svg' });
```

The last loaded mod that calls `setIdentity` wins.

Desktop mods can define their own native API in the mod folder and use the
generic native invocation primitive. The IDE demonstrates this in
`mods/ide/api.js`; its commands run with `/usr/bin/bash` and default to the
writable live mods directory:

```js
const result = await ModAPI.ide.runCommand('uname -a');
console.log(result.stdout, result.stderr, result.code);
```

Pass a working directory as the second argument when needed. This native API
is available in Electron and Tauri desktop builds, not in a plain browser.

### Enabling/disabling

Open Settings (gear icon, far right) → Mods. Every non-core mod gets an on/off
switch; the `core` folder is shown as locked.

## Settings

The `Core` mod reads and writes site settings and enabled-mod state through
local storage. The accent color picker and mod toggles are available in
Settings.

## Project layout

```
public/js/mods.js           fallback mod manifest registry
userData/mods/              writable live mods and mod state at runtime
mods/core/                  ships with modsite: Settings + Login; core by name
mods/<id>/...                any other mod you add
public/index.html            loads mods.js, bootstrap.js, then site.js
public/js/bootstrap.js       the engine: loads mods, defines ModAPI
public/js/site.js            the bare site: topbar + blank content
public/css/site.css          all core styling
```
