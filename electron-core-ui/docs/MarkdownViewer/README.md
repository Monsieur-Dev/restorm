# MarkdownViewer

`MarkdownViewer` est un composant de rendu Markdown **lecture seule** avec support de Mermaid.

## Props

- `value: string` : contenu Markdown à afficher.
- `allowMermaid?: boolean` (défaut `true`) : active le rendu des blocs ```mermaid```.
- `data-testid?: string` : test id optionnel appliqué au root.
- `className?: string` : classe CSS additionnelle sur le conteneur racine.

## Comportement

- Utilise `react-markdown` + `remark-gfm` pour rendre le Markdown.
- Les blocs de code avec la langue `mermaid` sont convertis en diagrammes via Mermaid.
- Le thème clair/sombre est détecté via `document.documentElement.dataset.theme` et pilote les couleurs Mermaid.
- Les liens HTTP/HTTPS sont ouverts dans le navigateur externe (`window.open`) sans changer le contenu de l’application.

## Exemple d’utilisation

```tsx
import { MarkdownViewer } from 'electron-core-ui/renderer'

<MarkdownViewer value={"# Title\n\n```mermaid\nclassDiagram\n  class User {\n    + id : integer\n  }\n```"} />
```

## Testing

Quand `data-testid` est fourni, le composant expose des hooks stables pour les tests E2E.

### data-testid conventions

- Root: `{id}`
- Code blocks (indexés): `{id}-codeblock-{index}`
- Bouton copy: `{id}-codeblock-{index}-copy`
- Mermaid blocks (indexés): `{id}-mermaid-{index}`
- Liens HTTP(S) (indexés): `{id}-link-{index}`

### Stable data attributes

- Sur le root:\n  - `data-allow-mermaid`: `true | false`\n  - `data-is-dark`: `true | false`\n\n- Sur le bouton copy:\n  - `data-is-copied`: `true | false`\n\n- Sur le bloc mermaid:\n  - `data-is-rendered`: `true | false`\n
### Selectors

- `markdownViewerRootSelector(testId)`
- `markdownViewerCodeBlockSelector(testId, index)`
- `markdownViewerCodeBlockCopySelector(testId, index)`
- `markdownViewerMermaidSelector(testId, index)`
- `markdownViewerLinkSelector(testId, index)`

### Playwright-BDD steps

- `Then markdown viewer {string} should be visible`
- `Then markdown viewer {string} should be dark`
- `Then markdown viewer {string} allow mermaid should be {string}`
- `Then markdown viewer {string} should contain text {string}`
- `When I click markdown viewer {string} code block {int} copy`
- `Then markdown viewer {string} code block {int} copy should be copied`
- `Then markdown viewer {string} mermaid block {int} should be rendered`
- `When I click markdown viewer {string} link {int}`
- `Then a popup should open with url {string}`