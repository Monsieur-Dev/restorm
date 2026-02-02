# MarkdownEditor

`MarkdownEditor` est un composant d’édition Markdown basé sur Milkdown (preset Crepe) destiné à l’édition riche de documentation ou de notes.

## Props

- `initialValue?: string` : contenu Markdown initial affiché dans l’éditeur.
- `data-testid?: string` : test id optionnel appliqué au root.

## Comportement

- Utilise Milkdown/Crepe pour fournir une expérience d’édition WYSIWYG.
- S’adapte automatiquement au thème courant via l’attribut `data-theme` (`dark`, `hcDark`, etc.).
- Occupe toute la surface disponible dans son conteneur (100% largeur/hauteur).

## Exemple d’utilisation

```tsx
import { MarkdownEditor } from 'electron-core-ui/renderer'

<MarkdownEditor initialValue={"# My doc"} />
```

## Testing

Quand `data-testid` est fourni, le composant expose des hooks stables pour les tests E2E.

### data-testid conventions

- Root: `{id}`
- Milkdown root wrapper: `{id}-root`
- Editor (contenteditable): `{id}-editor`

### Stable data attributes (sur le root)

- `data-is-dark`: `true | false`
- `data-initial-length`: number

### Selectors

- `markdownEditorRootSelector(testId)`
- `markdownEditorMilkdownRootSelector(testId)`
- `markdownEditorContentEditableSelector(testId)`

### Playwright-BDD steps

- `Then markdown editor {string} should be visible`
- `Then markdown editor {string} should be dark`
- `When I focus markdown editor {string}`
- `When I type in markdown editor {string} {string}` (typed letter-by-letter)
- `Then markdown editor {string} should contain text {string}`