# WCO Test App

Application Electron simple utilisant les Window Control Overlays (WCO).

## Fonctionnalités

- Fenêtre sans bordures avec Window Control Overlays
- Affichage d'un texte "Hello World" centré
- Interface moderne avec dégradé de couleurs
- Contrôles de fenêtre intégrés (minimiser, maximiser, fermer)

## Installation

```bash
cd wco_test
npm install
```

## Lancement

```bash
# Mode normal
npm start

# Mode développement (avec DevTools)
npm run dev
```

## Structure

- `main.js` - Processus principal Electron avec configuration WCO
- `index.html` - Interface utilisateur avec le texte "Hello World"
- `package.json` - Configuration du projet et dépendances
