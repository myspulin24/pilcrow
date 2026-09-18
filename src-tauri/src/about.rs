//! Na čem aplikace stojí.
//!
//! Sekce „O aplikaci“ nemá být marketing, ale odpověď na otázku „co tady
//! vlastně běží“ -- při hlášení chyby je to první, na co se každý ptá.
//!
//! Část údajů zná jen překladač (verze `rustc`, profil, cílová platforma),
//! část jen běžící systém (verze WebView2, systém), a část jsou konstanty
//! knihoven. Dohromady je sesbírá tenhle jediný příkaz, aby frontend nemusel
//! skládat obrázek z pěti míst.

use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    /// Verze aplikace z `tauri.conf.json`.
    pub version: String,
    /// `com.pilcrow.app`
    pub identifier: String,
    /// `debug` nebo `release`.
    pub profile: String,

    // -- co drží okno ---------------------------------------------------------
    pub tauri_version: String,
    /// Verze běhového prostředí, které kreslí rozhraní. Na Windows WebView2,
    /// na macOS WebKit, na Linuxu WebKitGTK. Prázdné, když ji nejde zjistit.
    pub webview_version: String,

    // -- čím je přeložený backend --------------------------------------------
    /// Celý výstup `rustc --version`, i s hashem a datem.
    pub rustc_version: String,
    /// Trojice jako `x86_64-pc-windows-msvc`.
    pub target: String,

    // -- co je uvnitř ---------------------------------------------------------
    /// Verze SQLite zabudované do binárky (rusqlite s `bundled`).
    pub sqlite_version: String,

    // -- kde to běží ----------------------------------------------------------
    pub os: String,
    pub arch: String,
}

#[tauri::command]
pub fn app_info(app: tauri::AppHandle) -> AppInfo {
    let package = app.package_info();

    AppInfo {
        version: package.version.to_string(),
        identifier: app.config().identifier.clone(),
        profile: env!("PILCROW_PROFILE").to_string(),

        tauri_version: tauri::VERSION.to_string(),
        webview_version: tauri::webview_version().unwrap_or_default(),

        rustc_version: env!("PILCROW_RUSTC").to_string(),
        target: env!("PILCROW_TARGET").to_string(),

        sqlite_version: rusqlite::version().to_string(),

        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
    }
}
