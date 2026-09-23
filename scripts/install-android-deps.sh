#!/usr/bin/env bash
# Install Android command-line tools + NDK r26 + platform tools
#
# This script downloads Google's cmdline-tools, then uses sdkmanager to install
# the NDK and build tools needed by FieldEdge.
#
# Requires: JDK 17+, curl, unzip

set -euo pipefail

ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
CMDLINE_VERSION="11076708"
NDK_VERSION="26.1.10909125"
PLATFORM_VERSION="android-34"
BUILD_TOOLS_VERSION="34.0.0"

mkdir -p "$ANDROID_HOME/cmdline-tools"
cd "$ANDROID_HOME/cmdline-tools"

if [ ! -d "latest" ]; then
    echo "Downloading Android cmdline-tools..."
    curl -L -o /tmp/cmdline-tools.zip \
        "https://dl.google.com/android/repository/commandlinetools-win-${CMDLINE_VERSION}_latest.zip"
    unzip -q /tmp/cmdline-tools.zip
    # zip extracts to "cmdline-tools" — rename to "latest" (sdkmanager convention)
    if [ -d "cmdline-tools" ] && [ ! -d "latest" ]; then
        mv cmdline-tools latest
    fi
fi

export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH"
export ANDROID_HOME
export ANDROID_SDK_ROOT="$ANDROID_HOME"

echo "Accepting SDK licenses..."
yes | sdkmanager --licenses >/dev/null 2>&1 || true

echo "Installing NDK ${NDK_VERSION}..."
sdkmanager --install "ndk;${NDK_VERSION}"

echo "Installing platform-tools + build-tools + platform ${PLATFORM_VERSION}..."
sdkmanager --install "platform-tools"
sdkmanager --install "build-tools;${BUILD_TOOLS_VERSION}"
sdkmanager --install "platforms;${PLATFORM_VERSION}"

echo "Done. Set:"
echo "  export ANDROID_HOME=\"$ANDROID_HOME\""
echo "  export ANDROID_NDK_HOME=\"$ANDROID_HOME/ndk/${NDK_VERSION}\""
echo "  export PATH=\"\$ANDROID_HOME/platform-tools:\$ANDROID_HOME/cmdline-tools/latest/bin:\$PATH\""
