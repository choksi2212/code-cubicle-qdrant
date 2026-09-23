@echo off
REM Build the Rust core crate + generate UniFFI bindings (Windows)

setlocal

set ROOT=%~dp0..
set RUST_DIR=%ROOT%\packages\field-edge-rust

set MODE=%1
if "%MODE%"=="" set MODE=debug

echo Building Rust core (%MODE%)...
cd /d "%RUST_DIR%"
cargo build %MODE%
if errorlevel 1 exit /b 1

echo Generating UniFFI bindings...
if not exist "%RUST_DIR%\bindings\swift" mkdir "%RUST_DIR%\bindings\swift"
if not exist "%RUST_DIR%\bindings\kotlin" mkdir "%RUST_DIR%\bindings\kotlin"

set UNIFFI_BINDGEN=C:\Users\niklaus\.cargo\bin\uniffi-bindgen.exe
if not exist "%UNIFFI_BINDGEN%" (
    where uniffi-bindgen >nul 2>&1
    if errorlevel 1 (
        echo uniffi-bindgen not found. Install with: cargo install uniffi_bindgen
        echo Skipping binding generation.
        exit /b 0
    )
    set UNIFFI_BINDGEN=uniffi-bindgen
)

"%UNIFFI_BINDGEN%" generate "%RUST_DIR%\uniffi\field_edge.udl" --language swift --out-dir "%RUST_DIR%\bindings\swift"
if errorlevel 1 exit /b 1
"%UNIFFI_BINDGEN%" generate "%RUST_DIR%\uniffi\field_edge.udl" --language kotlin --out-dir "%RUST_DIR%\bindings\kotlin"
if errorlevel 1 exit /b 1

echo Done.
echo   - Rust crate: %RUST_DIR%\target\
echo   - Swift bindings: %RUST_DIR%\bindings\swift\
echo   - Kotlin bindings: %RUST_DIR%\bindings\kotlin\
endlocal
