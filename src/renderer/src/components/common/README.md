# Common UI Components

Composants réutilisables avec un design VSCode-like cohérent dans toute l'application.

## 🎨 Design System

Tous les composants partagent les mêmes couleurs et styles :

- **Fond** : `#000000` (noir)
- **Bordure** : `#6e6e6e` (gris)
- **Texte** : `#cccccc` (gris clair)
- **Hover** : `#1a1a1a` (noir légèrement plus clair)
- **Focus** : `#007acc` (bleu VSCode)
- **Sélectionné** : `#094771` (bleu foncé)

## 📦 Composants disponibles

### Input

Zone de texte, nombre ou recherche.

```tsx
import { Input } from '@/components/common'

// Text input
<Input
  variant="text"
  placeholder="Enter text..."
  value={text}
  onChange={(e) => setText(e.target.value)}
/>

// Number input
<Input
  variant="number"
  value={number}
  onChange={(e) => setNumber(Number(e.target.value))}
/>

// Search input
<Input
  variant="search"
  placeholder="Search..."
  value={search}
  onChange={(e) => setSearch(e.target.value)}
/>
```

### Checkbox

Case à cocher avec label optionnel.

```tsx
import { Checkbox } from '@/components/common'

<Checkbox
  checked={isChecked}
  onChange={setIsChecked}
  label="Show line numbers"
  id="line-numbers"
/>

// Sans label
<Checkbox
  checked={isEnabled}
  onChange={setIsEnabled}
/>
```

### Select

Liste déroulante personnalisée (dropdown).

```tsx
import { Select } from '@/components/common'

<Select
  value={language}
  options={['en', 'fr', 'de', 'es']}
  onChange={setLanguage}
  placeholder="Select language..."
/>
```

## 🎯 Utilisation directe des classes CSS

Si vous préférez ne pas utiliser les composants React, vous pouvez utiliser directement les classes CSS :

```tsx
// Input field
<input className="input-field input-field--text" />

// Checkbox
<label className="checkbox-wrapper">
  <input type="checkbox" className="checkbox-input" />
  <span className="checkbox-custom" />
  <span className="checkbox-label">Label</span>
</label>

// Select
<div className="select-wrapper">
  <div className="select-trigger">
    <span className="select-value">Value</span>
    <VscChevronDown className="select-icon" />
  </div>
</div>
```

## 📝 Notes

- Tous les styles sont définis dans `Controls.css`
- Les composants sont fully typed avec TypeScript
- Accessibilité : support du focus, keyboard navigation
- Les composants héritent de tous les props HTML standards (via `...props`)

## 🚀 Extensibilité

Pour ajouter de nouveaux composants avec le même style :

1. Créer le composant React dans ce dossier
2. Ajouter les styles dans `Controls.css`
3. Exporter depuis `index.ts`
4. Documenter ici

## Exemple d'utilisation dans l'app

```tsx
import { Input, Checkbox, Select } from '@/components/common'

function MyComponent() {
  const [name, setName] = useState('')
  const [enabled, setEnabled] = useState(false)
  const [theme, setTheme] = useState('dark')

  return (
    <div>
      <Input
        variant="text"
        placeholder="Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      
      <Checkbox
        checked={enabled}
        onChange={setEnabled}
        label="Enable feature"
      />
      
      <Select
        value={theme}
        options={['light', 'dark', 'high-contrast']}
        onChange={setTheme}
      />
    </div>
  )
}
```

