// Patch @codetrix-studio/capacitor-google-auth for Gradle 9 compatibility
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'node_modules', '@codetrix-studio', 'capacitor-google-auth', 'android', 'build.gradle');

if (fs.existsSync(file)) {
  let content = fs.readFileSync(file, 'utf8');
  content = content.replace(/jcenter\(\)/g, 'mavenCentral()');
  content = content.replace("proguard-android.txt", "proguard-android-optimize.txt");
  fs.writeFileSync(file, content);
  console.log('[patch] Fixed capacitor-google-auth build.gradle for Gradle 9');
}
