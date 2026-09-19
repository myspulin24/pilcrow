//! The IPC surface.
//!
//! Thin by design: each command validates its inputs, calls into `pilcrow-core`,
//! and keeps the index in step with the file it just touched. Anything
//! resembling a decision -- what a tag is, how a link resolves, what the file
//! should contain -- happens in TypeScript before it gets here.

use std::path::PathBuf;

use tauri::{AppHandle, Manager, State};

use pilcrow_core::collections::{self, Collection};
use pilcrow_core::error::{CoreError, Result};
use pilcrow_core::explorer::{self, DroppedPaths, FolderTree, ScanLimits};
use pilcrow_core::settings;
use pilcrow_core::types::*;
use pilcrow_core::vault;

use crate::state::AppState;

const SEARCH_LIMIT: i64 = 500;

#[tauri::command]
pub fn vault_status(state: State<'_, AppState>) -> Result<VaultStatus> {
    state.status()
}

/// Má se po startu samo sáhnout na GitHub pro novou verzi?
///
/// Aktualizace jsou jediné síťové spojení, které Pilcrow navazuje, takže se
/// dají vypnout jedinou proměnnou v `.env` bez přestavování aplikace. Ruční
/// „Zkontrolovat aktualizace“ funguje dál -- vypíná se jen to automatické.
#[tauri::command]
pub fn auto_update_enabled() -> bool {
    match std::env::var("PILCROW_AUTO_UPDATE") {
        Ok(value) => !matches!(
            value.trim().to_ascii_lowercase().as_str(),
            "0" | "false" | "off" | "ne" | "no"
        ),
        Err(_) => true,
    }
}

/// Který balíček si má updater z `latest.json` vzít.
///
/// `None` znamená „nech rozhodnout plugin“, což je správně všude kromě Windows.
///
/// Na Windows vydáváme MSI i NSIS a plugin sáhne po MSI. Jenže MSI se instaluje
/// pro celý počítač a ptá se přes UAC, kdežto `setup.exe` běží jen pro
/// přihlášeného uživatele -- a přesně tak se Pilcrow instaluje. Kdyby se
/// aktualizovalo tím druhým, nepřepsalo by to stávající instalaci, ale
/// postavilo vedle ní druhou.
#[tauri::command]
pub fn updater_target() -> Option<String> {
    if cfg!(target_os = "windows") {
        // Stejné názvy architektur, jaké do manifestu píše tauri-bundler.
        let arch = match std::env::consts::ARCH {
            "x86" => "i686",
            other => other,
        };
        Some(format!("windows-{arch}-nsis"))
    } else {
        None
    }
}

#[tauri::command]
pub fn list_notes(state: State<'_, AppState>) -> Result<Vec<NoteSummary>> {
    state.with_index(|index| index.list(SEARCH_LIMIT))
}

#[tauri::command]
pub fn read_note(state: State<'_, AppState>, path: String) -> Result<NoteFile> {
    vault::read_note(&state.vault, &path)
}

#[tauri::command]
pub fn read_all_notes(state: State<'_, AppState>) -> Result<Vec<NoteFile>> {
    vault::read_all_notes(&state.vault)
}

#[tauri::command]
pub fn write_note(
    state: State<'_, AppState>,
    path: String,
    content: String,
    expected_hash: Option<String>,
    record: IndexRecord,
) -> Result<WriteResult> {
    let result = vault::write_note(&state.vault, &path, &content, expected_hash.as_deref())?;

    // Index with the hash and mtime the file really has, not what the caller
    // guessed, so the watcher can recognise this write as ours.
    let mut record = record;
    record.path = result.path.clone();
    record.hash = result.hash.clone();
    record.mtime = result.mtime;
    record.size = result.size;
    state.with_index(|index| index.upsert(&record))?;

    Ok(result)
}

#[tauri::command]
pub fn create_note(
    state: State<'_, AppState>,
    path: String,
    content: String,
    record: IndexRecord,
) -> Result<WriteResult> {
    let result = vault::create_note(&state.vault, &path, &content)?;

    let mut record = record;
    record.path = result.path.clone();
    record.hash = result.hash.clone();
    record.mtime = result.mtime;
    record.size = result.size;
    state.with_index(|index| index.upsert(&record))?;

    Ok(result)
}

#[tauri::command]
pub fn rename_note(state: State<'_, AppState>, from: String, to: String) -> Result<WriteResult> {
    let result = vault::rename_note(&state.vault, &from, &to)?;
    state.with_index(|index| index.rename(&from, &to))?;
    Ok(result)
}

#[tauri::command]
pub fn delete_note(state: State<'_, AppState>, path: String) -> Result<()> {
    vault::delete_note(&state.vault, &path)?;
    state.with_index(|index| index.remove(&path))
}

#[tauri::command]
pub fn search_notes(
    state: State<'_, AppState>,
    query: SearchQuery,
    limit: Option<i64>,
) -> Result<Vec<NoteSummary>> {
    let limit = limit.unwrap_or(200).clamp(1, SEARCH_LIMIT);
    state.with_index(|index| index.search(&query, limit))
}

#[tauri::command]
pub fn backlinks(state: State<'_, AppState>, path: String) -> Result<Vec<BacklinkRow>> {
    state.with_index(|index| {
        let title = index.title_for(&path)?.unwrap_or_default();
        index.backlinks(&path, &title)
    })
}

#[tauri::command]
pub fn rebuild_index(
    state: State<'_, AppState>,
    records: Vec<IndexRecord>,
) -> Result<RebuildResult> {
    state.with_index(|index| index.rebuild(&records))
}

#[tauri::command]
pub fn export_vault(state: State<'_, AppState>, destination: Option<String>) -> Result<ExportResult> {
    let Some(destination) = destination.filter(|value| !value.trim().is_empty()) else {
        return Err(CoreError::Unavailable(
            "Nevybral jsi cíl, takže se nic neexportovalo.".into(),
        ));
    };
    let target = PathBuf::from(destination);

    // Exporting into the vault itself would recurse; refuse it clearly.
    if let (Ok(real_target), Ok(real_root)) = (target.canonicalize(), state.vault.root().canonicalize()) {
        if real_target.starts_with(&real_root) {
            return Err(CoreError::InvalidName(
                "Vyber pro export složku mimo trezor.".into(),
            ));
        }
    }
    vault::export_vault(&state.vault, &target)
}

#[tauri::command]
pub fn import_folder(state: State<'_, AppState>, source: Option<String>) -> Result<ImportResult> {
    let Some(source) = source.filter(|value| !value.trim().is_empty()) else {
        return Err(CoreError::Unavailable(
            "Nevybral jsi složku, takže se nic neimportovalo.".into(),
        ));
    };
    vault::import_folder(&state.vault, &PathBuf::from(source))
}

#[tauri::command]
pub fn import_attachment(
    state: State<'_, AppState>,
    name: String,
    bytes: Vec<u8>,
) -> Result<serde_json::Value> {
    const MAX_ATTACHMENT_BYTES: usize = 64 * 1024 * 1024;
    if bytes.len() > MAX_ATTACHMENT_BYTES {
        return Err(CoreError::InvalidName(format!(
            "`{name}` je větší než limit 64 MB pro přílohy."
        )));
    }
    let path = vault::import_attachment(&state.vault, &name, &bytes)?;
    Ok(serde_json::json!({ "path": path }))
}

#[tauri::command]
pub fn load_settings(state: State<'_, AppState>) -> Result<VaultSettings> {
    let mut loaded = settings::load(&state.vault.settings_path());
    loaded.vault_path = state.vault.root().to_string_lossy().to_string();
    Ok(loaded)
}

#[tauri::command]
pub fn save_settings(
    state: State<'_, AppState>,
    settings: VaultSettings,
) -> Result<VaultSettings> {
    let mut next = settings;
    // The vault path is decided at start-up from `.env`; a client cannot move
    // the vault by writing to the settings file.
    next.vault_path = state.vault.root().to_string_lossy().to_string();
    pilcrow_core::settings::save(&state.vault.settings_path(), &next)
}

/// Show a path in the platform file manager. Best-effort by design.
#[tauri::command]
pub fn reveal_path(app: AppHandle, state: State<'_, AppState>, path: String) -> Result<()> {
    use tauri_plugin_opener::OpenerExt;

    // Three cases, in order: nothing asked for, a granted path anywhere on the
    // machine (the explorer and groups use these), or a vault-relative one.
    let target = if path.trim().is_empty() {
        state.vault.root().to_path_buf()
    } else {
        let absolute = PathBuf::from(&path);
        let granted = absolute.is_absolute()
            && absolute.exists()
            && state.with_access(|access| Ok(access.allows(&absolute)))?;

        if granted {
            absolute
        } else {
            match state.vault.resolve(&path) {
                Ok(resolved) if resolved.exists() => resolved,
                // A path we cannot resolve is not an error worth surfacing;
                // just open the vault folder instead.
                _ => state.vault.root().to_path_buf(),
            }
        }
    };

    app.opener()
        .reveal_item_in_dir(&target)
        .map_err(|error| CoreError::Unavailable(format!("Nepodařilo se otevřít správce souborů: {error}")))
}


// ---------------------------------------------------------------------------
// The file explorer.
//
// Reading outside the vault is gated on an explicit grant, and the only thing
// that grants one is a native file dialog. Picking and granting therefore
// happen in the same command: there is no way for the frontend to hand itself
// access to a path the user never chose.
//
// These commands are `async` because the blocking dialog API must not run on
// the main thread; Tauri runs async commands on its own thread pool.
// ---------------------------------------------------------------------------

const MARKDOWN_FILTERS: [&str; 4] = ["md", "markdown", "mdown", "mkd"];

/// Show a file picker. Returns the chosen path, or `None` when cancelled.
#[tauri::command]
pub async fn pick_markdown_file(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<String>> {
    use tauri_plugin_dialog::DialogExt;

    let picked = app
        .dialog()
        .file()
        .set_title("Otevřít soubor .md")
        .add_filter("Markdown", &MARKDOWN_FILTERS)
        .blocking_pick_file();

    let Some(path) = picked.and_then(|file| file.into_path().ok()) else {
        return Ok(None);
    };
    state.with_access(|access| {
        access.grant_file(&path);
        Ok(())
    })?;
    Ok(Some(path.to_string_lossy().to_string()))
}

/// Show a folder picker. Returns the chosen path, or `None` when cancelled.
#[tauri::command]
pub async fn pick_folder(app: AppHandle, state: State<'_, AppState>) -> Result<Option<String>> {
    use tauri_plugin_dialog::DialogExt;

    let picked = app
        .dialog()
        .file()
        .set_title("Otevřít složku se soubory .md")
        .blocking_pick_folder();

    let Some(path) = picked.and_then(|file| file.into_path().ok()) else {
        return Ok(None);
    };
    state.with_access(|access| {
        access.grant_dir(&path);
        Ok(())
    })?;
    Ok(Some(path.to_string_lossy().to_string()))
}

/// Re-open the folder the user had open when the app last closed.
///
/// Grants access before scanning, the same way `load_collections` re-grants
/// the files a group links to: the path got into settings through a native
/// dialog in an earlier run, and throwing that away on every restart is the
/// whole reason the explorer started empty. A path that no longer exists --
/// deleted, or on a machine the settings merely synced to -- grants nothing
/// and returns `None`, so the caller can stay quiet about it.
#[tauri::command]
pub fn reopen_folder(state: State<'_, AppState>, path: String) -> Result<Option<FolderTree>> {
    let target = PathBuf::from(&path);
    if !target.is_dir() {
        return Ok(None);
    }
    state.with_access(|access| {
        access.grant_dir(&target);
        Ok(())
    })?;
    explorer::scan_folder(&target, ScanLimits::default()).map(Some)
}

/// Re-open the single file the user had open when the app last closed.
///
/// Same bargain as [`reopen_folder`], narrowed to one file.
#[tauri::command]
pub fn reopen_file(state: State<'_, AppState>, path: String) -> Result<Option<String>> {
    let target = PathBuf::from(&path);
    if !target.is_file() {
        return Ok(None);
    }
    state.with_access(|access| {
        access.grant_file(&target);
        Ok(())
    })?;
    Ok(Some(path))
}

/// Scan a granted folder into a tree of folders and Markdown files.
#[tauri::command]
pub fn read_folder_tree(state: State<'_, AppState>, path: String) -> Result<FolderTree> {
    let target = PathBuf::from(&path);
    state.with_access(|access| access.require(&target))?;
    explorer::scan_folder(&target, ScanLimits::default())
}

/// Read a file the user opened through the explorer.
#[tauri::command]
pub fn read_external_file(state: State<'_, AppState>, path: String) -> Result<NoteFile> {
    let target = PathBuf::from(&path);
    state.with_access(|access| access.require(&target))?;
    vault::read_file_at(&target)
}

/// Save a file the user opened through the explorer.
///
/// Guarded by the same hash check as the vault: if the file changed on disk
/// since it was opened, this reports a conflict instead of overwriting.
#[tauri::command]
pub fn write_external_file(
    state: State<'_, AppState>,
    path: String,
    content: String,
    expected_hash: Option<String>,
) -> Result<WriteResult> {
    let target = PathBuf::from(&path);
    state.with_access(|access| access.require(&target))?;
    vault::write_file_at(&target, &content, expected_hash.as_deref())
}

/// Accept files or folders dropped onto the window from the OS.
///
/// The drop itself is the user's choice of path, so this grants access to what
/// was dropped and reports what it found.
#[tauri::command]
pub fn accept_dropped_paths(
    state: State<'_, AppState>,
    paths: Vec<String>,
) -> Result<DroppedPaths> {
    state.with_access(|access| Ok(explorer::accept_drop(access, &paths)))
}

// ---------------------------------------------------------------------------
// Collections: your own groups of files, from anywhere on the machine.
// ---------------------------------------------------------------------------

/// Read the collections stored in the vault.
///
/// Every linked external file is granted here, so a file you added to a
/// collection last week still opens today. Files that have since been deleted
/// are pruned, and the pruned list is written back.
#[tauri::command]
pub fn load_collections(state: State<'_, AppState>) -> Result<Vec<Collection>> {
    let path = state.vault.collections_path();
    let mut loaded = collections::load(&path);

    let removed = collections::prune_missing(&mut loaded);
    if !removed.is_empty() {
        collections::save(&path, &loaded)?;
    }

    state.with_access(|access| {
        collections::grant_linked_files(access, &loaded);
        Ok(())
    })?;
    Ok(loaded)
}

/// Replace the stored collections.
///
/// The frontend owns the list and sends the whole thing; it is small, and one
/// write means the file on disk is never a half-applied edit.
#[tauri::command]
pub fn save_collections(
    state: State<'_, AppState>,
    collections_input: Vec<Collection>,
) -> Result<Vec<Collection>> {
    collections::save(&state.vault.collections_path(), &collections_input)?;
    state.with_access(|access| {
        collections::grant_linked_files(access, &collections_input);
        Ok(())
    })?;
    Ok(collections_input)
}

/// Delete a file the explorer is showing. Refuses anything not granted.
#[tauri::command]
pub fn delete_external_file(state: State<'_, AppState>, path: String) -> Result<()> {
    let target = PathBuf::from(&path);
    state.with_access(|access| access.require(&target))?;
    vault::delete_file_at(&target)
}

/// Move a file the explorer is showing into the vault.
///
/// Requires access first: the only way a path gets here is that the user
/// opened it in a dialog or dropped it on the window, and that must stay the
/// only way. Returns the vault-relative path it landed on, which is not always
/// the name it had -- the vault never overwrites.
#[tauri::command]
pub fn move_into_vault(state: State<'_, AppState>, path: String) -> Result<String> {
    let source = PathBuf::from(&path);
    state.with_access(|access| access.require(&source))?;
    vault::move_into_vault(&state.vault, &source)
}

/// Everything the frontend can call.
pub fn handlers() -> impl Fn(tauri::ipc::Invoke) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        vault_status,
        auto_update_enabled,
        updater_target,
        list_notes,
        read_note,
        read_all_notes,
        write_note,
        create_note,
        rename_note,
        delete_note,
        search_notes,
        backlinks,
        rebuild_index,
        export_vault,
        import_folder,
        import_attachment,
        load_settings,
        save_settings,
        reveal_path,
        pick_markdown_file,
        pick_folder,
        reopen_folder,
        reopen_file,
        read_folder_tree,
        read_external_file,
        write_external_file,
        accept_dropped_paths,
        load_collections,
        save_collections,
        delete_external_file,
        move_into_vault,
        crate::about::app_info,
        crate::assistant::assistant_status,
        crate::assistant::assistant_install_command,
        crate::assistant::assistant_install,
        crate::assistant::assistant_ask,
        crate::assistant::assistant_cancel,
        crate::assistant::assistant_login,
        crate::assistant::assistant_login_code,
        crate::assistant::assistant_login_cancel,
        crate::assistant::assistant_logout
    ]
}

/// Used by `lib.rs` to seed and index a vault on first run.
pub fn bootstrap_vault(app: &AppHandle) -> Result<()> {
    let state = app
        .try_state::<AppState>()
        .ok_or_else(|| CoreError::Io("Stav trezoru nebyl inicializován.".into()))?;

    let seeded = vault::seed_if_empty(&state.vault)?;
    let needs_index = seeded || state.with_index(|index| index.note_count())? == 0;
    if !needs_index {
        return Ok(());
    }

    // A first-run index is built from file text alone. It gets replaced by a
    // richer one the moment the frontend runs its own parse, but it means
    // search works immediately rather than after a round trip.
    let files = vault::read_all_notes(&state.vault)?;
    let records: Vec<IndexRecord> = files.iter().map(minimal_record).collect();
    state.with_index(|index| index.rebuild(&records))?;
    Ok(())
}

/// A best-effort index row derived without the TypeScript parser.
fn minimal_record(file: &NoteFile) -> IndexRecord {
    let body = strip_frontmatter(&file.content);
    let title = file
        .path
        .rsplit('/')
        .next()
        .unwrap_or(&file.path)
        .trim_end_matches(".md")
        .to_string();

    IndexRecord {
        path: file.path.clone(),
        id: file.hash[..16.min(file.hash.len())].to_string(),
        title,
        excerpt: body.chars().take(180).collect(),
        body,
        tags: Vec::new(),
        links: Vec::new(),
        pinned: false,
        created: String::new(),
        updated: String::new(),
        has_tasks: false,
        hash: file.hash.clone(),
        mtime: file.mtime,
        size: file.size,
    }
}

fn strip_frontmatter(source: &str) -> String {
    let normalized = source.replace("\r\n", "\n");
    if !normalized.starts_with("---\n") {
        return normalized;
    }
    match normalized[4..].find("\n---") {
        Some(end) => normalized[4 + end + 4..].trim_start_matches('\n').to_string(),
        None => normalized,
    }
}
