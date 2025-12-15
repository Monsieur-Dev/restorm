# Release Workflow Documentation

## Vue d'ensemble

Ce document explique comment créer des releases pour restorm en utilisant les workflows GitHub Actions.

## Workflows disponibles

### 1. Manual Release (Recommandé) ⭐

**Fichier**: `.github/workflows/manual-release.yml`

**Usage**: Créer une release complète automatiquement

**Comment l'utiliser**:
1. Va sur l'onglet "Actions" du repo GitHub
2. Sélectionne "Manual Release" dans la liste des workflows
3. Clique sur "Run workflow"
4. Choisis le type de version à incrémenter:
   - `patch`: 0.1.0 → 0.1.1 (corrections de bugs)
   - `minor`: 0.1.0 → 0.2.0 (nouvelles fonctionnalités)
   - `major`: 0.1.0 → 1.0.0 (breaking changes)
5. Clique sur "Run workflow"

**Ce qui se passe**:
1. ✅ Bump automatique de la version dans `package.json`
2. ✅ Commit et push du changement de version
3. ✅ Création du tag (ex: `v0.1.11`)
4. ✅ Création de la release GitHub avec notes de version
5. ✅ Build automatique pour Linux, Windows et macOS
6. ✅ Upload des artifacts (.deb, .rpm, .exe, .dmg, .zip) sur la release

**Temps estimé**: 10-15 minutes pour les 3 plateformes

---

### 2. Release Production

**Fichier**: `.github/workflows/release.yml`

**Usage**: Build et release automatiques quand un tag est créé manuellement

**Comment l'utiliser**:
```bash
# En ligne de commande
npm version patch  # ou minor, ou major
git push
git push --tags
```

**Ce qui se passe**:
- Le push du tag déclenche automatiquement le workflow
- Build pour Linux, Windows et macOS
- Upload des artifacts sur la release

**Cas d'usage**:
- Si tu préfères gérer les versions en ligne de commande
- Backup si le workflow Manual Release échoue
- Le job `build-on-merge` continue de vérifier que le code compile après chaque merge sur main

---

### 3. Auto Version Bump (Déprécié)

**Fichier**: `.github/workflows/auto-version.yml`

**Statut**: ⚠️ Désactivé par défaut

**Pourquoi**: GitHub Actions ne déclenche pas d'autres workflows quand un tag est créé par `GITHUB_TOKEN`, donc la release ne se faisait pas automatiquement.

**Usage actuel**: Uniquement disponible en workflow_dispatch pour bumper la version manuellement (sans créer de release).

---

## Workflow recommandé pour les releases

### Pour une release complète (recommandé) 🚀

1. Merge ta branche sur `main`
2. Va sur GitHub Actions → "Manual Release"
3. Choisis le type de version
4. Lance le workflow
5. ✅ Done ! La release sera créée automatiquement avec tous les builds

### Pour tester un build sans release

1. Merge sur `main`
2. Le job `build-on-merge` dans `release.yml` va automatiquement:
   - Vérifier que le code compile
   - Builder les packages Linux (.deb, .rpm)
   - Uploader les artifacts (disponibles 30 jours)

### Pour une preview release

Utilise le workflow `preview-release.yml` (workflow_dispatch):
1. Va sur GitHub Actions → "Preview Release (Manual)"
2. Lance le workflow
3. Les artifacts seront disponibles pendant 90 jours

---

## Structure des artifacts

### Linux
- `restorm_X.X.X_amd64.deb` - Package Debian/Ubuntu
- `restorm-X.X.X.x86_64.rpm` - Package RedHat/Fedora

### Windows
- `restorm-setup-X.X.X.exe` - Installeur Windows

### macOS
- `restorm-X.X.X.dmg` - Image disque macOS
- `restorm-X.X.X-mac.zip` - Archive macOS

---

## FAQ

### Pourquoi mes releases ne se faisaient pas automatiquement après merge ?

C'est une limitation de sécurité GitHub : quand un workflow crée un tag avec `GITHUB_TOKEN`, ça ne déclenche pas d'autres workflows. C'est pourquoi le workflow `Manual Release` a été créé pour tout faire dans un seul workflow.

### Puis-je encore créer des releases en ligne de commande ?

Oui ! Si tu crées et push un tag manuellement, le workflow `release.yml` se déclenchera automatiquement.

### Que se passe-t-il si un build échoue sur une plateforme ?

Le workflow est configuré avec `fail-fast: false`, donc les autres plateformes continueront de builder même si une échoue.

### Comment voir les logs d'un build ?

Va sur l'onglet "Actions" de ton repo GitHub, clique sur le workflow en cours, puis sur le job qui t'intéresse.

---

## Troubleshooting

### Erreur "GH_TOKEN is not set"

✅ Résolu ! Le token est maintenant automatiquement fourni via `${{ secrets.GITHUB_TOKEN }}`.

### Le workflow ne se déclenche pas

Vérifie que tu as les permissions nécessaires sur le repo (write access).

### Les artifacts ne sont pas uploadés

Vérifie les logs du job de build pour voir si `electron-builder` a bien créé les packages dans `dist-electron/`.
