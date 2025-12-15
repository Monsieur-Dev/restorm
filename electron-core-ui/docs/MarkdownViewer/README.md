# MarkdownViewer

`MarkdownViewer` est un composant de rendu Markdown **lecture seule** avec support de Mermaid.

## Props

- `value: string` : contenu Markdown à afficher.
- `allowMermaid?: boolean` (défaut `true`) : active le rendu des blocs ```mermaid```.
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