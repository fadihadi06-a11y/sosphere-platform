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

// Scan ALL plugin directories that may have Gradle files
const dirsToScan = [
  path.join(nodeModules, '@capacitor'),
  path.join(nodeModules, '@codetrix-studio'),
  path.join(nodeModules, '@capawesome'),
];

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
