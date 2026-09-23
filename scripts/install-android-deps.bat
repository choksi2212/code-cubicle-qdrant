@echo off
REM Install Android command-line tools + NDK r26 + platform-tools (Windows)
REM
REM Run as Administrator if Android SDK install path requires it.

setlocal

set ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk
if not "%ANDROID_HOME_OVERRIDE%"=="" set ANDROID_HOME=%ANDROID_HOME_OVERRIDE%

set CMDLINE_VERSION=11076708
set NDK_VERSION=26.1.10909125
set PLATFORM_VERSION=android-34
set BUILD_TOOLS_VERSION=34.0.0

if not exist "%ANDROID_HOME%\cmdline-tools" mkdir "%ANDROID_HOME%\cmdline-tools"
cd /d "%ANDROID_HOME%\cmdline-tools"

if not exist "latest" (
    echo Downloading Android cmdline-tools...
    curl -L -o "%TEMP%\cmdline-tools.zip" "https://dl.google.com/android/repository/commandlinetools-win-%CMDLINE_VERSION%_latest.zip"
    powershell -NoProfile -Command "Expand-Archive -Path '%TEMP%\cmdline-tools.zip' -DestinationPath '.'"
    if exist "cmdline-tools" if not exist "latest" ren "cmdline-tools" "latest"
)

set PATH=%ANDROID_HOME%\cmdline-tools\latest\bin;%ANDROID_HOME%\platform-tools;%PATH%
set ANDROID_HOME=%ANDROID_HOME%
set ANDROID_SDK_ROOT=%ANDROID_HOME%

echo Accepting SDK licenses...
call yes | sdkmanager --licenses >nul 2>&1

echo Installing NDK %NDK_VERSION%...
call sdkmanager --install "ndk;%NDK_VERSION%"

echo Installing platform-tools + build-tools + platform %PLATFORM_VERSION%...
call sdkmanager --install "platform-tools"
call sdkmanager --install "build-tools;%BUILD_TOOLS_VERSION%"
call sdkmanager --install "platforms;%PLATFORM_VERSION%"

echo.
echo Done. Set these environment variables:
echo   ANDROID_HOME=%ANDROID_HOME%
echo   ANDROID_NDK_HOME=%ANDROID_HOME%\ndk\%NDK_VERSION%
echo.
echo Or run: setx ANDROID_HOME "%ANDROID_HOME%" /M
echo         setx ANDROID_NDK_HOME "%ANDROID_HOME%\ndk\%NDK_VERSION%" /M

endlocal
