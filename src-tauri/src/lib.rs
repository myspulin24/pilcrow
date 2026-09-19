//! Pilcrow desktop application.
//!
//! Start-up order matters and is worth stating plainly:
//!
//! 1. Load `.env` (never committed) so `PILCROW_VAULT_PATH` is available.
//! 2. Decide where the vault lives.
//! 3. Open the vault and its index, creating both if needed.
//! 4. Seed a welcome note when the vault is brand new, so the first run is
//!    never an empty window.
//! 5. Start the file watcher.
//!
//! If step 3 fails -- an unwritable folder, a corrupt index -- the window still
//! opens and the frontend renders its recovery screen. A notes app that refuses
//! to start is worse than one that starts and explains itself.

mod about;
mod assistant;
mod commands;
mod git;
mod state;
mod watcher;

use std::path::PathBuf;

use tauri::Manager;

use pilcrow_core::vault;

use crate::state::AppState;

/// Load `.env` from the project root, whichever directory we were launched in.
///
/// `tauri dev` runs with the working directory set to `src-tauri/`, a bundled
/// app runs from somewhere else entirely, so try both.
fn load_dotenv() {
    for candidate in [".env", "../.env", "../../.env"] {
        if dotenvy::from_filename(candidate).is_ok() {
            return;
        }
    }
}

fn vault_root(app: &tauri::AppHandle) -> PathBuf {
    let documents = app.path().document_dir().ok();
    vault::default_vault_root(documents)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    load_dotenv();

    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init());

    // Aktualizace jsou jediná věc, kvůli které Pilcrow sahá na síť, a dějí
    // se jen na desktopu. Podpis každého balíčku se ověřuje veřejným klíčem
    // z tauri.conf.json, takže nepodepsaná aktualizace se nenainstaluje.
    #[cfg(desktop)]
    {
        builder = builder
            .plugin(tauri_plugin_updater::Builder::new().build())
            .plugin(tauri_plugin_process::init());
    }

    builder
        .invoke_handler(commands::handlers())
        .setup(|app| {
            let handle = app.handle().clone();
            let root = vault_root(&handle);

            // Asistent nemá s trezorem nic společného a hlavně nesmí bránit
            // startu: drží si jen cestu ke `claude` a rozpracované procesy.
            app.manage(assistant::AssistantState::default());
            // Git a GitHub CLI: totéž -- cesty k nástrojům a rozběhnuté procesy,
            // nic, co by trezor potřeboval nebo co by ho mohlo zdržet.
            app.manage(git::GitState::default());

            match AppState::new(root.clone()) {
                Ok(state) => {
                    app.manage(state);

                    if let Err(error) = commands::bootstrap_vault(&handle) {
                        eprintln!("pilcrow: trezor se nepodařilo připravit: {error}");
                    }

                    match watcher::start(handle.clone(), &root) {
                        Ok(handle_box) => {
                            if let Some(state) = handle.try_state::<AppState>() {
                                if let Ok(mut slot) = state.watcher.lock() {
                                    *slot = Some(handle_box);
                                }
                            }
                        }
                        // Watching is a convenience. Without it, external edits
                        // are noticed on the next save instead of immediately,
                        // and the conflict check still protects the file.
                        Err(error) => eprintln!(
                            "pilcrow: sledování souborů není k dispozici ({error}); změny zvenčí se poznají až při ukládání"
                        ),
                    }
                }
                Err(error) => {
                    eprintln!(
                        "pilcrow: trezor v {} se nepodařilo otevřít: {error}",
                        root.display()
                    );
                }
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("chyba za běhu Pilcrow");
}
