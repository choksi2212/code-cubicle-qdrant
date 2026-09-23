@echo off
REM Build the FieldEdge Rust core for all Android targets + generate Kotlin bindings.
REM
REM Prerequisites:
REM   - Rust + cargo (https://rustup.rs)
REM   - Android NDK r26+ (set ANDROID_NDK_HOME)
REM   - cargo-ndk: cargo install cargo-ndk
REM
REM Output:
REM   - apps/mobile/android/app/src/main/jniLibs/<abi>/libfield_edge_rust.so
REM   - packages/field-edge-rust/bindings/kotlin/ (Kotlin source files)

setlocal enabledelayedexpansion

set ROOT=%~dp0..
set RUST_DIR=%ROOT%\packages\field-edge-rust
set JNI_DIR=%ROOT%\apps\mobile\android\app\src\main\jniLibs

set ABIS=arm64-v8a armeabi-v7a x86 x86_64

REM Step 1: Generate Kotlin bindings (one-time, doesn't change per ABI)
echo [1/2] Generating Kotlin bindings...
cd /d "%RUST_DIR%"
cargo run --release --bin generate-bindings -- --target kotlin --out-dir bindings/kotlin
if errorlevel 1 (
    echo Failed to generate Kotlin bindings.
    exit /b 1
)

REM Step 2: Cross-compile for each Android ABI
echo [2/2] Cross-compiling Rust for Android...
cd /d "%RUST_DIR%"
cargo ndk -t arm64-v8a -t armeabi-v7a -t x86 -t x86_64 -o "%JNI_DIR%" build --release
if errorlevel 1 (
    echo Failed to cross-compile Rust for Android.
    exit /b 1
)

echo.
echo Done. Artifacts:
for %%A in (%ABIS%) do (
    if exist "%JNI_DIR%\%%A\libfield_edge_rust.so" (
        echo   %JNI_DIR%\%%A\libfield_edge_rust.so
    )
)
echo Kotlin bindings: %RUST_DIR%\bindings\kotlin\
endlocal
