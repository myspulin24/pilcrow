//! Watching the vault for changes made outside Reader_MJ.
//!
//! This is what makes "the folder is the source of truth" true rather than
//! aspirational: iCloud Drive delivering a note edited on an iPhone, a text
//! editor, `git checkout` -- all of it shows up in the app.
//!
//! Two details matter:
//!
//! 1. **Debouncing.** Editors and sync clients write in bursts. Events are
//!    coalesced per path over a short window so one save is one notification.
//! 2. **Echo suppression.** Reader_MJ's own writes also trip the watcher. Rather
//!    than track "did I just write this?" with a timer -- which races -- we
//!    compare the file's hash against what the index recorded. If they match,
//!    the change was ours and nothing is emitted.

use std::collections::HashMap;
use std::path::Path;
use std::sync::mpsc::{channel, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use notify::{EventKind, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter, Manager};

use reader_mj_core::types::ExternalChange;
use reader_mj_core::vault;

use crate::state::AppState;

pub const EXTERNAL_CHANGE_EVENT: &str = "reader-mj://external-change";

/// How long a path must be quiet before we report it.
const QUIET_PERIOD: Duration = Duration::from_millis(350);

/// Start watching the vault. Returns the watcher, which must be kept alive.
pub fn start(app: AppHandle, root: &Path) -> notify::Result<Box<dyn std::any::Any + Send>> {
    let (tx, rx) = channel::<notify::Result<notify::Event>>();

    let mut watcher = notify::recommended_watcher(move |event| {
        // A full channel means the UI thread is wedged; dropping the event is
        // better than blocking the OS notification thread.
        let _ = tx.send(event);
    })?;
    watcher.watch(root, RecursiveMode::Recursive)?;

    let pending: Arc<Mutex<HashMap<String, Instant>>> = Arc::new(Mutex::new(HashMap::new()));
    let drain = Arc::clone(&pending);

    // Collector: turn raw notify events into "this relative path is dirty".
    let collector_app = app.clone();
    std::thread::spawn(move || {
        loop {
            match rx.recv_timeout(Duration::from_millis(200)) {
                Ok(Ok(event)) => {
                    if matches!(event.kind, EventKind::Access(_)) {
                        continue;
                    }
                    let Some(state) = collector_app.try_state::<AppState>() else {
                        continue;
                    };
                    let mut guard = match pending.lock() {
                        Ok(guard) => guard,
                        Err(_) => continue,
                    };
                    for path in event.paths {
                        if let Some(relative) = interesting_path(&state, &path) {
                            guard.insert(relative, Instant::now());
                        }
                    }
                }
                Ok(Err(error)) => eprintln!("reader_mj: chyba sledování souborů: {error}"),
                Err(RecvTimeoutError::Timeout) => continue,
                // The sender is gone, which means the watcher was dropped.
                Err(RecvTimeoutError::Disconnected) => break,
            }
        }
    });

    // Emitter: flush paths that have been quiet long enough.
    std::thread::spawn(move || loop {
        std::thread::sleep(QUIET_PERIOD / 2);

        let ready: Vec<String> = {
            let Ok(mut guard) = drain.lock() else {
                continue;
            };
            let now = Instant::now();
            let ready: Vec<String> = guard
                .iter()
                .filter(|(_, seen)| now.duration_since(**seen) >= QUIET_PERIOD)
                .map(|(path, _)| path.clone())
                .collect();
            for path in &ready {
                guard.remove(path);
            }
            ready
        };

        for relative in ready {
            if let Some(change) = classify(&app, &relative) {
                let _ = app.emit(EXTERNAL_CHANGE_EVENT, change);
            }
        }

        if app.try_state::<AppState>().is_none() {
            break;
        }
    });

    Ok(Box::new(watcher))
}

/// Vault-relative path when this is a note we care about, otherwise `None`.
fn interesting_path(state: &AppState, absolute: &Path) -> Option<String> {
    let relative = state.vault.relativize(absolute)?;
    if state.vault.is_internal(&relative) {
        return None;
    }
    if !relative.to_ascii_lowercase().ends_with(".md") {
        return None;
    }
    // Skip the temp files our own atomic writes create.
    if relative.ends_with(".tmp") {
        return None;
    }
    Some(relative)
}

/// Decide whether a dirty path is worth telling the frontend about, and update
/// the index so the next comparison is against current reality.
fn classify(app: &AppHandle, relative: &str) -> Option<ExternalChange> {
    let state = app.try_state::<AppState>()?;

    let known_hash = state
        .with_index(|index| index.hash_for(relative))
        .ok()
        .flatten();

    match vault::read_note(&state.vault, relative) {
        Ok(file) => {
            // Our own write: the index already knows this exact content.
            if known_hash.as_deref() == Some(file.hash.as_str()) {
                return None;
            }
            Some(ExternalChange {
                kind: if known_hash.is_some() { "modified" } else { "created" }.to_string(),
                path: relative.to_string(),
                hash: Some(file.hash),
                mtime: file.mtime,
            })
        }
        Err(_) => {
            // Gone. Only report it if we thought it existed.
            known_hash.as_ref()?;
            let _ = state.with_index(|index| index.remove(relative));
            Some(ExternalChange {
                kind: "removed".to_string(),
                path: relative.to_string(),
                hash: None,
                mtime: vault::now_millis(),
            })
        }
    }
}
