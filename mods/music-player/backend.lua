-- Music Player mod backend.
-- Runs inside a sandboxed Lua environment: the only functions available
-- here are the ones granted by mod.json's "permissions" array ("fs.ensure_dir", "fs.read", "fs.write", "fs.read_dir", "fs.move", "fs.remove").
-- There is no io, os, or shell access unless explicitly granted.

-- Note: ensure_uploads_dir is now part of the core mod's FS API.