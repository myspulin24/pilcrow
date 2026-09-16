//! Shared application state.
//!
//! One vault, one index, both behind mutexes. The locks are deliberately
//! short-lived and never held across a file-system call that could block for
//! long, because the file watcher runs on its own thread and touches the same
//! index.

use std::path::PathBuf;
use std::sync::Mutex;

use reader_mj_core::error::{CoreError, Result};
use reader_mj_core::explorer::AccessRegistry;
use reader_mj_core::index::NoteIndex;
use reader_mj_core::paths::VaultPaths;
use reader_mj_core::types::VaultStatus;

pub struct AppState {
    pub vault: VaultPaths,
    index: Mutex<NoteIndex>,
    /// Kept alive for as long as the app runs; dropping it stops watching.
    pub watcher: Mutex<Option<Box<dyn std::any::Any + Send>>>,
    /// Files and folders the user has opened through a dialog this session.
    /// Starts empty and is never persisted, so access does not outlive the run.
    access: Mutex<AccessRegistry>,
}

impl AppState {
    pub fn new(root: PathBuf) -> Result<Self> {
        let vault = VaultPaths::new(root);
        vault.ensure()?;
        let index = NoteIndex::open(&vault.index_path())?;
        Ok(Self {
            vault,
            index: Mutex::new(index),
            watcher: Mutex::new(None),
            access: Mutex::new(AccessRegistry::default()),
        })
    }

    /// Run `f` with the access registry locked.
    pub fn with_access<T>(&self, f: impl FnOnce(&mut AccessRegistry) -> Result<T>) -> Result<T> {
        let mut guard = self
            .access
            .lock()
            .map_err(|_| CoreError::Io("Registr přístupů k souborům je nedostupný.".into()))?;
        f(&mut guard)
    }

    /// Run `f` with the index locked.
    ///
    /// A poisoned mutex means another thread panicked while holding the index.
    /// Since the index is a cache, the recovery advice is always the same:
    /// rebuild it. We surface that rather than propagating the panic.
    pub fn with_index<T>(&self, f: impl FnOnce(&mut NoteIndex) -> Result<T>) -> Result<T> {
        let mut guard = self.index.lock().map_err(|_| {
            CoreError::Io(
                "Vyhledávací rejstřík je v nekonzistentním stavu. Spusť „Přestavět vyhledávací rejstřík“ z palety příkazů.".into(),
            )
        })?;
        f(&mut guard)
    }

    pub fn status(&self) -> Result<VaultStatus> {
        let (note_count, full_text_search, indexed_at) = self.with_index(|index| {
            Ok((
                index.note_count()?,
                index.has_full_text_search(),
                index.indexed_at()?,
            ))
        })?;

        Ok(VaultStatus {
            available: true,
            backend: "tauri".into(),
            vault_path: self.vault.root().to_string_lossy().to_string(),
            note_count,
            full_text_search,
            indexed_at,
            warning: if full_text_search {
                None
            } else {
                Some(
                    "Tahle verze SQLite nemá FTS5, takže hledání spadne zpět na podřetězce. Výsledky jsou pořád správné, jen hůř seřazené."
                        .into(),
                )
            },
        })
    }
}
