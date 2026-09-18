//! File operations on the vault.
//!
//! Two rules run through everything here:
//!
//! 1. **Never lose text.** Writes are atomic (temp file + rename), and a write
//!    whose `expected_hash` no longer matches the file on disk is refused and
//!    turned into a conflict rather than an overwrite.
//! 2. **The folder is the format.** Nothing is stored anywhere else, so export
//!    is a copy and import is a copy back.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use sha2::{Digest, Sha256};
use walkdir::WalkDir;

use crate::error::{ConflictPayload, CoreError, Result};
use crate::paths::{sanitize_segment, VaultPaths, ATTACHMENTS_DIR, META_DIR};
use crate::types::{ExportResult, ImportResult, NoteFile, RenamedPath, WriteResult};

pub const NOTE_EXTENSION: &str = "md";

/// Lowercase hex SHA-256. Matches `hashText` in `src/core/hash.ts` exactly.
pub fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

fn mtime_millis(path: &Path) -> i64 {
    fs::metadata(path)
        .and_then(|meta| meta.modified())
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|delta| delta.as_millis() as i64)
        .unwrap_or(0)
}

pub fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|delta| delta.as_millis() as i64)
        .unwrap_or(0)
}

fn is_note(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case(NOTE_EXTENSION))
        .unwrap_or(false)
}

/// Read a file as UTF-8, replacing invalid sequences rather than failing.
///
/// A note that was saved in a legacy encoding should still open -- losing a
/// stray byte is far better than refusing to show someone their own writing.
fn read_text(path: &Path) -> Result<String> {
    let bytes = fs::read(path)?;
    Ok(match String::from_utf8(bytes) {
        Ok(text) => text,
        Err(error) => String::from_utf8_lossy(error.as_bytes()).into_owned(),
    })
}

fn to_note_file(relative: &str, absolute: &Path) -> Result<NoteFile> {
    let content = read_text(absolute)?;
    Ok(NoteFile {
        path: relative.to_string(),
        hash: sha256_hex(content.as_bytes()),
        mtime: mtime_millis(absolute),
        size: content.len() as i64,
        content,
    })
}

pub fn read_note(vault: &VaultPaths, relative: &str) -> Result<NoteFile> {
    let absolute = vault.resolve(relative)?;
    if !absolute.exists() {
        return Err(CoreError::NotFound(format!("Poznámka {relative} neexistuje")));
    }
    to_note_file(relative, &absolute)
}

/// Every `.md` file in the vault, excluding Pilcrow's own metadata folder.
pub fn read_all_notes(vault: &VaultPaths) -> Result<Vec<NoteFile>> {
    let mut out = Vec::new();
    for entry in WalkDir::new(vault.root())
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| {
            let name = entry.file_name().to_string_lossy();
            // Skip the index folder and anything else hidden, but keep going
            // through ordinary folders.
            !(entry.depth() > 0 && entry.file_type().is_dir() && (name == META_DIR || name.starts_with('.')))
        })
        .filter_map(std::result::Result::ok)
    {
        if !entry.file_type().is_file() || !is_note(entry.path()) {
            continue;
        }
        let Some(relative) = vault.relativize(entry.path()) else {
            continue;
        };
        if vault.is_internal(&relative) {
            continue;
        }
        match to_note_file(&relative, entry.path()) {
            Ok(file) => out.push(file),
            // One unreadable file must not stop the whole vault from loading.
            Err(error) => log_skip(&relative, &error),
        }
    }
    out.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(out)
}

fn log_skip(relative: &str, error: &CoreError) {
    eprintln!("pilcrow: přeskakuji {relative}: {error}");
}

/// Write bytes atomically: temp file in the same directory, then rename.
///
/// Same-directory matters -- a rename across file systems is a copy, which is
/// not atomic and would leave a half-written note if the process died.
fn atomic_write(absolute: &Path, content: &str) -> Result<()> {
    let parent = absolute
        .parent()
        .ok_or_else(|| CoreError::Io("Poznámka nemá nadřazenou složku.".into()))?;
    fs::create_dir_all(parent)?;

    let file_name = absolute
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| "note".to_string());
    let temp = parent.join(format!(".{file_name}.{}.tmp", now_millis()));

    {
        let mut handle = fs::File::create(&temp)?;
        handle.write_all(content.as_bytes())?;
        // Make the data durable before it becomes visible under the real name.
        handle.sync_all()?;
    }

    match fs::rename(&temp, absolute) {
        Ok(()) => Ok(()),
        Err(error) => {
            let _ = fs::remove_file(&temp);
            Err(error.into())
        }
    }
}

/// Write a note, refusing to overwrite an unexpected change.
///
/// `expected_hash` is the hash the editor loaded from. `None` means "I know,
/// overwrite anyway" and is only sent after the user has resolved a conflict.
pub fn write_note(
    vault: &VaultPaths,
    relative: &str,
    content: &str,
    expected_hash: Option<&str>,
) -> Result<WriteResult> {
    let absolute = vault.resolve(relative)?;

    if let Some(expected) = expected_hash {
        if absolute.exists() {
            let on_disk = read_text(&absolute)?;
            let disk_hash = sha256_hex(on_disk.as_bytes());
            if disk_hash != expected {
                return Err(CoreError::Conflict(Box::new(ConflictPayload {
                    path: relative.to_string(),
                    local: content.to_string(),
                    disk: on_disk,
                    base_hash: expected.to_string(),
                    disk_hash,
                    detected_at: now_millis(),
                })));
            }
        }
    }

    atomic_write(&absolute, content)?;
    Ok(WriteResult {
        path: relative.to_string(),
        hash: sha256_hex(content.as_bytes()),
        mtime: mtime_millis(&absolute),
        size: content.len() as i64,
    })
}

pub fn create_note(vault: &VaultPaths, relative: &str, content: &str) -> Result<WriteResult> {
    let absolute = vault.resolve(relative)?;
    if absolute.exists() {
        return Err(CoreError::Duplicate(format!(
            "Poznámka {relative} už existuje"
        )));
    }
    atomic_write(&absolute, content)?;
    Ok(WriteResult {
        path: relative.to_string(),
        hash: sha256_hex(content.as_bytes()),
        mtime: mtime_millis(&absolute),
        size: content.len() as i64,
    })
}

pub fn rename_note(vault: &VaultPaths, from: &str, to: &str) -> Result<WriteResult> {
    let source = vault.resolve(from)?;
    let target = vault.resolve(to)?;
    if !source.exists() {
        return Err(CoreError::NotFound(format!("Poznámka {from} neexistuje")));
    }
    if target.exists() {
        return Err(CoreError::Duplicate(format!(
            "Poznámka {to} už existuje"
        )));
    }
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::rename(&source, &target)?;

    let content = read_text(&target)?;
    Ok(WriteResult {
        path: to.to_string(),
        hash: sha256_hex(content.as_bytes()),
        mtime: mtime_millis(&target),
        size: content.len() as i64,
    })
}

pub fn delete_note(vault: &VaultPaths, relative: &str) -> Result<()> {
    let absolute = vault.resolve(relative)?;
    if !absolute.exists() {
        return Err(CoreError::NotFound(format!("Poznámka {relative} neexistuje")));
    }
    fs::remove_file(&absolute)?;
    Ok(())
}

const ALLOWED_ATTACHMENT_EXTENSIONS: [&str; 9] = [
    "png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "svg", "pdf",
];

/// Copy bytes into `attachments/` under a safe, timestamped name.
pub fn import_attachment(vault: &VaultPaths, name: &str, bytes: &[u8]) -> Result<String> {
    let dot = name.rfind('.');
    let raw_extension = dot
        .map(|index| name[index + 1..].to_ascii_lowercase())
        .unwrap_or_default();
    let extension = if ALLOWED_ATTACHMENT_EXTENSIONS.contains(&raw_extension.as_str()) {
        raw_extension
    } else {
        return Err(CoreError::InvalidName(format!(
            "`{name}` není podporovaný typ přílohy ({}).",
            ALLOWED_ATTACHMENT_EXTENSIONS.join(", ")
        )));
    };

    let stem = sanitize_segment(dot.map(|index| &name[..index]).unwrap_or(name), "attachment");
    fs::create_dir_all(vault.attachments_dir())?;

    let mut candidate = format!("{}-{}.{}", now_millis(), stem, extension);
    let mut counter = 1;
    while vault.attachments_dir().join(&candidate).exists() {
        candidate = format!("{}-{}-{}.{}", now_millis(), stem, counter, extension);
        counter += 1;
    }

    let target = vault.attachments_dir().join(&candidate);
    fs::write(&target, bytes)?;
    Ok(format!("{ATTACHMENTS_DIR}/{candidate}"))
}

/// Copy the whole vault -- notes and attachments, not the index -- to a folder.
pub fn export_vault(vault: &VaultPaths, destination: &Path) -> Result<ExportResult> {
    fs::create_dir_all(destination)?;

    let mut files = 0i64;
    let mut bytes = 0i64;

    for entry in WalkDir::new(vault.root())
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| {
            let name = entry.file_name().to_string_lossy();
            !(entry.depth() > 0 && entry.file_type().is_dir() && name == META_DIR)
        })
        .filter_map(std::result::Result::ok)
    {
        if !entry.file_type().is_file() {
            continue;
        }
        let Some(relative) = vault.relativize(entry.path()) else {
            continue;
        };
        if relative.starts_with(&format!("{META_DIR}/")) {
            continue;
        }
        // Never copy the temp files an interrupted atomic write could leave.
        if relative.ends_with(".tmp") {
            continue;
        }

        let target = destination.join(&relative);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)?;
        }
        let copied = fs::copy(entry.path(), &target)?;
        files += 1;
        bytes += copied as i64;
    }

    Ok(ExportResult {
        destination: destination.to_string_lossy().to_string(),
        files,
        bytes,
    })
}

/// Copy `.md` files from a folder into the vault, never overwriting.
pub fn import_folder(vault: &VaultPaths, source: &Path) -> Result<ImportResult> {
    if !source.is_dir() {
        return Err(CoreError::NotFound(format!(
            "{} není složka.",
            source.display()
        )));
    }
    vault.ensure()?;

    let mut imported = 0i64;
    let mut skipped = 0i64;
    let mut renamed = Vec::new();

    for entry in WalkDir::new(source)
        .follow_links(false)
        .into_iter()
        .filter_map(std::result::Result::ok)
    {
        if !entry.file_type().is_file() {
            continue;
        }
        let is_attachment = entry
            .path()
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ALLOWED_ATTACHMENT_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str()))
            .unwrap_or(false);
        if !is_note(entry.path()) && !is_attachment {
            continue;
        }

        let Ok(relative) = entry.path().strip_prefix(source) else {
            skipped += 1;
            continue;
        };

        // Sanitise every segment; a folder of notes from elsewhere may contain
        // names this platform cannot represent.
        let mut segments: Vec<String> = Vec::new();
        for part in relative.components() {
            let std::path::Component::Normal(value) = part else {
                continue;
            };
            segments.push(sanitize_segment(&value.to_string_lossy(), "bez-nazvu"));
        }
        if segments.is_empty() {
            skipped += 1;
            continue;
        }
        let original = relative.to_string_lossy().replace('\\', "/");
        let mut target_relative = segments.join("/");

        if vault.resolve(&target_relative).is_err() {
            skipped += 1;
            continue;
        }

        // Never clobber an existing note: add ` 2`, ` 3`, ...
        let mut attempt = 2;
        while vault.resolve(&target_relative)?.exists() {
            let (stem, extension) = split_extension(&segments.join("/"));
            target_relative = format!("{stem} {attempt}{extension}");
            attempt += 1;
            if attempt > 100 {
                break;
            }
        }
        if original != target_relative {
            renamed.push(RenamedPath {
                from: original,
                to: target_relative.clone(),
            });
        }

        let target = vault.resolve(&target_relative)?;
        if target.exists() {
            skipped += 1;
            continue;
        }
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)?;
        }
        match fs::copy(entry.path(), &target) {
            Ok(_) => imported += 1,
            Err(_) => skipped += 1,
        }
    }

    Ok(ImportResult {
        imported,
        skipped,
        renamed,
    })
}

fn split_extension(path: &str) -> (String, String) {
    match path.rfind('.') {
        Some(index) if index > path.rfind('/').map(|slash| slash + 1).unwrap_or(0) => {
            (path[..index].to_string(), path[index..].to_string())
        }
        _ => (path.to_string(), String::new()),
    }
}

/// Seed a brand-new vault so the first run is never an empty window.
pub fn seed_if_empty(vault: &VaultPaths) -> Result<bool> {
    vault.ensure()?;
    if !read_all_notes(vault)?.is_empty() {
        return Ok(false);
    }
    let welcome = include_str!("welcome.md");
    create_note(vault, "Vítej v Pilcrow.md", welcome)?;
    Ok(true)
}

/// Read any file by absolute path.
///
/// Used for files opened through the explorer, which live outside the vault.
/// The caller is responsible for checking `AccessRegistry` first: this
/// function deliberately knows nothing about permission, so there is exactly
/// one place where that decision is made.
pub fn read_file_at(absolute: &Path) -> Result<NoteFile> {
    if !absolute.exists() {
        return Err(CoreError::NotFound(format!("{} už neexistuje.", absolute.display())));
    }
    if !absolute.is_file() {
        return Err(CoreError::InvalidName(format!("{} není soubor.", absolute.display())));
    }
    to_note_file(&absolute.to_string_lossy(), absolute)
}

/// Write any file by absolute path, with the same guard the vault uses:
/// a stale `expected_hash` produces a conflict instead of an overwrite.
pub fn write_file_at(
    absolute: &Path,
    content: &str,
    expected_hash: Option<&str>,
) -> Result<WriteResult> {
    if let Some(expected) = expected_hash {
        if absolute.exists() {
            let on_disk = read_text(absolute)?;
            let disk_hash = sha256_hex(on_disk.as_bytes());
            if disk_hash != expected {
                return Err(CoreError::Conflict(Box::new(ConflictPayload {
                    path: absolute.to_string_lossy().to_string(),
                    local: content.to_string(),
                    disk: on_disk,
                    base_hash: expected.to_string(),
                    disk_hash,
                    detected_at: now_millis(),
                })));
            }
        }
    }

    atomic_write(absolute, content)?;
    Ok(WriteResult {
        path: absolute.to_string_lossy().to_string(),
        hash: sha256_hex(content.as_bytes()),
        mtime: mtime_millis(absolute),
        size: content.len() as i64,
    })
}

/// Delete a file by absolute path.
///
/// Used by the explorer's context menu. As with reading, the caller checks
/// `AccessRegistry` first -- this function only refuses to delete something
/// that is not a plain file, so a stray path cannot take out a directory.
pub fn delete_file_at(absolute: &Path) -> Result<()> {
    if !absolute.exists() {
        return Err(CoreError::NotFound(format!("{} už neexistuje.", absolute.display())));
    }
    if !absolute.is_file() {
        return Err(CoreError::InvalidName(format!(
            "{} není soubor, takže se nic nesmazalo.",
            absolute.display()
        )));
    }
    std::fs::remove_file(absolute)?;
    Ok(())
}

/// Resolve the vault root: explicit setting, then `PILCROW_VAULT_PATH`, then the
/// platform documents folder.
pub fn default_vault_root(documents_dir: Option<PathBuf>) -> PathBuf {
    if let Ok(configured) = std::env::var("PILCROW_VAULT_PATH") {
        let trimmed = configured.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed);
        }
    }
    documents_dir
        .unwrap_or_else(|| PathBuf::from("."))
        .join("Pilcrow")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vault() -> (tempfile::TempDir, VaultPaths) {
        let dir = tempfile::tempdir().unwrap();
        let vault = VaultPaths::new(dir.path());
        vault.ensure().unwrap();
        (dir, vault)
    }

    #[test]
    fn hash_matches_known_vector() {
        // Same vector the TypeScript implementation is tested against.
        assert_eq!(
            sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert_eq!(
            sha256_hex(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    #[test]
    fn write_then_read_round_trips() {
        let (_dir, vault) = vault();
        let written = write_note(&vault, "notes/idea.md", "# Idea\n", None).unwrap();
        let read = read_note(&vault, "notes/idea.md").unwrap();
        assert_eq!(read.content, "# Idea\n");
        assert_eq!(read.hash, written.hash);
    }

    #[test]
    fn write_is_refused_when_the_file_changed_underneath() {
        let (_dir, vault) = vault();
        let first = write_note(&vault, "note.md", "original\n", None).unwrap();

        // Someone else edits the file.
        write_note(&vault, "note.md", "from my phone\n", None).unwrap();

        let error = write_note(&vault, "note.md", "my edit\n", Some(&first.hash)).unwrap_err();
        match error {
            CoreError::Conflict(payload) => {
                assert_eq!(payload.path, "note.md");
                assert_eq!(payload.local, "my edit\n");
                assert_eq!(payload.disk, "from my phone\n");
                assert_eq!(payload.base_hash, first.hash);
            }
            other => panic!("expected a conflict, got {other:?}"),
        }
        // Nothing was overwritten.
        assert_eq!(read_note(&vault, "note.md").unwrap().content, "from my phone\n");
    }

    #[test]
    fn write_succeeds_when_the_hash_still_matches() {
        let (_dir, vault) = vault();
        let first = write_note(&vault, "note.md", "one\n", None).unwrap();
        let second = write_note(&vault, "note.md", "two\n", Some(&first.hash)).unwrap();
        assert_eq!(second.hash, sha256_hex(b"two\n"));
        assert_eq!(read_note(&vault, "note.md").unwrap().content, "two\n");
    }

    #[test]
    fn forced_write_overwrites_after_a_resolved_conflict() {
        let (_dir, vault) = vault();
        write_note(&vault, "note.md", "disk\n", None).unwrap();
        write_note(&vault, "note.md", "mine\n", None).unwrap();
        assert_eq!(read_note(&vault, "note.md").unwrap().content, "mine\n");
    }

    #[test]
    fn create_refuses_to_clobber() {
        let (_dir, vault) = vault();
        create_note(&vault, "note.md", "a").unwrap();
        assert!(matches!(
            create_note(&vault, "note.md", "b"),
            Err(CoreError::Duplicate(_))
        ));
    }

    #[test]
    fn path_traversal_is_refused_at_the_file_layer() {
        let (_dir, vault) = vault();
        assert!(write_note(&vault, "../escape.md", "nope", None).is_err());
        assert!(read_note(&vault, "../../etc/passwd").is_err());
        assert!(delete_note(&vault, "..\\escape.md").is_err());
    }

    #[test]
    fn read_all_notes_skips_the_index_folder() {
        let (_dir, vault) = vault();
        create_note(&vault, "a.md", "a").unwrap();
        create_note(&vault, "sub/b.md", "b").unwrap();
        fs::write(vault.meta_dir().join("notes.md"), "not a note").unwrap();
        fs::write(vault.root().join("readme.txt"), "not markdown").unwrap();

        let notes = read_all_notes(&vault).unwrap();
        let paths: Vec<_> = notes.iter().map(|note| note.path.as_str()).collect();
        assert_eq!(paths, vec!["a.md", "sub/b.md"]);
    }

    #[test]
    fn rename_moves_the_file_and_keeps_the_text() {
        let (_dir, vault) = vault();
        create_note(&vault, "old.md", "content\n").unwrap();
        let result = rename_note(&vault, "old.md", "folder/new.md").unwrap();
        assert_eq!(result.path, "folder/new.md");
        assert!(read_note(&vault, "old.md").is_err());
        assert_eq!(read_note(&vault, "folder/new.md").unwrap().content, "content\n");
    }

    #[test]
    fn export_copies_notes_and_attachments_but_not_the_index() {
        let (_dir, vault) = vault();
        create_note(&vault, "a.md", "a").unwrap();
        create_note(&vault, "sub/b.md", "b").unwrap();
        import_attachment(&vault, "cat.png", b"\x89PNG").unwrap();
        fs::write(vault.index_path(), "sqlite bytes").unwrap();

        let out = tempfile::tempdir().unwrap();
        let result = export_vault(&vault, out.path()).unwrap();

        assert_eq!(result.files, 3);
        assert!(out.path().join("a.md").exists());
        assert!(out.path().join("sub/b.md").exists());
        assert!(!out.path().join(META_DIR).join("index.sqlite").exists());
    }

    #[test]
    fn import_copies_markdown_and_never_overwrites() {
        let (_dir, vault) = vault();
        create_note(&vault, "note.md", "mine\n").unwrap();

        let source = tempfile::tempdir().unwrap();
        fs::write(source.path().join("note.md"), "theirs\n").unwrap();
        fs::write(source.path().join("fresh.md"), "new\n").unwrap();
        fs::write(source.path().join("ignored.txt"), "skip\n").unwrap();

        let result = import_folder(&vault, source.path()).unwrap();
        assert_eq!(result.imported, 2);
        assert_eq!(read_note(&vault, "note.md").unwrap().content, "mine\n");
        assert_eq!(read_note(&vault, "note 2.md").unwrap().content, "theirs\n");
        assert_eq!(read_note(&vault, "fresh.md").unwrap().content, "new\n");
    }

    #[test]
    fn attachments_reject_unknown_types() {
        let (_dir, vault) = vault();
        assert!(import_attachment(&vault, "payload.exe", b"MZ").is_err());
        let path = import_attachment(&vault, "my photo.PNG", b"\x89PNG").unwrap();
        assert!(path.starts_with("attachments/"));
        assert!(path.ends_with(".png"));
    }

    #[test]
    fn reads_and_writes_a_file_outside_the_vault() {
        let elsewhere = tempfile::tempdir().unwrap();
        let file = elsewhere.path().join("notes.md");
        std::fs::write(&file, "# outside
").unwrap();

        let read = read_file_at(&file).unwrap();
        assert_eq!(read.content, "# outside
");
        assert_eq!(read.hash, sha256_hex(b"# outside
"));

        write_file_at(&file, "# edited
", Some(&read.hash)).unwrap();
        assert_eq!(read_file_at(&file).unwrap().content, "# edited
");
    }

    #[test]
    fn an_external_write_is_refused_when_the_file_changed_underneath() {
        let elsewhere = tempfile::tempdir().unwrap();
        let file = elsewhere.path().join("notes.md");
        std::fs::write(&file, "original
").unwrap();
        let base = read_file_at(&file).unwrap().hash;

        std::fs::write(&file, "changed elsewhere
").unwrap();

        assert!(matches!(
            write_file_at(&file, "mine
", Some(&base)),
            Err(CoreError::Conflict(_))
        ));
        // Still untouched.
        assert_eq!(read_file_at(&file).unwrap().content, "changed elsewhere
");
    }

    #[test]
    fn reading_a_missing_external_file_reports_not_found() {
        let elsewhere = tempfile::tempdir().unwrap();
        assert!(matches!(
            read_file_at(&elsewhere.path().join("nope.md")),
            Err(CoreError::NotFound(_))
        ));
        assert!(read_file_at(elsewhere.path()).is_err(), "a directory is not a file");
    }

    #[test]
    fn deletes_a_file_outside_the_vault_but_never_a_directory() {
        let elsewhere = tempfile::tempdir().unwrap();
        let file = elsewhere.path().join("notes.md");
        std::fs::write(&file, "# bye").unwrap();

        delete_file_at(&file).unwrap();
        assert!(!file.exists());

        // Second delete reports the truth rather than pretending.
        assert!(matches!(delete_file_at(&file), Err(CoreError::NotFound(_))));
        // A directory is refused outright.
        assert!(delete_file_at(elsewhere.path()).is_err());
        assert!(elsewhere.path().exists());
    }

    #[test]
    fn seeding_only_happens_once() {
        let (_dir, vault) = vault();
        assert!(seed_if_empty(&vault).unwrap());
        assert!(!seed_if_empty(&vault).unwrap());
        assert_eq!(read_all_notes(&vault).unwrap().len(), 1);
    }
}
