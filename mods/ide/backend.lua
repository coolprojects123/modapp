-- IDE mod backend. Only reachable because IDE's mod.json declares
-- "shell.run" -- this is the one mod in the app that gets real shell
-- access, since a Bash terminal is its entire purpose.

function run_command(command, cwd)
    if cwd == "" then cwd = nil end
    return run_shell(command, cwd)
end