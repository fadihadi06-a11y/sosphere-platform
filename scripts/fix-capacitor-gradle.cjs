/**
 * Patches ALL Capacitor & plugin build.gradle files for Gradle 9 / AGP 9 compatibility.
 * Fixes: proguard-android.txt -> proguard-android-optimize.txt
 * Fixes: AGP 8.x -> 9.1.0
 * Fixes: jcenter() -> mavenCentral() (removed in Gradle 9)
 */
const fs = require('fs');
const path = require('path');

const nodeModules = path.join(__dirname, '..', 'node_modules');

function findGradleFiles(dir) {
  const results = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory() && entry.name !== '.git') {
        results.push(...findGradleFiles(fullPath));
      } else if (entry.name === 'build.gradle') {
        results.push(fullPath);
      }
    }
  } catch (e) { /* skip unreadable dirs */ }
  return results;
}

// Scan ALL plugin directories that may have Gradle files.
// - Known scoped organizations (@capacitor, @codetrix-studio, @capawesome, @aparajita)
// - Any other scoped org whose sub-packages include "capacitor" in the name
// - Any non-scoped package whose name starts with "capacitor-"
//
// This is broad on purpose: Capacitor plugins across the ecosystem commonly
// ship outdated build.gradle files pointing at proguard-android.txt (deprecated)
// or jcenter() (sunset). Missing even one causes the whole APK build to fail
// with a cryptic DSL evaluation error — which happened for @aparajita on
// 2026-04-23 when the biometric plugin was added.
const dirsToScan = [
  path.join(nodeModules, '@capacitor'),
  path.join(nodeModules, '@codetrix-studio'),
  path.join(nodeModules, '@capawesome'),
  path.join(nodeModules, '@aparajita'),
];

// Discover additional plugins automatically.
try {
  const topLevel = fs.readdirSync(nodeModules, { withFileTypes: true });
  for (const entry of topLevel) {
    if (!entry.isDirectory()) continue;
    // Non-scoped capacitor-* plugins (e.g. capacitor-call-number)
    if (entry.name.startsWith('capacitor-')) {
      dirsToScan.push(path.join(nodeModules, entry.name));
      continue;
    }
    // Other scoped orgs — check each sub-package for "capacitor" in its name
    if (entry.name.startsWith('@')) {
      try {
        const scopePath = path.join(nodeModules, entry.name);
        const subs = fs.readdirSync(scopePath, { withFileTypes: true });
        for (const sub of subs) {
          if (sub.isDirectory() && sub.name.toLowerCase().includes('capacitor')) {
            // Whole scope will be scanned anyway — just record the scope once
            if (!dirsToScan.includes(scopePath)) dirsToScan.push(scopePath);
            break;
          }
        }
      } catch { /* unreadable scope — skip */ }
    }
  }
} catch (e) { /* node_modules missing — nothing to do */ }

let allGradleFiles = [];
for (const dir of dirsToScan) {
  if (fs.existsSync(dir)) {
    allGradleFiles.push(...findGradleFiles(dir));
  }
}

if (allGradleFiles.length === 0) {
  console.log('[fix-gradle] No plugin gradle files found, skipping.');
  process.exit(0);
}

let totalPatched = 0;

for (const filePath of allGradleFiles) {
  let content = fs.readFileSync(filePath, 'utf8');
  let patched = false;

  // Fix 1: proguard-android.txt -> proguard-android-optimize.txt
  if (content.includes("proguard-android.txt")) {
    content = content.replace(
      /getDefaultProguardFile\('proguard-android\.txt'\)/g,
      "getDefaultProguardFile('proguard-android-optimize.txt')"
    );
    patched = true;
  }

  // Fix 2: jcenter() -> mavenCentral()
  if (content.includes('jcenter()')) {
    content = content.replace(/jcenter\(\)/g, 'mavenCentral()');
    patched = true;
  }

  // Fix 3: AGP 8.x -> 9.1.0
  const agpMatch = content.match(/com\.android\.tools\.build:gradle:8\.\d+\.\d+/);
  if (agpMatch) {
    content = content.replace(agpMatch[0], 'com.android.tools.build:gradle:9.1.0');
    patched = true;
  }

  if (patched) {
    fs.writeFileSync(filePath, content, 'utf8');
    const rel = path.relative(nodeModules, filePath);
    console.log('[fix-gradle] Patched:', rel);
    totalPatched++;
  }
}

console.log('[fix-gradle] Done. ' + totalPatched + ' file(s) patched.');
