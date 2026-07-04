-- Tiny zero-dependency pure-Lua module, committed as an offline e2e fixture for
-- the code-node external-dependencies chain (no live LuaRocks network).
--
-- The Lua runtime caches one `<module>.lua` source file per package and pushes
-- it into wasmoon's `package.preload`, so `require("restormluadep")` resolves
-- offline. The filename (minus `.lua`) IS the require name.
local M = {}

M.version = "1.0.0"

function M.greeting()
  return "hello from restormluadep"
end

return M
