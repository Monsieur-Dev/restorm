const fs = require('fs')
const path = require('path')

function copyRecursiveSync(src, dest) {
  const exists = fs.existsSync(src)
  const stats = exists && fs.statSync(src)
  const isDirectory = exists && stats.isDirectory()
  
  if (isDirectory) {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true })
    }
    fs.readdirSync(src).forEach((childItemName) => {
      copyRecursiveSync(
        path.join(src, childItemName),
        path.join(dest, childItemName)
      )
    })
  } else {
    if (exists) {
      const destDir = path.dirname(dest)
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true })
      }
      fs.copyFileSync(src, dest)
    }
  }
}

function copyIfExists(src, dest) {
  if (fs.existsSync(src)) {
    copyRecursiveSync(src, dest)
    return true
  }
  return false
}

// Clean dist directory
const distDir = path.join(__dirname, '..', 'dist')
if (fs.existsSync(distDir)) {
  fs.rmSync(distDir, { recursive: true, force: true })
}

// Create dist/src structure
const distSrcDir = path.join(distDir, 'src')
fs.mkdirSync(distSrcDir, { recursive: true })

// Copy main
copyIfExists(
  path.join(__dirname, '..', 'dist-main', 'src', 'main'),
  path.join(distSrcDir, 'main')
)

// Copy preload
copyIfExists(
  path.join(__dirname, '..', 'dist-main', 'src', 'preload'),
  path.join(distSrcDir, 'preload')
)

// Copy renderer
copyIfExists(
  path.join(__dirname, '..', 'dist-renderer', 'src', 'renderer'),
  path.join(distSrcDir, 'renderer')
)

// Copy errors (shared by both main and renderer)
copyIfExists(
  path.join(__dirname, '..', 'dist-main', 'src', 'errors'),
  path.join(distSrcDir, 'errors')
)

// Copy shared (generic cross-layer types consumed by both main and renderer)
copyIfExists(
  path.join(__dirname, '..', 'dist-main', 'src', 'shared'),
  path.join(distSrcDir, 'shared')
)

// Copy types (try from dist-main first, then dist-renderer)
if (!copyIfExists(
  path.join(__dirname, '..', 'dist-main', 'src', 'types'),
  path.join(distSrcDir, 'types')
)) {
  if (!copyIfExists(
    path.join(__dirname, '..', 'dist-renderer', 'src', 'types'),
    path.join(distSrcDir, 'types')
  )) {
    // Try from dist-renderer/types (top-level)
    copyIfExists(
      path.join(__dirname, '..', 'dist-renderer', 'types'),
      path.join(distSrcDir, 'types')
    )
  }
}

// Copy renderer assets
copyIfExists(
  path.join(__dirname, '..', 'src', 'renderer', 'assets'),
  path.join(distSrcDir, 'renderer', 'assets')
)

// Copy CSS files from components (recursively)
function copyCssFilesRecursive(srcDir, destDir) {
  if (!fs.existsSync(srcDir)) return
  
  const entries = fs.readdirSync(srcDir, { withFileTypes: true })
  
  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name)
    const destPath = path.join(destDir, entry.name)
    
    if (entry.isDirectory()) {
      if (!fs.existsSync(destPath)) {
        fs.mkdirSync(destPath, { recursive: true })
      }
      copyCssFilesRecursive(srcPath, destPath)
    } else if (entry.name.endsWith('.css')) {
      const destDirPath = path.dirname(destPath)
      if (!fs.existsSync(destDirPath)) {
        fs.mkdirSync(destDirPath, { recursive: true })
      }
      fs.copyFileSync(srcPath, destPath)
    }
  }
}

const componentsDir = path.join(__dirname, '..', 'src', 'renderer', 'components')
const destComponentsDir = path.join(distSrcDir, 'renderer', 'components')
if (fs.existsSync(componentsDir)) {
  copyCssFilesRecursive(componentsDir, destComponentsDir)
}

// Some renderer utilities ship CSS alongside their .ts (e.g. themeReveal),
// imported from inside the .ts via `import './foo.css'`. Mirror them so
// consumers resolving through `dist/.../utils/*` find the matching file.
const utilsDir = path.join(__dirname, '..', 'src', 'renderer', 'utils')
const destUtilsDir = path.join(distSrcDir, 'renderer', 'utils')
if (fs.existsSync(utilsDir)) {
  copyCssFilesRecursive(utilsDir, destUtilsDir)
}

// Effects (e.g. borderBeam) also import CSS directly; mirror them alongside
// the compiled JS so the import resolves through `dist/.../effects/*`.
const effectsDir = path.join(__dirname, '..', 'src', 'renderer', 'effects')
const destEffectsDir = path.join(distSrcDir, 'renderer', 'effects')
if (fs.existsSync(effectsDir)) {
  copyCssFilesRecursive(effectsDir, destEffectsDir)
}

// Copy resources directory (themes, etc.)
copyIfExists(
  path.join(__dirname, '..', 'resources'),
  path.join(distDir, 'resources')
)

console.log('✅ Dist merge completed successfully')
