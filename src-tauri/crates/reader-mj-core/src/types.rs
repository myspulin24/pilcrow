//! Types shared with the frontend.
//!
//! All of them serialise as camelCase so the TypeScript definitions in
//! `src/vault/api.ts` and `src/core/types.ts` match field-for-field.

use serde::{Deserialize, Serialize};

/// A note file exactly as it exists on disk.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteFile {
    /// Vault-relative POSIX path, e.g. `daily/2026-09-15.md`.
    pub path: String,
    pub content: String,
    /// SHA-256 of the bytes on disk, lowercase hex.
    pub hash: String,
    /// Milliseconds since the Unix epoch.
    pub mtime: i64,
    pub size: i64,
}

/// One row of the rebuildable index. Everything here is derived from the file.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexRecord {
    pub path: String,
    pub id: String,
    pub title: String,
    pub body: String,
    pub excerpt: String,
    pub tags: Vec<String>,
    /// Normalised link targets (lowercase, extension-less).
    pub links: Vec<String>,
    pub pinned: bool,
    pub created: String,
    pub updated: String,
    pub has_tasks: bool,
    pub hash: String,
    pub mtime: i64,
    pub size: i64,
}

/// Row returned to the note list and to search results.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteSummary {
    pub id: String,
    pub path: String,
    pub title: String,
    pub excerpt: String,
    pub tags: Vec<String>,
    pub pinned: bool,
    pub created: String,
    pub updated: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub snippet: Option<String>,
}

/// Parsed search query. Parsing happens in TypeScript; this is the result.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchQuery {
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub exclude_tags: Vec<String>,
    #[serde(default)]
    pub pinned_only: bool,
    #[serde(default)]
    pub has_tasks: bool,
    #[serde(default)]
    pub is_empty: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BacklinkRow {
    pub path: String,
    pub title: String,
    pub context: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteResult {
    pub path: String,
    pub hash: String,
    pub mtime: i64,
    pub size: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RebuildResult {
    pub notes: i64,
    pub duration_ms: i64,
    pub full_text_search: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub destination: String,
    pub files: i64,
    pub bytes: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenamedPath {
    pub from: String,
    pub to: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub imported: i64,
    pub skipped: i64,
    pub renamed: Vec<RenamedPath>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultStatus {
    pub available: bool,
    pub backend: String,
    pub vault_path: String,
    pub note_count: i64,
    pub full_text_search: bool,
    pub indexed_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub warning: Option<String>,
}

/// A change noticed by the file watcher.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalChange {
    /// `created` | `modified` | `removed`
    pub kind: String,
    pub path: String,
    pub hash: Option<String>,
    pub mtime: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultSettings {
    #[serde(default)]
    pub vault_path: String,
    #[serde(default = "default_daily_folder")]
    pub daily_folder: String,
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default = "default_font_size")]
    pub editor_font_size: i64,
    #[serde(default = "default_true")]
    pub show_preview: bool,
}

fn default_daily_folder() -> String {
    "daily".to_string()
}
fn default_theme() -> String {
    "system".to_string()
}
fn default_font_size() -> i64 {
    15
}
fn default_true() -> bool {
    true
}

impl Default for VaultSettings {
    fn default() -> Self {
        Self {
            vault_path: String::new(),
            daily_folder: default_daily_folder(),
            theme: default_theme(),
            editor_font_size: default_font_size(),
            show_preview: true,
        }
    }
}
