/**
 * Handlebars helpers definitions for Monaco autocompletion
 * All helpers are implemented in handlebarsHelpers.ts
 * Descriptions are i18n keys from helpers.{name} in translation files
 */

export interface HandlebarsHelperDefinition {
  name: string
  category: string
  syntax: string
  example?: string
}

export const handlebarsHelpersDefinitions: HandlebarsHelperDefinition[] = [
  // ============================================================================
  // Comparison Helpers
  // ============================================================================
  { name: 'eq', category: 'comparison', syntax: '{{eq a b}}', example: '{{eq 1 1}} → true' },
  { name: 'ne', category: 'comparison', syntax: '{{ne a b}}', example: '{{ne 1 2}} → true' },
  { name: 'neq', category: 'comparison', syntax: '{{neq a b}}', example: '{{neq 1 2}} → true' },
  { name: 'lt', category: 'comparison', syntax: '{{lt a b}}', example: '{{lt 1 2}} → true' },
  { name: 'lte', category: 'comparison', syntax: '{{lte a b}}', example: '{{lte 1 1}} → true' },
  { name: 'gt', category: 'comparison', syntax: '{{gt a b}}', example: '{{gt 2 1}} → true' },
  { name: 'gte', category: 'comparison', syntax: '{{gte a b}}', example: '{{gte 2 2}} → true' },
  { name: 'and', category: 'comparison', syntax: '{{#and a b}}...{{/and}}' },
  { name: 'or', category: 'comparison', syntax: '{{#or a b}}...{{/or}}' },
  { name: 'not', category: 'comparison', syntax: '{{not value}}', example: '{{not false}} → true' },
  { name: 'ifEquals', category: 'comparison', syntax: '{{#ifEquals a b}}...{{else}}...{{/ifEquals}}' },
  { name: 'is', category: 'comparison', syntax: '{{#is a b}}...{{/is}}' },
  { name: 'isnt', category: 'comparison', syntax: '{{#isnt a b}}...{{/isnt}}' },
  { name: 'default', category: 'comparison', syntax: '{{default value defaultValue}}', example: '{{default name "Anonymous"}}' },
  { name: 'compare', category: 'comparison', syntax: '{{#compare a "==" b}}...{{/compare}}', example: 'Operators: ==, ===, !=, !==, <, <=, >, >=' },

  // ============================================================================
  // String Helpers
  // ============================================================================
  { name: 'lowercase', category: 'string', syntax: '{{lowercase str}}', example: '{{lowercase "HELLO"}} → "hello"' },
  { name: 'uppercase', category: 'string', syntax: '{{uppercase str}}', example: '{{uppercase "hello"}} → "HELLO"' },
  { name: 'capitalize', category: 'string', syntax: '{{capitalize str}}', example: '{{capitalize "hello"}} → "Hello"' },
  { name: 'capitalizeAll', category: 'string', syntax: '{{capitalizeAll str}}', example: '{{capitalizeAll "hello world"}} → "Hello World"' },
  { name: 'titleize', category: 'string', syntax: '{{titleize str}}', example: '{{titleize "hello world"}} → "Hello World"' },
  { name: 'camelcase', category: 'string', syntax: '{{camelcase str}}', example: '{{camelcase "foo-bar"}} → "fooBar"' },
  { name: 'pascalcase', category: 'string', syntax: '{{pascalcase str}}', example: '{{pascalcase "foo-bar"}} → "FooBar"' },
  { name: 'snakecase', category: 'string', syntax: '{{snakecase str}}', example: '{{snakecase "fooBar"}} → "foo_bar"' },
  { name: 'snakeCase', category: 'string', syntax: '{{snakeCase str}}', example: '{{snakeCase "fooBar"}} → "foo_bar"' },
  { name: 'dashcase', category: 'string', syntax: '{{dashcase str}}', example: '{{dashcase "fooBar"}} → "foo-bar"' },
  { name: 'dotcase', category: 'string', syntax: '{{dotcase str}}', example: '{{dotcase "fooBar"}} → "foo.bar"' },
  { name: 'pathcase', category: 'string', syntax: '{{pathcase str}}', example: '{{pathcase "fooBar"}} → "foo/bar"' },
  { name: 'sentencecase', category: 'string', syntax: '{{sentencecase str}}', example: '{{sentencecase "HELLO WORLD"}} → "Hello world"' },
  { name: 'slugify', category: 'string', syntax: '{{slugify str}}', example: '{{slugify "Hello World!"}} → "hello-world"' },
  { name: 'trim', category: 'string', syntax: '{{trim str}}', example: '{{trim "  hello  "}} → "hello"' },
  { name: 'trimLeft', category: 'string', syntax: '{{trimLeft str}}' },
  { name: 'trimRight', category: 'string', syntax: '{{trimRight str}}' },
  { name: 'replace', category: 'string', syntax: '{{replace str search replacement}}', example: '{{replace "hello" "l" "L"}} → "heLLo"' },
  { name: 'split', category: 'string', syntax: '{{split str separator}}', example: '{{split "a,b,c" ","}} → ["a","b","c"]' },
  { name: 'truncate', category: 'string', syntax: '{{truncate str length suffix}}', example: '{{truncate "hello world" 5 "..."}} → "hello..."' },
  { name: 'ellipsis', category: 'string', syntax: '{{ellipsis str length}}', example: '{{ellipsis "hello world" 5}} → "hello…"' },
  { name: 'append', category: 'string', syntax: '{{append str suffix}}', example: '{{append "hello" " world"}} → "hello world"' },
  { name: 'prepend', category: 'string', syntax: '{{prepend str prefix}}', example: '{{prepend "world" "hello "}} → "hello world"' },
  { name: 'reverse', category: 'string', syntax: '{{reverse value}}', example: '{{reverse "hello"}} → "olleh"' },
  { name: 'startsWith', category: 'string', syntax: '{{#startsWith str prefix}}...{{/startsWith}}' },
  { name: 'endsWith', category: 'string', syntax: '{{#endsWith str suffix}}...{{/endsWith}}' },
  { name: 'contains', category: 'string', syntax: '{{#contains str substring}}...{{/contains}}' },
  { name: 'padStart', category: 'string', syntax: '{{padStart str length char}}', example: '{{padStart "5" 3 "0"}} → "005"' },
  { name: 'padEnd', category: 'string', syntax: '{{padEnd str length char}}', example: '{{padEnd "5" 3 "0"}} → "500"' },
  { name: 'repeat', category: 'string', syntax: '{{repeat str count}}', example: '{{repeat "ab" 3}} → "ababab"' },
  { name: 'substring', category: 'string', syntax: '{{substring str start end}}', example: '{{substring "hello" 1 3}} → "el"' },
  { name: 'indexOf', category: 'string', syntax: '{{indexOf str search}}', example: '{{indexOf "hello" "l"}} → 2' },
  { name: 'count', category: 'string', syntax: '{{count str substring}}', example: '{{count "hello" "l"}} → 2' },
  { name: 'newLineToBr', category: 'string', syntax: '{{newLineToBr str}}' },
  { name: 'stripTags', category: 'string', syntax: '{{stripTags str}}', example: '{{stripTags "<p>hello</p>"}} → "hello"' },

  // ============================================================================
  // Math Helpers
  // ============================================================================
  { name: 'add', category: 'math', syntax: '{{add a b}}', example: '{{add 1 2}} → 3' },
  { name: 'subtract', category: 'math', syntax: '{{subtract a b}}', example: '{{subtract 5 2}} → 3' },
  { name: 'multiply', category: 'math', syntax: '{{multiply a b}}', example: '{{multiply 2 3}} → 6' },
  { name: 'divide', category: 'math', syntax: '{{divide a b}}', example: '{{divide 6 2}} → 3' },
  { name: 'modulo', category: 'math', syntax: '{{modulo a b}}', example: '{{modulo 5 2}} → 1' },
  { name: 'abs', category: 'math', syntax: '{{abs num}}', example: '{{abs -5}} → 5' },
  { name: 'ceil', category: 'math', syntax: '{{ceil num}}', example: '{{ceil 4.2}} → 5' },
  { name: 'floor', category: 'math', syntax: '{{floor num}}', example: '{{floor 4.8}} → 4' },
  { name: 'round', category: 'math', syntax: '{{round num}}', example: '{{round 4.5}} → 5' },
  { name: 'min', category: 'math', syntax: '{{min a b c ...}}', example: '{{min 1 2 3}} → 1' },
  { name: 'max', category: 'math', syntax: '{{max a b c ...}}', example: '{{max 1 2 3}} → 3' },
  { name: 'pow', category: 'math', syntax: '{{pow base exponent}}', example: '{{pow 2 3}} → 8' },
  { name: 'sqrt', category: 'math', syntax: '{{sqrt num}}', example: '{{sqrt 16}} → 4' },
  { name: 'random', category: 'math', syntax: '{{random min max}}', example: '{{random 1 10}} → 7' },
  { name: 'sum', category: 'math', syntax: '{{sum array}}', example: '{{sum [1,2,3]}} → 6' },
  { name: 'avg', category: 'math', syntax: '{{avg array}}', example: '{{avg [1,2,3]}} → 2' },
  { name: 'toFixed', category: 'math', syntax: '{{toFixed num decimals}}', example: '{{toFixed 3.14159 2}} → "3.14"' },
  { name: 'toInt', category: 'math', syntax: '{{toInt num}}', example: '{{toInt "42"}} → 42' },
  { name: 'toFloat', category: 'math', syntax: '{{toFloat num}}', example: '{{toFloat "3.14"}} → 3.14' },

  // ============================================================================
  // Array Helpers
  // ============================================================================
  { name: 'first', category: 'array', syntax: '{{first array n}}', example: '{{first [1,2,3] 2}} → [1,2]' },
  { name: 'last', category: 'array', syntax: '{{last array n}}', example: '{{last [1,2,3] 2}} → [2,3]' },
  { name: 'after', category: 'array', syntax: '{{after array n}}', example: '{{after [1,2,3] 1}} → [2,3]' },
  { name: 'before', category: 'array', syntax: '{{before array n}}', example: '{{before [1,2,3] 2}} → [1,2]' },
  { name: 'slice', category: 'array', syntax: '{{slice array start end}}', example: '{{slice [1,2,3,4] 1 3}} → [2,3]' },
  { name: 'length', category: 'array', syntax: '{{length value}}', example: '{{length [1,2,3]}} → 3' },
  { name: 'join', category: 'array', syntax: '{{join array separator}}', example: '{{join [1,2,3] "-"}} → "1-2-3"' },
  { name: 'sort', category: 'array', syntax: '{{sort array}}', example: '{{sort [3,1,2]}} → [1,2,3]' },
  { name: 'unique', category: 'array', syntax: '{{unique array}}', example: '{{unique [1,1,2]}} → [1,2]' },
  { name: 'concat', category: 'array', syntax: '{{concat array1 array2 ...}}', example: '{{concat [1] [2] [3]}} → [1,2,3]' },
  { name: 'flatten', category: 'array', syntax: '{{flatten array}}', example: '{{flatten [[1],[2,3]]}} → [1,2,3]' },
  { name: 'pluck', category: 'array', syntax: '{{pluck array property}}', example: '{{pluck users "name"}} → ["Alice","Bob"]' },
  { name: 'itemAt', category: 'array', syntax: '{{itemAt array index}}', example: '{{itemAt [1,2,3] 1}} → 2' },
  { name: 'inArray', category: 'array', syntax: '{{#inArray array value}}...{{/inArray}}' },
  { name: 'isArray', category: 'array', syntax: '{{isArray value}}' },
  { name: 'isEmpty', category: 'array', syntax: '{{#isEmpty value}}...{{/isEmpty}}' },
  { name: 'some', category: 'array', syntax: '{{#some array prop value}}...{{/some}}' },
  { name: 'every', category: 'array', syntax: '{{#every array prop value}}...{{/every}}' },

  // ============================================================================
  // Object Helpers
  // ============================================================================
  { name: 'JSONstringify', category: 'object', syntax: '{{JSONstringify obj}}', example: '{{JSONstringify user}} → {"name":"Alice"}' },
  { name: 'JSONparse', category: 'object', syntax: '{{JSONparse str}}' },
  { name: 'get', category: 'object', syntax: '{{get obj "path.to.prop"}}', example: '{{get user "address.city"}} → "Paris"' },
  { name: 'keys', category: 'object', syntax: '{{keys obj}}', example: '{{keys {a:1,b:2}}} → ["a","b"]' },
  { name: 'values', category: 'object', syntax: '{{values obj}}', example: '{{values {a:1,b:2}}} → [1,2]' },
  { name: 'entries', category: 'object', syntax: '{{entries obj}}' },
  { name: 'hasOwn', category: 'object', syntax: '{{#hasOwn obj "key"}}...{{/hasOwn}}' },
  { name: 'pick', category: 'object', syntax: '{{pick obj "key1" "key2"}}', example: '{{pick user "name" "age"}}' },
  { name: 'omit', category: 'object', syntax: '{{omit obj "key1" "key2"}}', example: '{{omit user "password"}}' },
  { name: 'merge', category: 'object', syntax: '{{merge obj1 obj2 ...}}' },
  { name: 'isObject', category: 'object', syntax: '{{isObject value}}' },
  { name: 'typeOf', category: 'object', syntax: '{{typeOf value}}', example: '{{typeOf []}} → "array"' },

  // ============================================================================
  // URL Helpers
  // ============================================================================
  { name: 'encodeURI', category: 'url', syntax: '{{encodeURI str}}', example: '{{encodeURI "hello world"}} → "hello%20world"' },
  { name: 'decodeURI', category: 'url', syntax: '{{decodeURI str}}', example: '{{decodeURI "hello%20world"}} → "hello world"' },
  { name: 'urlParse', category: 'url', syntax: '{{urlParse url}}', example: 'Returns {href, origin, protocol, host, hostname, port, pathname, search, hash}' },
  { name: 'stripQuerystring', category: 'url', syntax: '{{stripQuerystring url}}', example: '{{stripQuerystring "http://a.com?x=1"}} → "http://a.com"' },
  { name: 'stripProtocol', category: 'url', syntax: '{{stripProtocol url}}', example: '{{stripProtocol "https://a.com"}} → "a.com"' },

  // ============================================================================
  // Date Helpers
  // ============================================================================
  { name: 'now', category: 'date', syntax: '{{now}}', example: '{{now}} → "2024-01-15T10:30:00.000Z"' },
  { name: 'timestamp', category: 'date', syntax: '{{timestamp}}', example: '{{timestamp}} → 1705315800000' },
  { name: 'year', category: 'date', syntax: '{{year}}', example: '{{year}} → 2024' },
  { name: 'formatDate', category: 'date', syntax: '{{formatDate date "YYYY-MM-DD"}}', example: 'Patterns: YYYY, MM, DD, HH, mm, ss' },

  // ============================================================================
  // Regex Helpers
  // ============================================================================
  { name: 'match', category: 'regex', syntax: '{{match str pattern}}', example: '{{match "abc123" "[0-9]+"}} → ["123"]' },
  { name: 'test', category: 'regex', syntax: '{{#test str pattern}}...{{/test}}' },

  // ============================================================================
  // Misc Helpers
  // ============================================================================
  { name: 'coalesce', category: 'misc', syntax: '{{coalesce a b c ...}}', example: '{{coalesce null "default"}} → "default"' },
  { name: 'uuid', category: 'misc', syntax: '{{uuid}}', example: '{{uuid}} → "550e8400-e29b-41d4-a716-446655440000"' },
  { name: 'noop', category: 'misc', syntax: '{{#noop}}...{{/noop}}' },
  { name: 'raw', category: 'misc', syntax: '{{{{raw}}}}...{{{{/raw}}}}' },
  { name: 'times', category: 'misc', syntax: '{{#times n}}...{{/times}}', example: '{{#times 3}}x{{/times}} → "xxx"' },
  { name: 'range', category: 'misc', syntax: '{{range start end step}}', example: '{{range 0 5 1}} → [0,1,2,3,4]' }
]

/**
 * Helper definition with translated description for use in UI components
 */
export interface TranslatedHelperDefinition {
  name: string
  category: string
  description: string
  syntax: string
  example?: string
}
