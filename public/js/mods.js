window.MOD_MANIFESTS = [
  {
    "name": "Browser",
    "version": "1.0.0",
    "author": "modapp",
    "description": "Tabbed browser. Background tabs are kept light so many tabs stay fast.",
    "enabledByDefault": true,
    "styles": [
      "style.css"
    ],
    "scripts": [
      "script.js"
    ],
    "permissions": [
      "webview.access"
    ],
    "id": "browser",
    "core": false,
    "enabled": true
  },
  {
    "name": "Calendar",
    "icon": "calendar_month",
    "description": "Month/Week/Day/Agenda calendar with ICS sync.",
    "enabledByDefault": true,
    "permissions": [
      "net.fetch",
      "notifications.send"
    ],
    "apis": [],
    "styles": [
      "css/calendar.css"
    ],
    "scripts": [
      "js/ics-parser.js",
      "js/tab.js",
      "js/settings.js"
    ],
    "id": "calendar",
    "core": false,
    "enabled": true
  },
  {
    "name": "Core",
    "version": "1.0.0",
    "author": "modapp",
    "description": "Home page and Settings.",
    "enabledByDefault": true,
    "apis": [
      "api.js",
      "settings-api.js",
      "markdown.js"
    ],
    "styles": [
      "style.css"
    ],
    "scripts": [
      "script.js"
    ],
    "permissions": [
      "settings.read",
      "settings.write",
      "fs.ensure_dir",
      "mods.toggle"
    ],
    "id": "core",
    "core": true,
    "enabled": true
  },
  {
    "name": "IDE",
    "version": "1.0.0",
    "author": "modapp",
    "description": "A lightweight code workspace with a native terminal.",
    "enabledByDefault": true,
    "apis": [
      "api.js"
    ],
    "styles": [
      "style.css"
    ],
    "scripts": [
      "script.js"
    ],
    "permissions": [
      "shell.run",
      "pty.access",
      "dialog.pick"
    ],
    "id": "ide",
    "core": false,
    "enabled": true
  },
  {
    "name": "Music Player",
    "version": "1.0.0",
    "author": "modapp",
    "description": "Import and play local music and video files in the app.",
    "enabledByDefault": true,
    "apis": [
      "api.js"
    ],
    "styles": [
      "style.css"
    ],
    "scripts": [
      "script.js"
    ],
    "permissions": [
      "fs.ensure_dir",
      "fs.read",
      "fs.write",
      "fs.read_dir",
      "fs.move",
      "fs.remove",
      "webview.access"
    ],
    "id": "music-player",
    "core": false,
    "enabled": true
  },
  {
    "name": "Notes",
    "version": "1.1.0",
    "author": "modapp",
    "description": "A floating notepad with tabs. Notes autosave and come back next launch.",
    "enabledByDefault": true,
    "styles": [
      "style.css"
    ],
    "scripts": [
      "script.js"
    ],
    "permissions": [],
    "id": "notes",
    "core": false,
    "enabled": true
  }
];