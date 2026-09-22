//! Types shared with the frontend.
//!
//! All of them serialise as camelCase so the TypeScript definitions in
//! `src/vault/api.ts` and `src/core/types.ts` match field-for-field.

use std::collections::HashMap;

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
    /// `split` | `source` | `preview` -- co se ukáže po otevření poznámky.
    #[serde(default = "default_view_mode")]
    pub default_view_mode: String,
    /// Má být po startu vidět levý panel se skupinami a štítky?
    #[serde(default = "default_true")]
    pub show_sidebar: bool,
    /// Má být nad editorem lišta formátování?
    #[serde(default = "default_true")]
    pub show_toolbar: bool,
    /// Kontrolovat po startu novou verzi.
    ///
    /// `PILCROW_AUTO_UPDATE=0` v `.env` to přebije i tehdy, když je tu `true`:
    /// proměnná prostředí je tvrdší, aby šlo aktualizace vypnout i tam, kde
    /// uživatel k nastavení aplikace nemá přístup.
    #[serde(default = "default_true")]
    pub check_updates: bool,
    /// Naposledy otevřená složka v průzkumníku, aby po startu byla znovu.
    ///
    /// Je to absolutní cesta, a proto se snese, že na jiném počítači
    /// neexistuje -- aplikace ji tam prostě neotevře. Ukládá se sem, a ne
    /// bokem, aby nastavení zůstalo na jednom místě; cena je, že se s
    /// trezorem přenese cesta, která jinde nic neznamená.
    #[serde(default)]
    pub last_folder: String,
    /// Všechny složky otevřené v levém sloupci, aktivní první.
    ///
    /// Od 0.10 jich může být otevřených víc naráz. `last_folder` zůstává
    /// první položkou tohohle seznamu, aby nastavení uměla přečíst i starší
    /// verze aplikace -- ty otevřou aspoň tu, ve které se pracovalo.
    #[serde(default)]
    pub open_folders: Vec<String>,
    /// Naposledy otevřený samostatný soubor, když nebyla otevřená složka.
    #[serde(default)]
    pub last_file: String,
    /// Šířka levého sloupce v bodech. Uživatel si ji roztahuje myší.
    #[serde(default = "default_workspace_width")]
    pub workspace_width: i64,
    /// Šířka postranního panelu se skupinami a štítky v bodech.
    #[serde(default = "default_sidebar_width")]
    pub sidebar_width: i64,
    /// Výšky jednotlivých bloků v levém sloupci, klíč -> body.
    ///
    /// Chybějící klíč znamená „podle obsahu“, což je výchozí chování. Mapa,
    /// ne čtyři pole: bloků může přibýt a stará nastavení musí dál fungovat.
    #[serde(default)]
    pub section_heights: HashMap<String, i64>,
    /// Kam se stahují repozitáře vybrané v „Otevřít repozitář“.
    ///
    /// Prázdné, dokud si uživatel složku nevybere v dialogu -- tam se zároveň
    /// udělí přístup. Pilcrow si žádnou cestu nevymýšlí sám: tohle je jediné
    /// místo, kam aplikace zapisuje mimo trezor.
    #[serde(default)]
    pub repos_folder: String,
    /// Smí panel asistenta posílat text poznámky ven?
    ///
    /// Výchozí `false` je záměr, ne opatrnost: bez tohohle přepínače z počítače
    /// neodchází nic než dotaz na novou verzi, a to má zůstat pravda, dokud
    /// někdo výslovně neřekne jinak.
    #[serde(default)]
    pub assistant_enabled: bool,
    /// `opus`, `sonnet`, nebo prázdné = nech rozhodnout Claude Code.
    #[serde(default)]
    pub assistant_model: String,
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
fn default_view_mode() -> String {
    "split".to_string()
}
fn default_sidebar_width() -> i64 {
    220
}
fn default_workspace_width() -> i64 {
    300
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
            default_view_mode: default_view_mode(),
            show_sidebar: true,
            show_toolbar: true,
            check_updates: true,
            last_folder: String::new(),
            open_folders: Vec::new(),
            last_file: String::new(),
            workspace_width: default_workspace_width(),
            sidebar_width: default_sidebar_width(),
            section_heights: HashMap::new(),
            repos_folder: String::new(),
            assistant_enabled: false,
            assistant_model: String::new(),
        }
    }
}
