# modapp

**v2.2.0** · Publisher: Akhilesh Gollapudi · [github.com/coolprojects123/modapp](https://github.com/coolprojects123/modapp)

A lightweight desktop app where the bare engine is genuinely bare — a topbar
and blank space, nothing else — and everything visible comes from mods. The
app loads its frontend directly from local files; it does not run a web server.
Electron is the only supported desktop runtime.

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
                          settings dialog with a sidebar nav, General/Mods).
                          More essential features land here over time.
```

The **Official Modpack** (a separate download) adds optional content on top
— currently just a Home tab. Disable it and you lose Home; Settings is unaffected.

## Run it

```sh
npm install
npm start
```

Build installers with `npm run build:windows` or `npm run build:linux`.
The app copies shipped mods into Electron's writable `userData/mods` directory
on first launch. Each mod gets a private `userData/mod-data/<mod-id>` folder.
Imported music stays on the local machine.

## Core mod

The mod in the `mods/core` folder is always enabled and cannot be disabled.
Core status is determined by the folder name, not by a manifest field.

## Writing a mod

Create a folder under `/mods/<your-mod-id>/` with a `mod.json` manifest.

The folder name is the mod id. Ids may only contain letters, digits, `-` and
`_` (max 64 characters); folders with other names are ignored.

```json
{
  "name": "My Mod",
  "version": "1.0.0",
  "author": "you",
  "description": "what it does",
  "enabledByDefault": true,
  "permissions": [],
  "styles": ["style.css"],
  "scripts": ["script.js"]
}
```

`apis`, `styles` and `scripts` are paths inside the mod's own folder. Absolute
paths, URLs and anything containing `..` are rejected. `apis` load first, then
styles, then scripts.

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
// Settings uses center + overlay + width —
// that combination is what gives a panel real settings-dialog styling
// (bigger radius/padding, a proper header) via the .modal CSS class,
// which site.css applies automatically whenever center: true is set.


// Fully replace how an EXISTING tab renders.
ModAPI.overrideTab('my-tab', (container) => { container.innerHTML = '<h1>Different now</h1>'; });

// Hook into an existing tab without taking it over.
ModAPI.onTabActivate('my-tab', (container) => { container.insertAdjacentHTML('beforeend', '<p>added on top</p>'); });
```

`ModAPI.renderMarkdown(text)` returns safe HTML for a markdown string, and
`ModAPI.setMarkdown(element, text)` renders it into an element (links open in
the system browser). Raw HTML in the text is escaped, and only `http`, `https`
and `mailto` links are kept. Both come from the Core mod's `markdown.js`.

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

### Native APIs and permissions

Desktop mods reach native features through `ModAPI.native` (also available as
`window.appAPI`). Capabilities are checked in Electron's main process against
the calling mod's manifest; a disabled mod gets no capabilities.

| Permission | Grants |
| --- | --- |
| `fs.read`, `fs.write`, `fs.read_dir`, `fs.ensure_dir`, `fs.remove`, `fs.move` | corresponding filesystem access outside the mod's own data folder |
| `webview.access` | create / show / hide / close contained Electron `<webview>` elements (`http(s)` URLs only) |
| `settings.read`, `settings.write` | read / write site settings (used by the Core mod) |
| `mods.toggle` | enable or disable mods (used by the Core mod) |
| `shell.run` | run a bounded shell command from the mod's private data folder |
| `pty.access` | create an interactive terminal session |
| `dialog.pick` | open native file/folder pickers |
| `net.fetch` | fetch HTTP(S) resources |
| `notifications.send` | show rate-limited desktop notifications |

```js
// Files: scoped to <app data>/mod-data/<mod-id>
const fs = ModAPI.native.fs.forMod('my-mod');
await fs.writeFile('notes/today.txt', 'hello');
const text = await fs.readFile('notes/today.txt');

// Contained Electron webview (needs "webview.access")
await ModAPI.native.webview.create('my-mod', 'main', {
  url: 'https://example.com', container: document.querySelector('#webview-host'),
});

// Shell (needs "shell.run")
const result = await ModAPI.native.shell.forMod('my-mod').run('uname -a');
console.log(result.stdout, result.stderr, result.code, result.timedOut);

// Network (needs "net.fetch")
const response = await ModAPI.native.net.fetch('my-mod', 'https://example.com/data');
```

Relative paths are confined to the mod's data folder; traversal and symlink
escapes are rejected. Absolute paths require the matching `fs.*` permission.
Each mod's data folder is capped at 4 GiB.

**Shell commands** (`shell.run`) run through `bash -c` (`cmd /C` on Windows),
default to the mod's own data folder as working directory, time out after 30
seconds and capture at most 1 MiB per stream. The result is
`{ code, stdout, stderr, timedOut }`. Only grant this permission to a mod
whose purpose needs it — see the trust model below.

The IDE mod demonstrates this pattern with its own native API in
`mods/ide/api.js`:

```js
const result = await ModAPI.ide.runCommand('uname -a');
console.log(result.stdout, result.stderr, result.code);
```

Pass a working directory as the second argument when needed. This native API
is available in the Electron desktop build, not in a plain browser.

### Trust model

**Treat every installed mod as fully trusted code.** All mods run in the same
webview, but **mod ID isolation** now prevents mods from impersonating each other.
Each mod's API calls automatically use that mod's own ID, and the main process
validates that the caller's ID matches the requested permissions.

This means:
- A mod can only use its own permissions, not another mod's permissions
- Installing a mod with `shell.run` (like the IDE) no longer lets other mods run commands
- Permission checks enforce that each mod stays within its declared permissions

**However**, mods still share one renderer, so they can potentially interact with
each other through shared JavaScript globals. Only install mods you trust. Remote
webviews accept only HTTP(S) URLs and do not receive the app's preload bridge.

### Enabling/disabling

Open Settings (gear icon, far right) → Mods. Every non-core mod gets an on/off
switch; the `core` folder is shown as locked.

## Settings

The `Core` mod reads and writes site settings and enabled-mod state. These live
in Electron's `userData/mods` folder (`.settings.json` and `.config.json`); the
accent color picker and mod toggles are available in Settings.

## Updates

Packaged builds check GitHub Releases through `electron-updater`. When an update
is found, an in-app dialog shows the version change and the release notes, and
installing always requires clicking **Install and restart** there. It also
appears under Settings → Updates.

The release notes are the body of the GitHub release, written in markdown.
Tag builds publish as a draft release, so write the notes in the draft's
description and publish it when its installers and update metadata are ready.
The app version is the `version` in `package.json`.

## Distribution and code signing

Releases are **not code-signed yet**, so your operating system may warn when
you install or first run the app:

- **Windows:** SmartScreen may show "Windows protected your PC" and list the
  publisher as unknown. Choose **More info → Run anyway** if you trust the
  download. The publisher name in the installer's properties comes from the
  signing certificate.
- **macOS:** Gatekeeper may block the app because it isn't signed and
  notarized. Right-click the app and choose **Open**, or allow it under
  System Settings → Privacy & Security.
- **Linux:** no signing is needed.

Only download releases from this repository's
[Releases](https://github.com/coolprojects123/modapp/releases) page.

Signing certificates and their passwords must never be committed to the repo;
provide them to release builds as secrets.

## Project layout

```
public/js/mods.js           fallback mod manifest registry
<app data>/mods/            writable live mods and mod state at runtime
<app data>/mod-data/<id>/   private data folder for each mod
mods/core/                  ships with modsite: Settings; core by name
mods/<id>/...                any other mod you add
public/index.html            loads mods.js, bootstrap.js, then site.js
public/js/bootstrap.js       the engine: loads mods, defines ModAPI
public/js/site.js            the bare site: topbar + blank content
public/js/native-api.js      Electron API bridge (ModAPI.native / window.appAPI)
public/css/site.css          all core styling
electron/                    Electron main process, preload, scoped APIs, and update-notes.js
```