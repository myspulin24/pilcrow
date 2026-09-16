//! Reader_MJ's vault layer: files on disk plus a rebuildable SQLite index.
//!
//! Deliberately free of any Tauri dependency, for two reasons: the whole crate
//! compiles and tests in seconds (`cargo test -p reader-mj-core`), and the rules
//! that matter -- path safety, atomic writes, conflict detection -- are
//! testable without spinning up a webview.
//!
//! Markdown *parsing* deliberately lives in TypeScript (`src/core`), not here.
//! The frontend hands this crate already-derived `IndexRecord`s, so there is
//! exactly one implementation of "what is a tag" rather than two that drift.

pub mod collections;
pub mod error;
pub mod explorer;
pub mod index;
pub mod paths;
pub mod settings;
pub mod types;
pub mod vault;

pub use collections::{Collection, CollectionItem};
pub use error::{ConflictPayload, CoreError, Result};
pub use explorer::{AccessRegistry, DroppedPaths, FolderTree, ScanLimits, TreeNode};
pub use index::NoteIndex;
pub use paths::{normalize_relative, sanitize_segment, VaultPaths};
pub use types::*;
