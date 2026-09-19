# modapp

**v1.0.0** · Publisher: Akhilesh Gollapudi · [github.com/coolprojects123/modapp](https://github.com/coolprojects123/modapp)

A lightweight desktop app where the bare engine is genuinely bare — a topbar
and blank space, nothing else — and everything visible comes from mods. The
app loads its frontend directly from local files; it does not run a web server.
The primary desktop build uses Tauri; an Electron build is also kept in the
repo.

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

### Tauri (lighter build)

Tauri uses the operating system WebView instead of bundling Chromium. It uses
the same `public/` frontend and keeps live mods in its writable
application-data directory. Building it requires Rust and the Tauri system
dependencies for the target platform.

```sh
npm install
npm run tauri:dev
npm run tauri:build
```

`tauri dev` starts a small static server (`scripts/dev-server.js`) that serves
`public/` and `mods/`. It prefers a standalone binary at `scripts/bin/dev-server`
(`dev-server.exe` on Windows), so Node isn't required, and falls back to
`node scripts/dev-server.js` if the binary isn't there. Get the binary by
either:

- downloading `dev-server-<os>-<cpu>` from the
  [Releases](https://github.com/coolprojects123/modapp/releases) page, saving it
  as `scripts/bin/dev-server` (or `dev-server.exe`), and running
  `chmod +x scripts/bin/dev-server` on Linux/macOS; or
- building it yourself with `node scripts/build-dev-server.js` (needs Node 20+
  and network access once; the result runs without Node).

`scripts/bin/` and `build/` are build output and shouldn't be committed.

On first launch the bundled mods are copied into `<app data>/mods`. Bundled
mods are refreshed from the app on every start, so edits you make to a bundled
mod's files in that folder are overwritten; put your own mods in their own
folders. Each mod gets a private data folder at `<app data>/mod-data/<mod-id>`.

### Electron

```sh
npm install
npm start
```

This launches the app in a desktop window using Electron. Electron copies the
shipped mods into a writable `userData/mods` directory; that is the only live
app directory. The bundled application files remain read-only. Music files
are imported into the current app session as local object URLs and are not
uploaded anywhere.

> The security model described below (permissions, sandboxing, CSP, updater
> checks) is implemented in the **Tauri** build.

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

### Native APIs and permissions

Desktop mods reach native features through `ModAPI.native` (also available as
`window.appAPI`). What a mod is allowed to do is declared in the
`permissions` array of its `mod.json`, and enforced by the Rust side. A mod
that is disabled gets no capabilities.

| Permission | Grants |
| --- | --- |
| `fs.read`, `fs.write`, `fs.read_dir`, `fs.ensure_dir`, `fs.remove`, `fs.move` | file access **inside the mod's own data folder only** |
| `webview.access` | create / show / hide / move / close native webviews (`http(s)` URLs only) |
| `settings.read`, `settings.write` | read / write site settings (used by the Core mod) |
| `mods.toggle` | enable or disable mods (used by the Core mod) |
| `shell.run` | run shell commands from the mod's `backend.lua` |

```js
// Files: scoped to <app data>/mod-data/<mod-id>
const fs = ModAPI.native.fs.forMod('my-mod');
await fs.writeFile('notes/today.txt', 'hello');
const text = await fs.readFile('notes/today.txt');

// Native webview (needs "webview.access")
await ModAPI.native.webview.create('my-mod', 'main', {
  url: 'https://example.com', x: 0, y: 64, width: 800, height: 600,
});

// Shell (needs "shell.run" and a run_command function in backend.lua)
const result = await ModAPI.native.shell.forMod('my-mod').run('uname -a');
console.log(result.stdout, result.stderr, result.code, result.timedOut);
```

Paths must be relative to the mod's data folder: `..`, absolute paths and
symlinks that point outside the folder are rejected. Each mod's data folder is
capped at 4 GiB.

**Backend scripts.** A mod can ship a `backend.lua`, run in a sandboxed Lua
state (no `io`, `os`, `dofile`, `loadfile` or `require`) with a 64 MiB memory
limit and an instruction budget that stops runaway loops. It is called with
`ModAPI.native.callBackend(modId, functionName, [args...])`; arguments are
strings. Host functions such as `run_shell` and `ensure_dir` are available
inside the script but can't be invoked directly as the entry point.

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
is available in the Electron and Tauri desktop builds, not in a plain browser.

### Trust model

**Treat every installed mod as fully trusted code.** All mods run in the same
webview and identify themselves to the native side with a string, so
permissions keep well-behaved mods inside their lane and stop mistakes, but
they are **not a sandbox against a malicious mod**. A mod that can run
JavaScript can ask for another mod's backend, so installing a mod that
declares `shell.run` (like the IDE) effectively lets any installed mod run
commands. Only install mods you trust.

Other protections in the Tauri build: a Content-Security-Policy that limits
scripts and network access, an asset-protocol scope limited to
`<app data>/mods` and the music player's data, and native webviews restricted
to `http(s)` pages that get no access to the app's commands.

### Enabling/disabling

Open Settings (gear icon, far right) → Mods. Every non-core mod gets an on/off
switch; the `core` folder is shown as locked.

## Settings

The `Core` mod reads and writes site settings and enabled-mod state. In the
Tauri build these live in the app-data `mods` folder (`.settings.json` and
`.config.json`); the accent color picker and mod toggles are available in
Settings.

## Updates (Tauri build)

Updates are served from GitHub Releases: the app checks
`https://github.com/coolprojects123/modapp/releases/latest/download/latest.json`.
Update packages must be signed, and the app only treats updates as configured
when a public key is set in `src-tauri/tauri.conf.json`
(`plugins.updater.pubkey`). Installing always asks for confirmation in a native
dialog, so a mod can't install an update silently.

To set up releases:

1. Generate a key pair: `cargo tauri signer generate -w ~/.tauri/modapp.key`
2. Put the **public** key in `plugins.updater.pubkey`.
3. Keep the **private** key out of the repo. Provide it to the release build as
   `TAURI_SIGNING_PRIVATE_KEY` (and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` if set),
   for example as GitHub Actions secrets.
4. Set `bundle.createUpdaterArtifacts` to `true` and publish a normal
   (non-draft, non-prerelease) GitHub release that includes `latest.json`.

The updater key is only for verifying updates; it is unrelated to the
operating-system code signing described in the next section.

The app version is `version` in `src-tauri/tauri.conf.json`; keep
`src-tauri/Cargo.toml` and `package.json` in step with it. Installed copies
only offer an update when `latest.json` lists a higher version.

## Distribution and code signing

Releases are **not code-signed yet**, so your operating system may warn when
you install or first run the app:

- **Windows:** SmartScreen may show "Windows protected your PC" and list the
  publisher as unknown. Choose **More info → Run anyway** if you trust the
  download. The publisher name in the installer's properties comes from the
  signing certificate, not from the publisher field in `tauri.conf.json`.
- **macOS:** Gatekeeper may block the app because it isn't signed and
  notarized. Right-click the app and choose **Open**, or allow it under
  System Settings → Privacy & Security.
- **Linux:** no signing is needed.

Only download releases from this repository's
[Releases](https://github.com/coolprojects123/modapp/releases) page.

If signing is added later, Tauri supports it through `bundle.windows`
(`signCommand` or `certificateThumbprint`) on Windows and Apple Developer ID
signing plus notarization on macOS. Signing certificates and their passwords
must never be committed to the repo; provide them to the release build as
secrets.

## Project layout

```
public/js/mods.js           fallback mod manifest registry
<app data>/mods/            writable live mods and mod state at runtime
<app data>/mod-data/<id>/   private data folder for each mod
mods/core/                  ships with modsite: Settings + Login; core by name
mods/<id>/...                any other mod you add
public/index.html            loads mods.js, bootstrap.js, then site.js
public/js/bootstrap.js       the engine: loads mods, defines ModAPI
public/js/site.js            the bare site: topbar + blank content
public/js/native-api-v2.js   native API bridge (ModAPI.native / window.appAPI)
public/css/site.css          all core styling
src-tauri/                   Rust side: mod loading, permissions, Lua backends
electron/                    Electron build
```