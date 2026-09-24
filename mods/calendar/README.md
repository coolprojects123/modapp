# Calendar + global notifications — scaffold

## To wire up (not automated here)

1. **Cargo.toml** (in `src-tauri/`): add
   ```toml
   tauri-plugin-notification = "2"
   ```
   and, if you're on Tauri v2 with per-plugin permissions in `capabilities/*.json`,
   grant the notification plugin's `notification:default` permission the same
   way `dialog:default` presumably already is (I haven't seen your capabilities
   file, so check it matches).

2. **Frontend JS**: `native-api-v2.js` and `bootstrap.js` need a small
   `notify(modId, title, body)` wrapper added to `ModAPI.native`, mirroring
   the `callBackend`/`webview` wrappers already there — calling
   `invokeFn('send_notification', { modId, title, body })`. Not included in
   this scaffold since I didn't want to hand you a full rewrite of files
   you're actively iterating on; say the word and I'll produce the exact diff.

3. **`curl` availability**: `backend.lua`'s `fetch_calendar` shells out to
   `curl`. It's preinstalled on macOS/Linux; on Windows it's bundled with
   modern `cmd.exe`/PowerShell (Win10 1803+) but not guaranteed on older
   systems. Worth a runtime check with a clear error if it's missing, rather
   than a cryptic "command not found" from `shell.run`.

## Deliberately out of scope for this pass

- **No background service.** Reminders only fire while the app is open and
  the calendar tab has rendered/refreshed at least once. Turning this into a
  true background check (app closed or minimized) is a materially bigger
  change — a persistent scheduler in `lib.rs`, likely an autostart plugin —
  and wasn't the scope agreed on. Flag if you want to revisit.
- **ICS parser is intentionally minimal** (see the comment at the top of
  `ics-parser.js`): no timezone handling beyond UTC/"Z", no EXDATE/RDATE, no
  MONTHLY/YEARLY recurrence. Fine for typical personal exports; will need
  work for exports from providers with heavier recurrence use (Outlook in
  particular tends to produce more complex RRULEs).
- **No sync-back.** This is read-only/offline-cache, matching what you
  asked for ("importer + offline cacher"), not a two-way calendar client.
- **"Some other stuff"** from earlier is still undefined — nothing here
  covers it since we never landed on what it was.

## Permission surface added

- `notifications.send` — new, global, any mod can request it (checked in
  `permissions.rs` via the existing `require_permission`, no new mechanism).
- Calendar mod itself requests `shell.run` (for `curl`) and
  `notifications.send`. It does **not** request any `fs.*` permission —
  everything it reads/writes is inside its own data directory, which is
  free for any enabled mod, per `paths.rs::resolve_mod_path`.
- This still doesn't touch the standing "self-declared permissions" gap
  flagged earlier — the calendar mod's manifest just happens to ask for
  reasonable things. Worth fixing that allowlist gap before shipping any of
  this to users who might install third-party mods.