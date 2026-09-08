-- Music Player mod backend.
-- Runs inside a sandboxed Lua environment: the only functions available
-- here are the ones granted by mod.json's "permissions" array ("fs.ensure_dir").
-- There is no io, os, or shell access unless explicitly granted.

function ensure_uploads_dir()
    return ensure_dir("music-uploads")
end