@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo.
echo ================================================================
echo   SOSphere - Build and Install Script
echo ================================================================
echo.

echo [1/5] Pulling latest from GitHub...
git pull origin main
if errorlevel 1 (
    echo WARN: git pull returned an error - continuing with local code.
)
echo.

echo [2/5] Installing npm dependencies if needed...
if not exist node_modules (
    call npm install
    if errorlevel 1 goto error
)
echo.

echo [3/5] Building web bundle (Vite)...
call npx vite build
if errorlevel 1 goto error
echo.

echo [4/5] Syncing assets to Android project...
call npx cap sync android
if errorlevel 1 goto error
echo.

echo [5/5] Building debug APK (Gradle)...
pushd android
call gradlew.bat assembleDebug
set GRADLE_EXIT=%errorlevel%
popd
if not "%GRADLE_EXIT%"=="0" goto error
echo.

set APK_PATH=android\app\build\outputs\apk\debug\app-debug.apk
if not exist "%APK_PATH%" (
    echo ERROR: APK not found at %APK_PATH%
    goto error
)

echo ================================================================
echo   BUILD SUCCESS
echo ================================================================
echo   APK: %CD%\%APK_PATH%
echo.
echo   To install on a connected device over USB, run:
echo       adb install -r "%CD%\%APK_PATH%"
echo.
echo   Or copy the APK to your phone and tap to install.
echo ================================================================
echo.

set /p INSTALL_NOW="Install to connected Android device now via ADB? (y/n): "
if /i "%INSTALL_NOW%"=="y" (
    adb install -r "%APK_PATH%"
    if errorlevel 1 (
        echo WARN: adb install failed. Is USB debugging enabled?
    ) else (
        echo Installed successfully. Open SOSphere on your device.
    )
)

pause
exit /b 0

:error
echo.
echo ================================================================
echo   BUILD FAILED - see the errors above.
echo ================================================================
pause
exit /b 1
