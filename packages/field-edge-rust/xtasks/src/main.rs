//! UniFFI binding generator binary.
//!
//! Generates Kotlin (or Swift) bindings from `uniffi/field_edge.udl`.
//! Run with: `cargo run --bin generate-bindings -- --target kotlin --out-dir bindings/kotlin`
//!
//! We use `uniffi_bindgen` as a library because there's no `uniffi-bindgen`
//! standalone binary in the crate registry.

use std::path::PathBuf;
use uniffi_bindgen::bindings::{generate_bindings, TargetLanguage, BindingsOptions};

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let target = parse_arg(&args, "--target").unwrap_or_else(|| "kotlin".to_string());
    let out_dir = parse_arg(&args, "--out-dir")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("bindings"));

    let udl_path = PathBuf::from("uniffi/field_edge.udl");
    let target_lang = match target.as_str() {
        "kotlin" => TargetLanguage::Kotlin,
        "swift" => TargetLanguage::Swift,
        other => {
            eprintln!("Unsupported target: {} (use kotlin or swift)", other);
            std::process::exit(1);
        }
    };

    println!(
        "Generating {} bindings from {} to {}",
        target,
        udl_path.display(),
        out_dir.display()
    );

    let opts = BindingsOptions {
        target_lang,
        out_dir,
        udl_filename: Some(udl_path.to_string_lossy().to_string()),
        ..Default::default()
    };

    if let Err(e) = generate_bindings(opts) {
        eprintln!("Binding generation failed: {}", e);
        std::process::exit(1);
    }

    println!("Done.");
}

fn parse_arg(args: &[String], flag: &str) -> Option<String> {
    let idx = args.iter().position(|a| a == flag)?;
    args.get(idx + 1).cloned()
}
