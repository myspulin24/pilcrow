use std::process::Command;

/// Zapsat do binárky, čím a jak byla přeložená.
///
/// Sekce „O aplikaci“ má říct, na čem aplikace stojí, a překladač ani profil
/// se za běhu zjistit nedají -- v té chvíli už je dávno po překladu. Jediné
/// místo, kde se to ví, je tenhle skript.
fn emit_build_info() {
    let rustc = Command::new(std::env::var("RUSTC").unwrap_or_else(|_| "rustc".into()))
        .arg("--version")
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
        .unwrap_or_default();
    println!("cargo:rustc-env=PILCROW_RUSTC={rustc}");

    // `debug` při `tauri dev`, `release` u vydané verze. Ať je z okna poznat,
    // jestli běží vývojové sestavení.
    let profile = std::env::var("PROFILE").unwrap_or_else(|_| "unknown".into());
    println!("cargo:rustc-env=PILCROW_PROFILE={profile}");

    println!("cargo:rustc-env=PILCROW_TARGET={}", std::env::var("TARGET").unwrap_or_default());
}

fn main() {
    emit_build_info();
    tauri_build::build()
}
