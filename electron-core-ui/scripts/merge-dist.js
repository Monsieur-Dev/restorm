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

// Copy CSS files from components
const componentsDir = path.join(__dirname, '..', 'src', 'renderer', 'components')
if (fs.existsSync(componentsDir)) {
  const componentDirs = fs.readdirSync(componentsDir, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name)
  
  for (const componentDir of componentDirs) {
    const srcComponentDir = path.join(componentsDir, componentDir)
    const cssFiles = fs.readdirSync(srcComponentDir)
      .filter(file => file.endsWith('.css'))
    
    if (cssFiles.length > 0) {
      const destComponentDir = path.join(distSrcDir, 'renderer', 'components', componentDir)
      if (!fs.existsSync(destComponentDir)) {
        fs.mkdirSync(destComponentDir, { recursive: true })
      }
      for (const cssFile of cssFiles) {
        fs.copyFileSync(
          path.join(srcComponentDir, cssFile),
          path.join(destComponentDir, cssFile)
        )
      }
    }
  }
}

console.log('✅ Dist merge completed successfully')
