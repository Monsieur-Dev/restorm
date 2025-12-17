/**
 * Contrast Validation Script
 * 
 * Validates that foreground/background color pairs in all themes
 * meet WCAG contrast requirements.
 * 
 * Usage: node scripts/validate-contrast.js
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

// ============================================================================
// CONTRAST PAIR DEFINITIONS
// ============================================================================

/**
 * Define all foreground/background pairs that must meet contrast requirements.
 * minRatio: 4.5 for normal text (WCAG AA), 3.0 for large text/UI components
 */
const CONTRAST_PAIRS = [
  // Editor
  { fg: 'editor.foreground', bg: 'editor.background', minRatio: 4.5, name: 'Editor text' },
  { fg: 'foreground', bg: 'editor.background', minRatio: 4.5, name: 'Generic foreground' },
  
  // Input
  { fg: 'input.foreground', bg: 'input.background', minRatio: 4.5, name: 'Input text' },
  { fg: 'input.placeholderForeground', bg: 'input.background', minRatio: 3.0, name: 'Input placeholder' },
  
  // Button
  { fg: 'button.foreground', bg: 'button.background', minRatio: 4.5, name: 'Button text' },
  { fg: 'button.secondaryForeground', bg: 'button.secondaryBackground', minRatio: 4.5, name: 'Secondary button text' },
  
  // List
  { fg: 'list.foreground', bg: 'editor.background', minRatio: 4.5, name: 'List text' },
  { fg: 'list.activeSelectionForeground', bg: 'list.activeSelectionBackground', minRatio: 4.5, name: 'List selected text' },
  { fg: 'list.hoverForeground', bg: 'list.hoverBackground', minRatio: 4.5, name: 'List hover text' },
  { fg: 'list.focusForeground', bg: 'list.focusBackground', minRatio: 4.5, name: 'List focus text' },
  
  // Dropdown
  { fg: 'dropdown.foreground', bg: 'dropdown.background', minRatio: 4.5, name: 'Dropdown text' },
  
  // Menu
  { fg: 'menu.foreground', bg: 'menu.background', minRatio: 4.5, name: 'Menu text' },
  
  // Tab
  { fg: 'tab.activeForeground', bg: 'tab.activeBackground', minRatio: 4.5, name: 'Active tab text' },
  { fg: 'tab.inactiveForeground', bg: 'tab.inactiveBackground', minRatio: 3.0, name: 'Inactive tab text' },
  
  // Status bar
  { fg: 'statusBar.foreground', bg: 'statusBar.background', minRatio: 4.5, name: 'Status bar text' },
  
  // Title bar
  { fg: 'titleBar.activeForeground', bg: 'titleBar.activeBackground', minRatio: 4.5, name: 'Title bar text' },
  
  // Side bar
  { fg: 'sideBarTitle.foreground', bg: 'sideBar.background', minRatio: 4.5, name: 'Side bar title' },
  
  // Panel
  { fg: 'panelTitle.activeForeground', bg: 'panel.background', minRatio: 4.5, name: 'Panel title' },
  
  // Activity bar
  { fg: 'activityBar.foreground', bg: 'activityBar.background', minRatio: 3.0, name: 'Activity bar icons' },
  
  // Widget
  { fg: 'editorHoverWidget.foreground', bg: 'editorHoverWidget.background', minRatio: 4.5, name: 'Hover widget text' },
  
  // Quick input
  { fg: 'quickInput.foreground', bg: 'quickInput.background', minRatio: 4.5, name: 'Quick input text' },
  
  // Badge
  { fg: 'badge.foreground', bg: 'badge.background', minRatio: 4.5, name: 'Badge text' },
  
  // Tag
  { fg: 'tag.foreground', bg: 'tag.background', minRatio: 4.5, name: 'Tag text' },
  
  // Checkbox
  { fg: 'checkbox.foreground', bg: 'checkbox.background', minRatio: 4.5, name: 'Checkbox text' },
  
  // Description (secondary text - lower requirement)
  { fg: 'descriptionForeground', bg: 'editor.background', minRatio: 3.0, name: 'Description text' },
  
  // Line numbers
  { fg: 'editorLineNumber.foreground', bg: 'editor.background', minRatio: 3.0, name: 'Line numbers' },
];

// ============================================================================
// COLOR UTILITIES
// ============================================================================

/**
 * Parse a color string to RGB values
 * Supports: #RGB, #RRGGBB, #RRGGBBAA, rgb(), rgba()
 */
function parseColor(color) {
  if (!color) return null;
  
  color = color.trim();
  
  // Handle hex colors
  if (color.startsWith('#')) {
    let hex = color.slice(1);
    
    // Expand shorthand (#RGB -> #RRGGBB)
    if (hex.length === 3) {
      hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    }
    
    // Handle #RRGGBBAA
    if (hex.length === 8) {
      hex = hex.slice(0, 6);
    }
    
    if (hex.length !== 6) return null;
    
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    
    if (isNaN(r) || isNaN(g) || isNaN(b)) return null;
    
    return { r, g, b };
  }
  
  // Handle rgb/rgba
  const rgbMatch = color.match(/rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgbMatch) {
    return {
      r: parseInt(rgbMatch[1], 10),
      g: parseInt(rgbMatch[2], 10),
      b: parseInt(rgbMatch[3], 10)
    };
  }
  
  return null;
}

/**
 * Calculate relative luminance of a color
 * Based on WCAG 2.1 formula
 */
function getLuminance(rgb) {
  const [r, g, b] = [rgb.r, rgb.g, rgb.b].map(c => {
    c = c / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Calculate contrast ratio between two colors
 * Returns a value between 1 and 21
 */
function getContrastRatio(color1, color2) {
  const rgb1 = parseColor(color1);
  const rgb2 = parseColor(color2);
  
  if (!rgb1 || !rgb2) return null;
  
  const l1 = getLuminance(rgb1);
  const l2 = getLuminance(rgb2);
  
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Format contrast ratio for display
 */
function formatRatio(ratio) {
  return ratio ? ratio.toFixed(2) + ':1' : 'N/A';
}

// ============================================================================
// THEME LOADING
// ============================================================================

/**
 * Load and merge theme colors
 */
function loadTheme(themesPath, themeType, themeName) {
  const colors = {};
  
  // 1. Load type base (dark/_base.yaml, light/_base.yaml, etc.)
  const typeBasePath = path.join(themesPath, themeType, '_base.yaml');
  if (fs.existsSync(typeBasePath)) {
    const content = fs.readFileSync(typeBasePath, 'utf-8');
    const data = yaml.load(content);
    if (data?.colors) {
      for (const color of data.colors) {
        colors[color.id] = color.value;
      }
    }
  }
  
  // 2. Load specific theme if provided
  if (themeName && themeName !== '_base') {
    const themePath = path.join(themesPath, themeType, `${themeName}.yaml`);
    if (fs.existsSync(themePath)) {
      const content = fs.readFileSync(themePath, 'utf-8');
      const data = yaml.load(content);
      if (data?.colors) {
        for (const [key, value] of Object.entries(data.colors)) {
          colors[key] = value;
        }
      }
    }
  }
  
  return colors;
}

/**
 * Discover all themes from index.json
 */
function discoverThemes(themesPath) {
  const indexPath = path.join(themesPath, 'index.json');
  if (!fs.existsSync(indexPath)) {
    console.error('Theme index not found:', indexPath);
    return [];
  }
  
  const index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
  return index.themes || [];
}

// ============================================================================
// VALIDATION
// ============================================================================

/**
 * Validate contrast for a single theme
 */
function validateTheme(themesPath, themeEntry) {
  const themeType = themeEntry.type;
  const themeName = path.basename(themeEntry.file, '.yaml');
  const colors = loadTheme(themesPath, themeType, themeName);
  
  const violations = [];
  const warnings = [];
  const passed = [];
  
  for (const pair of CONTRAST_PAIRS) {
    const fgColor = colors[pair.fg];
    const bgColor = colors[pair.bg];
    
    // Skip if colors not defined (will inherit from defaults)
    if (!fgColor && !bgColor) {
      continue;
    }
    
    // Use fallback for missing colors
    const fg = fgColor || colors['foreground'] || colors['editor.foreground'];
    const bg = bgColor || colors['editor.background'];
    
    if (!fg || !bg) {
      warnings.push({
        pair: pair.name,
        fg: pair.fg,
        bg: pair.bg,
        message: `Missing color definition (fg: ${fgColor ? 'OK' : 'MISSING'}, bg: ${bgColor ? 'OK' : 'MISSING'})`
      });
      continue;
    }
    
    const ratio = getContrastRatio(fg, bg);
    
    if (ratio === null) {
      warnings.push({
        pair: pair.name,
        fg: pair.fg,
        bg: pair.bg,
        message: `Could not parse colors (fg: ${fg}, bg: ${bg})`
      });
      continue;
    }
    
    // Increase requirement for high contrast themes
    let minRatio = pair.minRatio;
    if (themeType === 'hc_dark' || themeType === 'hc_light') {
      minRatio = Math.max(minRatio, 7.0); // WCAG AAA for HC themes
    }
    
    if (ratio < minRatio) {
      violations.push({
        pair: pair.name,
        fg: pair.fg,
        bg: pair.bg,
        fgColor: fg,
        bgColor: bg,
        ratio,
        required: minRatio
      });
    } else {
      passed.push({
        pair: pair.name,
        ratio
      });
    }
  }
  
  return { violations, warnings, passed };
}

// ============================================================================
// MAIN
// ============================================================================

function main() {
  const themesPath = path.join(__dirname, '..', 'resources', 'themes');
  
  console.log('🎨 Contrast Validation Report');
  console.log('='.repeat(60));
  console.log();
  
  const themes = discoverThemes(themesPath);
  
  if (themes.length === 0) {
    console.error('No themes found!');
    process.exit(1);
  }
  
  let totalViolations = 0;
  let totalWarnings = 0;
  let totalPassed = 0;
  
  for (const theme of themes) {
    const result = validateTheme(themesPath, theme);
    
    const hasIssues = result.violations.length > 0 || result.warnings.length > 0;
    
    if (hasIssues) {
      console.log(`\n📋 ${theme.name} (${theme.type})`);
      console.log('-'.repeat(40));
    }
    
    // Report violations
    for (const v of result.violations) {
      totalViolations++;
      console.log(`  ❌ ${v.pair}`);
      console.log(`     ${v.fg}: ${v.fgColor}`);
      console.log(`     ${v.bg}: ${v.bgColor}`);
      console.log(`     Ratio: ${formatRatio(v.ratio)} (required: ${v.required}:1)`);
    }
    
    // Report warnings
    for (const w of result.warnings) {
      totalWarnings++;
      console.log(`  ⚠️  ${w.pair}: ${w.message}`);
    }
    
    totalPassed += result.passed.length;
  }
  
  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 Summary');
  console.log('-'.repeat(40));
  console.log(`  Themes checked: ${themes.length}`);
  console.log(`  Pairs checked:  ${totalPassed + totalViolations}`);
  console.log(`  ✅ Passed:      ${totalPassed}`);
  console.log(`  ❌ Violations:  ${totalViolations}`);
  console.log(`  ⚠️  Warnings:    ${totalWarnings}`);
  console.log();
  
  if (totalViolations > 0) {
    console.log('❌ Contrast validation FAILED');
    console.log('   Fix the violations above to ensure text readability.');
    process.exit(1);
  } else {
    console.log('✅ Contrast validation PASSED');
    process.exit(0);
  }
}

main();
