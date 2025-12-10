# MarkdownEditor

`MarkdownEditor` est un composant d’édition Markdown basé sur Milkdown (preset Crepe) destiné à l’édition riche de documentation ou de notes.

## Props

- `initialValue?: string` : contenu Markdown initial affiché dans l’éditeur.

## Comportement

- Utilise Milkdown/Crepe pour fournir une expérience d’édition WYSIWYG.
- S’adapte automatiquement au thème courant via l’attribut `data-theme` (`dark`, `hcDark`, etc.).
- Occupe toute la surface disponible dans son conteneur (100% largeur/hauteur).

## Exemple d’utilisation

```tsx
import { MarkdownEditor } from 'electron-core-ui/renderer'

<MarkdownEditor initialValue={"# My doc"} />
```