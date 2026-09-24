-- Calendar mod backend. Two responsibilities:
--   fetch_calendar(url)  -- pulls a remote .ics via curl, caches the raw
--                           text in this mod's own data directory
--   check_reminders(json)-- given upcoming events (computed by tab.js from
--                           the cached ICS), fires OS notifications for any
--                           that are due, via the global notify() host
--                           function
--
-- Parsing the ICS text itself happens in JS (js/ics-parser.js) -- Lua just
-- moves bytes and triggers notifications. Keeping the parser in JS means it
-- can be unit tested and iterated on without round-tripping through Lua.
--
-- HISTORY WORTH KNOWING (so this doesn't get "fixed" back into a broken
-- state later): fetch_calendar used to build a `curl ...` command as a
-- string and run it via run_shell (shell.run permission), with the URL
-- quoted for shell-safety. That was fundamentally unreliable on Windows:
-- shell.run's cmd.exe path re-parses the command string TWICE -- once via
-- Rust's own Command::arg() escaping, once via cmd.exe's own incompatible
-- quoting rules -- and no quoting scheme applied in this file could
-- satisfy both layers at once (see the long comment on run_shell_command
-- in shell.rs). It intermittently produced curl errors like "URL rejected:
-- Port number was not a decimal number" depending on the URL's exact
-- content, which is the "port number" error you may find referenced in
-- older commit history/comments for this file.
--
-- Fix: fetch_url (net.fetch permission) runs curl directly, with no shell
-- involved at all -- the URL is passed as one genuine argv element, so
-- there is nothing to quote or escape on either platform. mod.json's
-- permissions changed from shell.run to net.fetch accordingly (this mod no
-- longer needs, or has, arbitrary shell access).
function fetch_calendar(url)
    -- Belt-and-suspenders with tab.js's own validateUrl check -- this
    -- function shouldn't trust its caller blindly either.
    if not (string.match(url, "^https?://")) then
        error("calendar url must be http(s)")
    end

    local result = fetch_url(url)
    if result.code ~= 0 then
        error("fetch failed (exit " .. tostring(result.code) .. "): " .. tostring(result.stderr))
    end

    -- io.* is stripped from this sandbox (see lua_env.rs), so this function
    -- can't write the cache file itself -- it only fetches and returns the
    -- raw text. tab.js writes it to disk via ModAPI.native.fs.forMod, which
    -- goes through system_write_file instead.
    return result.stdout
end

-- events: JSON array of { title, start_epoch_seconds } for events starting
-- within the next reminder window (tab.js decides the window and does the
-- date math; this just fires the notification for whatever it's handed).
function check_reminders(events_json)
    local events = decode_events(events_json)
    for _, event in ipairs(events) do
        notify(event.title, event.when or "")
    end
    return true
end

-- Minimal JSON array-of-objects decoder for the one shape we need here
-- ({title, when}), so this file doesn't need a general JSON library on the
-- Lua side. tab.js is the source of truth for parsing the actual ICS.
-- (string.gmatch works here because lua_env.rs loads StdLib::STRING --
-- see that file's history if this ever errors with "attempt to index a
-- nil value (global 'string')" again.)
function decode_events(json)
    local events = {}
    for title, when in string.gmatch(json, '"title"%s*:%s*"(.-)"%s*,%s*"when"%s*:%s*"(.-)"') do
        table.insert(events, { title = title, when = when })
    end
    return events
end