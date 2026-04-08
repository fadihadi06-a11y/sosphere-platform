# Capacitor Setup & Deployment Guide for SOSphere

This guide covers the steps to prepare SOSphere for deployment to iOS App Store and Google Play Store.

## Prerequisites

- Node.js 16+ and npm
- Xcode 14+ (for iOS)
- Android Studio (for Android)
- Capacitor CLI: `npm install -g @capacitor/cli`

## Step 1: Install Required Capacitor Plugins

```bash
# Core native plugins
npm install @capacitor/status-bar
npm install @capacitor/haptics
npm install @capacitor-community/keep-awake

# Permission plugins
npm install @capacitor/camera
npm install @capacitor/geolocation

# Keyboard handling (optional)
npm install @capacitor/keyboard
```

## Step 2: Configure Capacitor

Create or update `capacitor.config.ts`:

```typescript
import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'co.sosphere.app',
  appName: 'SOSphere',
  webDir: 'dist',
  server: {
    androidScheme: 'https'
  },
  plugins: {
    StatusBar: {
      style: 'LIGHT',
      backgroundColor: '#05070E',
    },
    SplashScreen: {
      launchAutoHide: true,
      launchShowDuration: 3000,
      showSpinner: false,
    },
    Keyboard: {
      resize: 'native',
      resizeOnNativeKeyboardShow: true,
    },
  },
};

export default config;
```

## Step 3: Build Web Assets

```bash
npm run build
```

This creates the `dist/` folder that Capacitor will wrap.

## Step 4: Add Platforms

### Add iOS

```bash
npx cap add ios
```

This creates the `ios/` folder with an Xcode project.

### Add Android

```bash
npx cap add android
```

This creates the `android/` folder with Android Studio project.

## Step 5: Sync Native Code

After making changes to the web code, sync to native platforms:

```bash
# Sync to iOS
npx cap sync ios

# Sync to Android
npx cap sync android

# Or sync both
npx cap sync
```

## Step 6: iOS Configuration

### Open in Xcode

```bash
npx cap open ios
```

### Configure in Xcode

1. **App Icon**
   - Replace `App/App/Assets.xcassets/AppIcon.appiconset` with your icons
   - Use [App Icon Generator](https://appicon.co/)

2. **Launch Screen**
   - Edit `App/App/Info.plist` for splash screen

3. **Signing & Capabilities**
   - Select project > Signing & Capabilities
   - Add Team ID
   - Add required capabilities:
     - Location Services
     - Camera
     - Microphone
     - Push Notifications (for alerts)

4. **Info.plist Permissions**
   ```xml
   <key>NSLocationWhenInUseUsageDescription</key>
   <string>SOSphere needs your location to ensure your safety</string>
   
   <key>NSCameraUsageDescription</key>
   <string>SOSphere uses your camera for incident reporting</string>
   
   <key>NSMicrophoneUsageDescription</key>
   <string>SOSphere uses your microphone for emergency calls</string>
   ```

5. **Deployment Info**
   - Minimum Deployment Target: iOS 12.0
   - Supported Orientations: Portrait
   - Safe Area: Enabled (automatic)

### Test on iOS Device

```bash
# Via Xcode (GUI)
npx cap open ios

# Or via CLI
xcrun xctrace launch --device-name "iPhone 14 Pro"
```

## Step 7: Android Configuration

### Open in Android Studio

```bash
npx cap open android
```

### Configure in Android Studio

1. **App Icon**
   - Right-click `res` > New > Image Asset
   - Upload launcher icon
   - Density: XXXHDPI (192×192px)

2. **AndroidManifest.xml**
   - Set `android:label="@string/title_activity_main"` to "SOSphere"
   - Add permissions:
   ```xml
   <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
   <uses-permission android:name="android.permission.CAMERA" />
   <uses-permission android:name="android.permission.RECORD_AUDIO" />
   <uses-permission android:name="android.permission.INTERNET" />
   ```

3. **BuildConfig**
   - Set `targetSdkVersion` to 34+
   - Set `minSdkVersion` to 21+

4. **Permissions at Runtime**
   - Capacitor handles runtime permission requests
   - Verify via `requestNativePermissions()` in code

### Test on Android Device

```bash
# Via Android Studio (GUI)
npx cap open android

# Or via CLI
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

## Step 8: Testing on Physical Devices

### iOS Testing

1. Connect iPhone to Mac
2. Open Xcode project
3. Select device in top menu
4. Click Play button to build and run
5. Trust developer certificate on device

### Android Testing

1. Connect Android device with USB debugging enabled
2. Open Android Studio
3. Click "Run" (Shift+F10)
4. Select device from list
5. App installs and launches

### Testing Checklist

- [ ] App launches and shows splash screen
- [ ] Content respects safe areas (no overlap with notch/punch-hole)
- [ ] All buttons are 44×44px minimum
- [ ] Touch feedback works (haptics)
- [ ] Status bar styling is correct
- [ ] Virtual keyboard doesn't cover form inputs
- [ ] Landscape orientation works
- [ ] GPS tracking works (if implemented)
- [ ] Camera access works (if implemented)
- [ ] Notifications work (if implemented)
- [ ] App closes gracefully

## Step 9: iOS App Store Submission

### Generate Certificates and Provisioning Profiles

1. **Apple Developer Account**
   - Sign up at [developer.apple.com](https://developer.apple.com)
   - Pay $99/year developer fee

2. **Create App ID**
   - Go to Certificates, Identifiers & Profiles
   - Create new Identifier with Bundle ID: `co.sosphere.app`

3. **Generate Certificates**
   - Create iOS Distribution Certificate
   - Create Push Notification Certificate (if using notifications)

4. **Create Provisioning Profiles**
   - Create App Store Distribution profile
   - Download and add to Xcode

### Create App Record on App Store Connect

1. Go to [appstoreconnect.apple.com](https://appstoreconnect.apple.com)
2. Click "My Apps"
3. Create new app:
   - Bundle ID: `co.sosphere.app`
   - SKU: `sosphere-ios`
   - Platform: iOS
   - Primary Language: English
   - Category: Health & Fitness (or Productivity)

4. Fill in app details:
   - Name: SOSphere
   - Description: Real-time emergency SOS platform
   - Keywords: emergency, safety, SOS, tracking
   - Support URL: your support page
   - Privacy Policy URL: your privacy policy

5. Set pricing and availability

### Build for Distribution

```bash
# In Xcode
Product > Archive

# Or via command line
xcodebuild -scheme "App" -configuration Release archive
```

### Submit to App Store

1. In Xcode Organizer, select build
2. Distribute App
3. Select App Store Connect
4. Follow validation steps

### Wait for Apple Review

- Review typically takes 24-48 hours
- Common rejections:
  - Safe area not respected
  - Touch targets smaller than 44pt
  - Crash on launch
  - Misleading location tracking claims

## Step 10: Google Play Store Submission

### Create Google Play Account

1. Sign up at [play.google.com/console](https://play.google.com/console)
2. Pay $25 one-time developer fee
3. Create new app

### Generate Release Key

```bash
# Create keystore (one-time)
keytool -genkey -v -keystore sosphere.jks -keyalg RSA -keysize 2048 -validity 10000 -alias sosphere

# Store the password securely!
```

### Configure Gradle

Edit `android/app/build.gradle`:

```gradle
android {
  signingConfigs {
    release {
      storeFile file('sosphere.jks')
      storePassword 'YOUR_PASSWORD'
      keyAlias 'sosphere'
      keyPassword 'YOUR_PASSWORD'
    }
  }

  buildTypes {
    release {
      signingConfig signingConfigs.release
    }
  }
}
```

### Build Release APK/Bundle

```bash
# Via Gradle (Android Studio)
./gradlew bundleRelease

# Creates: android/app/build/outputs/bundle/release/app-release.aab
```

### Upload to Google Play

1. Go to Google Play Console
2. Create new app: `SOSphere`
3. Content rating questionnaire
4. Target audience
5. Upload APK/Bundle
6. Set permissions
7. Add screenshots (5-8)
8. Add description and privacy policy
9. Set pricing (free for SOSphere)
10. Submit for review

### Google Play Review

- Review typically takes 2-3 hours
- Common issues:
  - Permissions not justified
  - Location tracking without clear disclosure
  - Crash on launch

## Post-Deployment Monitoring

### Crash Reporting

Set up Sentry for native crashes:

```bash
npm install @sentry/react-native
```

### Performance Monitoring

Monitor:
- Startup time
- Memory usage
- Battery drain
- Network requests

### User Feedback

- Monitor app store reviews
- Set up in-app feedback form
- Address common issues quickly

## Troubleshooting

### Issue: App crashes on launch

**Solution**: Check Xcode console or Logcat for errors:
```bash
# iOS
xcode organizer > Device Logs

# Android
adb logcat
```

### Issue: Safe area not working

**Solution**: Verify `viewport-fit=cover` in index.html:
```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
```

### Issue: Touch targets too small

**Solution**: Apply `.touch-target` class or `min-h-11 min-w-11` Tailwind classes

### Issue: Buttons unresponsive on notched devices

**Solution**: Use `useSafeArea()` hook to add padding

### Issue: Virtual keyboard covers input

**Solution**: Use `.keyboard-open` class styles or SafeAreaView component

## Maintenance

### Updating Capacitor

```bash
npm update @capacitor/*
npx cap sync
```

### Releasing Updates

1. Bump version in `package.json` and iOS/Android projects
2. Build new web assets: `npm run build`
3. Sync: `npx cap sync`
4. Archive/build for stores
5. Submit to app stores

## Resources

- [Capacitor Documentation](https://capacitorjs.com/docs)
- [Apple App Store Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [Google Play Policies](https://play.google.com/about/developer-content-policy/)
- [iOS Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/)
- [Material Design Guidelines](https://material.io/design/)

## Support

For issues with native compatibility:
1. Check the NATIVE_COMPATIBILITY_GUIDE.md
2. Review Capacitor docs
3. Check app store rejection reasons
4. Test on multiple physical devices

---

**Last Updated**: April 2026
**SOSphere Version**: 1.0.0
**Capacitor Version**: 6.0.0+
