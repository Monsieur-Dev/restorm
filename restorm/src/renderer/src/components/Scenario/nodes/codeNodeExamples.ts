import type { CodeLanguage } from '../../../../../shared/codeLanguages'

/**
 * A short, runnable example per `code`-node language, shown in the modal's
 * "help" tab. Each snippet demonstrates the node's injection contract for that
 * runtime: how the wired `input` value and the run `vars` arrive, how to log,
 * and how the result flows out of the `result` port.
 *
 * The contracts differ by runtime (verified against each runtime's tests):
 *  - TS/JS   : `input` / `vars` globals + curated stdlib globals; `return` the result.
 *  - Python  : `input` / `vars` dicts; `print(...)` → run log; LAST expression is the result.
 *  - Lua     : `input` / `vars` tables; `print(...)` → run log; `return` the result.
 *  - Ruby    : `$input` / `$vars` globals; `puts` → run log; LAST expression is the result.
 *  - R       : `input` / `vars`; `cat(...)`/`print(...)` → run log; LAST expression is the result.
 *  - C#      : `input` / `vars` dictionaries; `Console.WriteLine` → run log; LAST expression is the result.
 *
 * The code (and its comments) stays in English on purpose — it is example
 * source, not UI copy. Only the surrounding tab labels / prose are translated.
 */
export const CODE_NODE_EXAMPLES: Record<CodeLanguage, string> = {
  typescript: `// \`input\` = the wired value, \`vars\` = the run variables.
// Curated stdlib globals: _ (lodash), moment, uuid, nanoid, CryptoJS, Ajv…
// Whatever you \`return\` flows out of the \`result\` port.
const names = _.map(input.items, 'name')
return {
  id: uuid.v4(),
  count: names.length,
  at: moment().toISOString(),
  env: vars.environment
}`,
  javascript: `// \`input\` = the wired value, \`vars\` = the run variables.
// Curated stdlib globals: _ (lodash), moment, uuid, nanoid, CryptoJS, Ajv…
// Whatever you \`return\` flows out of the \`result\` port.
const names = _.map(input.items, 'name')
return {
  id: uuid.v4(),
  count: names.length,
  at: moment().toISOString(),
  env: vars.environment
}`,
  python: `# \`input\` = the wired value, \`vars\` = the run variables.
# \`print(...)\` goes to the run log; the LAST expression is the result.
names = [it["name"] for it in input["items"]]
print(len(names), "items")
{"count": len(names), "env": vars["environment"]}`,
  lua: `-- \`input\` = the wired value, \`vars\` = the run variables.
-- \`print(...)\` goes to the run log; \`return\` yields the result.
local names = {}
for _, it in ipairs(input.items) do
  names[#names + 1] = it.name
end
print(#names, "items")
return { count = #names, env = vars.environment }`,
  ruby: `# \`$input\` = the wired value, \`$vars\` = the run variables.
# \`puts\` goes to the run log; the LAST expression is the result.
names = $input["items"].map { |it| it["name"] }
puts "#{names.length} items"
{ "count" => names.length, "env" => $vars["environment"] }`,
  r: `# \`input\` = the wired value, \`vars\` = the run variables.
# \`cat(...)\` / \`print(...)\` go to the run log; the LAST expression is the result.
names <- sapply(input$items, function(it) it$name)
cat(length(names), "items\\n")
list(count = length(names), env = vars$environment)`,
  csharp: `// \`input\` = the wired value, \`vars\` = the run variables (dictionaries).
// Console.WriteLine goes to the run log; the LAST expression is the result.
var items = (IEnumerable<object>)input["items"];
Console.WriteLine($"{items.Count()} items");
new Dictionary<string, object> {
    ["count"] = items.Count(),
    ["env"] = vars["environment"]
};`
}
