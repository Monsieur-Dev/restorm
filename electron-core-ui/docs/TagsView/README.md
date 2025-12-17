# TagsView

`TagsView` est un composant d’affichage et d’édition de tags (liste de chaînes) utilisé pour annoter des entités (dossiers, requêtes HTTP, etc.).

## Props

- `tags: string[]` : liste actuelle des tags.
- `onChange?: (tags: string[]) => void` : callback appelé à chaque modification (ajout, renommage, suppression).
- `className?: string` : classe CSS additionnelle.
- `style?: React.CSSProperties` : styles inline optionnels.

## Comportement

- Affiche les tags sur une seule ligne, avec retour à la ligne automatique si nécessaire.
- Clic sur un tag : passe en mode édition inline (comportement proche du dernier élément de `Breadcrumb`).
- Clic droit sur un tag : ouvre un menu contextuel permettant de supprimer le tag.
- Bouton `+` (small / secondary) en fin de ligne pour ajouter un nouveau tag.
- Styles basés sur les variables de thème :
  - `--tag-background`, `--tag-background-hover`, `--tag-foreground` (avec fallback vers `--*`).

## Exemple d’utilisation

```tsx
import { TagsView } from 'electron-core-ui/renderer'

<TagsView
  tags={['user', 'admin']}
  onChange={(next) => setTags(next)}
/>
```