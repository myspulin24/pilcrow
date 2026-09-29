//! Soubory, se kterými někdo Pilcrow spustil, a jak se dostanou do okna.
//!
//! Které argumenty jsou soubory a kdy jdou frontou a kdy rovnou, rozhoduje
//! `pilcrow_core::launch` (a tam je to pokryté testy). Tady je jen doručení:
//!
//! 1. Dokud si frontend neřekne o [`take_launch_files`], soubory čekají ve
//!    frontě. Frontend to udělá, až obnoví, co bylo otevřené minule -- jinak
//!    by mu obnova soubor zase přepsala.
//! 2. Od té chvíle jde každý další soubor rovnou událostí
//!    [`OPEN_FILES_EVENT`]. Posílá je druhé spuštění Pilcrow přes plugin
//!    single-instance a na macOS Finder.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager, State};

use pilcrow_core::error::{CoreError, Result};
use pilcrow_core::launch::{files_from_args, LaunchInbox};

use crate::state::AppState;

/// Událost se soubory, které přišly, když už frontend běží.
pub const OPEN_FILES_EVENT: &str = "pilcrow://open-files";

#[derive(Default)]
pub struct LaunchState {
    inbox: Mutex<LaunchInbox>,
}

/// Soubory z argumentů, se kterými se spustil tenhle proces.
pub fn from_startup(app: &AppHandle) {
    let cwd = std::env::current_dir().unwrap_or_default();
    deliver(app, files_from_args(std::env::args_os().skip(1), &cwd));
}

/// Druhé spuštění Pilcrow: plugin ho ukončil a předal jeho argumenty sem.
///
/// Okno se ukáže i tehdy, když v argumentech žádný soubor není -- kdo spustí
/// aplikaci, která už běží, chce ji mít před sebou.
#[cfg(desktop)]
pub fn from_second_instance(app: &AppHandle, args: Vec<String>, cwd: String) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
    deliver(app, files_from_args(args.into_iter().skip(1), Path::new(&cwd)));
}

/// Soubory, které macOS předal jako `file://` adresy.
#[cfg(target_os = "macos")]
pub fn from_urls(app: &AppHandle, urls: Vec<tauri::Url>) {
    let args = urls.into_iter().map(|url| url.to_string());
    deliver(app, files_from_args(args, Path::new("/")));
}

fn deliver(app: &AppHandle, files: Vec<PathBuf>) {
    if files.is_empty() {
        return;
    }
    let Some(launch) = app.try_state::<LaunchState>() else {
        return;
    };
    // Fronta, nebo rovnou -- rozhodne se pod zámkem, stejným, pod kterým si
    // frontend frontu vyzvedává. Posílá se už bez něj.
    let now = match launch.inbox.lock() {
        Ok(mut inbox) => inbox.offer(files),
        Err(_) => return,
    };
    if now.is_empty() {
        return;
    }
    // Frontend už frontu vyzvedl, takže trezor je otevřený -- jinak by si
    // o ni neřekl. Kdyby přece jen nebyl, soubor se neotevře, ale nic nespadne.
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    let Ok(paths) = grant(&state, now) else {
        return;
    };
    if let Err(error) = app.emit(OPEN_FILES_EVENT, paths) {
        eprintln!("pilcrow: soubor se nepodařilo předat oknu: {error}");
    }
}

/// Povolit čtení a zápis souborů a vrátit jejich cesty pro frontend.
///
/// Soubor v argumentech vybral uživatel stejně jako v dialogu -- dvojklikem,
/// přes „Otevřít v programu“, nebo ho jiný program předal jeho jménem. Proto
/// ho Rust povolí sám, stejně jako `reopen_file`, a frontend dostane jen to,
/// co je povolené. Sám si z webview nepovolí nic.
fn grant(state: &AppState, files: Vec<PathBuf>) -> Result<Vec<String>> {
    state.with_access(|access| {
        for file in &files {
            access.grant_file(file);
        }
        Ok(())
    })?;
    Ok(files
        .into_iter()
        .map(|file| file.to_string_lossy().to_string())
        .collect())
}

/// Soubory, se kterými se Pilcrow spustil. Vydá je jen jednou.
///
/// Frontend to volá po obnově toho, co bylo otevřené minule. Od té chvíle
/// chodí další soubory událostí [`OPEN_FILES_EVENT`], takže druhé zavolání
/// vrátí prázdný seznam.
#[tauri::command]
pub fn take_launch_files(
    state: State<'_, AppState>,
    launch: State<'_, LaunchState>,
) -> Result<Vec<String>> {
    let mut inbox = launch
        .inbox
        .lock()
        .map_err(|_| CoreError::Io("Fronta souborů k otevření je nedostupná.".into()))?;
    grant(&state, inbox.take())
}
