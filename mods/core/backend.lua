-- Core mod backend. Holds the app-wide settings and mod-toggling logic
-- that used to be standalone Tauri commands (read_settings, write_settings,
-- toggle_mod). Only reachable because Core's mod.json declares
-- "settings.read", "settings.write", "mods.toggle" -- no other mod gets
-- these host functions installed into its sandbox.

function read_settings()
    return settings_read()
end

function write_settings(changes_json)
    return settings_write(changes_json)
end

function toggle_mod(id)
    return mods_toggle(id)
end