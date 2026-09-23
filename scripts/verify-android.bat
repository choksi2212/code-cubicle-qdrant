@echo off
REM Verify the FieldEdge Android setup is complete (Windows).

setlocal enabledelayedexpansion

set ROOT=%~dp0..
cd /d "%ROOT%"

set PASS=0
set FAIL=0

set "ok=echo ✅"
set "fail=echo ❌"

REM Rust toolchain
where cargo >nul 2>&1
if errorlevel 1 (
    echo ❌ cargo not installed
    set /a FAIL+=1
) else (
    echo ✅ cargo present
    set /a PASS+=1
)

REM cargo-ndk
where cargo-ndk >nul 2>&1
if errorlevel 1 (
    echo ❌ cargo-ndk not installed
    set /a FAIL+=1
) else (
    echo ✅ cargo-ndk present
    set /a PASS+=1
)

REM Android NDK
if defined ANDROID_NDK_HOME (
    if exist "%ANDROID_NDK_HOME%" (
        echo ✅ ANDROID_NDK_HOME set: %ANDROID_NDK_HOME%
        set /a PASS+=1
    ) else (
        echo ❌ ANDROID_NDK_HOME set but path doesn't exist
        set /a FAIL+=1
    )
) else (
    echo ❌ ANDROID_NDK_HOME not set
    set /a FAIL+=1
)

REM Required files
set FILES=apps\mobile\android\build.gradle apps\mobile\android\settings.gradle apps\mobile\android\gradle.properties apps\mobile\android\gradlew apps\mobile\android\app\build.gradle apps\mobile\android\app\src\main\AndroidManifest.xml apps\mobile\android\app\src\main\java\com\fieldedge\MainActivity.kt apps\mobile\android\app\src\main\java\com\fieldedge\MainApplication.kt apps\mobile\android\app\src\main\java\com\fieldedge\edge\FieldEdgePackage.kt apps\mobile\android\app\src\main\java\com\fieldedge\edge\FieldEdgeRustModule.kt apps\mobile\android\app\src\main\java\com\fieldedge\edge\OnnxClipModule.kt apps\mobile\android\app\src\main\res\values\strings.xml apps\mobile\android\app\src\main\res\values\styles.xml apps\mobile\android\app\proguard-rules.pro apps\mobile\android\app\debug.keystore packages\field-edge-rust\src\ffi\exports.rs packages\field-edge-rust\uniffi\field_edge.udl scripts\build-android.bat scripts\install-android-deps.bat

for %%F in ("%FILES: =" "%") do (
    if exist "%%~F" (
        echo ✅ %%~F
        set /a PASS+=1
    ) else (
        echo ❌ missing: %%~F
        set /a FAIL+=1
    )
)

REM jniLibs dirs
for %%A in (arm64-v8a armeabi-v7a x86 x86_64) do (
    if exist "apps\mobile\android\app\src\main\jniLibs\%%A" (
        echo ✅ jniLibs\%%A
        set /a PASS+=1
    ) else (
        echo ❌ missing jniLibs\%%A
        set /a FAIL+=1
    )
)

echo.
echo ═══════════════════════════════════════
echo Results: %PASS% passed, %FAIL% failed
echo ═══════════════════════════════════════

if %FAIL% gtr 0 exit /b 1
endlocal
