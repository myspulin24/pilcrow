//! Path safety.
//!
//! This is the last gate before anything touches the file system. The rule is
//! simple and absolute: a vault-relative path supplied by the frontend must
//! resolve to a location *inside* the vault, or it is rejected. The TypeScript
//! side sanitises names too, but that is a convenience -- this is the check
//! that actually matters, because it also runs against anything an attacker
//! could inject into an IPC call.

use std::path::{Component, Path, PathBuf};

use crate::error::{CoreError, Result};

/// Folder inside the vault that holds images and other binaries.
pub const ATTACHMENTS_DIR: &str = "attachments";
/// Folder inside the vault that holds Pilcrow's own rebuildable state.
pub const META_DIR: &str = ".pilcrow";
pub const INDEX_FILE: &str = "index.sqlite";
pub const SETTINGS_FILE: &str = "settings.json";
pub const COLLECTIONS_FILE: &str = "collections.json";

const MAX_SEGMENT_LEN: usize = 120;
const RESERVED: [&str; 22] = [
    "con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8",
    "com9", "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
];

/// True when a single path segment is safe on macOS, Windows and iCloud Drive.
pub fn is_safe_segment(segment: &str) -> bool {
    if segment.is_empty() || segment.len() > MAX_SEGMENT_LEN {
        return false;
    }
    if segment == "." || segment == ".." {
        return false;
    }
    // Leading dots are reserved for Pilcrow's own metadata folder.
    if segment.starts_with(' ') || (segment.starts_with('.') && segment != META_DIR) {
        return false;
    }
    if segment.ends_with(' ') || segment.ends_with('.') {
        return false;
    }
    if segment
        .chars()
        .any(|c| matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') || c.is_control())
    {
        return false;
    }
    let stem = segment.split('.').next().unwrap_or(segment).to_ascii_lowercase();
    !RESERVED.contains(&stem.as_str())
}

/// Normalise a vault-relative path: POSIX separators, no `.`/`..`, no prefix.
///
/// Returns `InvalidName` for anything that is absolute, escapes the vault, or
/// contains an unusable segment.
pub fn normalize_relative(input: &str) -> Result<String> {
    let cleaned = input.replace('\\', "/");
    if cleaned.trim().is_empty() {
        return Err(CoreError::InvalidName("Cesta nemůže být prázdná.".into()));
    }
    if cleaned.starts_with('/') || cleaned.starts_with("//") {
        return Err(CoreError::InvalidName(format!(
            "`{input}` je absolutní cesta; cesty v trezoru musí být relativní."
        )));
    }
    // Windows drive letters and UNC prefixes.
    if cleaned.len() >= 2 && cleaned.as_bytes()[1] == b':' {
        return Err(CoreError::InvalidName(format!(
            "`{input}` je absolutní cesta; cesty v trezoru musí být relativní."
        )));
    }

    let mut segments: Vec<&str> = Vec::new();
    for segment in cleaned.split('/') {
        if segment.is_empty() || segment == "." {
            continue;
        }
        if segment == ".." {
            return Err(CoreError::InvalidName(format!(
                "`{input}` se pokouší opustit trezor."
            )));
        }
        if !is_safe_segment(segment) {
            return Err(CoreError::InvalidName(format!(
                "`{segment}` není použitelný název souboru."
            )));
        }
        segments.push(segment);
    }

    if segments.is_empty() {
        return Err(CoreError::InvalidName("Cesta nemůže být prázdná.".into()));
    }
    Ok(segments.join("/"))
}

/// Locations inside one vault.
#[derive(Debug, Clone)]
pub struct VaultPaths {
    root: PathBuf,
}

impl VaultPaths {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn meta_dir(&self) -> PathBuf {
        self.root.join(META_DIR)
    }

    pub fn index_path(&self) -> PathBuf {
        self.meta_dir().join(INDEX_FILE)
    }

    pub fn settings_path(&self) -> PathBuf {
        self.meta_dir().join(SETTINGS_FILE)
    }

    pub fn collections_path(&self) -> PathBuf {
        self.meta_dir().join(COLLECTIONS_FILE)
    }

    pub fn attachments_dir(&self) -> PathBuf {
        self.root.join(ATTACHMENTS_DIR)
    }

    /// Create the vault root and its supporting folders.
    pub fn ensure(&self) -> Result<()> {
        std::fs::create_dir_all(&self.root)?;
        std::fs::create_dir_all(self.meta_dir())?;
        std::fs::create_dir_all(self.attachments_dir())?;
        Ok(())
    }

    /// Resolve a vault-relative path to an absolute one, refusing to escape.
    ///
    /// Two independent checks: the textual one in `normalize_relative`, and a
    /// structural walk here that also catches anything a symlink could do once
    /// the parent exists.
    pub fn resolve(&self, relative: &str) -> Result<PathBuf> {
        let normalized = normalize_relative(relative)?;
        let candidate = self.root.join(&normalized);

        // Defence in depth: rebuild the path component-by-component and verify
        // it never climbs above the root.
        let mut depth = 0i32;
        for component in Path::new(&normalized).components() {
            match component {
                Component::Normal(_) => depth += 1,
                Component::CurDir => {}
                _ => {
                    return Err(CoreError::InvalidName(format!(
                        "`{relative}` není platná cesta v trezoru."
                    )))
                }
            }
        }
        if depth == 0 {
            return Err(CoreError::InvalidName("Cesta nemůže být prázdná.".into()));
        }

        // When the parent already exists, canonicalise it: this is what catches
        // a symlink inside the vault pointing somewhere else.
        if let Some(parent) = candidate.parent() {
            if parent.exists() {
                let real_parent = parent.canonicalize()?;
                let real_root = self.root.canonicalize()?;
                if !real_parent.starts_with(&real_root) {
                    return Err(CoreError::Permission(format!(
                        "`{relative}` vede mimo trezor."
                    )));
                }
            }
        }
        Ok(candidate)
    }

    /// Turn an absolute path inside the vault back into a relative POSIX one.
    pub fn relativize(&self, absolute: &Path) -> Option<String> {
        let relative = absolute.strip_prefix(&self.root).ok()?;
        let mut out = String::new();
        for component in relative.components() {
            let Component::Normal(part) = component else {
                return None;
            };
            if !out.is_empty() {
                out.push('/');
            }
            out.push_str(&part.to_string_lossy());
        }
        if out.is_empty() {
            None
        } else {
            Some(out)
        }
    }

    /// True for paths Pilcrow manages itself and must not treat as notes.
    pub fn is_internal(&self, relative: &str) -> bool {
        relative == META_DIR
            || relative.starts_with(&format!("{META_DIR}/"))
            || relative.starts_with(&format!("{ATTACHMENTS_DIR}/"))
    }
}

/// Make a single segment safe, replacing anything unusable.
pub fn sanitize_segment(input: &str, fallback: &str) -> String {
    let mut out: String = input
        .chars()
        .map(|c| {
            if matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') || c.is_control() {
                '-'
            } else {
                c
            }
        })
        .collect();

    out = out.trim().trim_matches('.').trim().to_string();
    if out.len() > MAX_SEGMENT_LEN {
        out.truncate(MAX_SEGMENT_LEN);
        out = out.trim().trim_matches('.').trim().to_string();
    }
    let stem = out.split('.').next().unwrap_or(&out).to_ascii_lowercase();
    if RESERVED.contains(&stem.as_str()) {
        out.push_str("-note");
    }
    if out.is_empty() {
        fallback.to_string()
    } else {
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_ordinary_paths() {
        assert_eq!(normalize_relative("note.md").unwrap(), "note.md");
        assert_eq!(normalize_relative("daily/2026-09-15.md").unwrap(), "daily/2026-09-15.md");
        assert_eq!(normalize_relative("a\\b\\c.md").unwrap(), "a/b/c.md");
        assert_eq!(normalize_relative("./a/./b.md").unwrap(), "a/b.md");
    }

    #[test]
    fn rejects_traversal() {
        for bad in [
            "../secrets.md",
            "notes/../../etc/passwd",
            "..",
            "a/../../b.md",
            "..\\windows\\system32",
        ] {
            assert!(normalize_relative(bad).is_err(), "should reject {bad}");
        }
    }

    #[test]
    fn rejects_absolute_paths() {
        for bad in ["/etc/passwd", "C:/Windows/notes.md", "//server/share/x.md"] {
            assert!(normalize_relative(bad).is_err(), "should reject {bad}");
        }
    }

    #[test]
    fn rejects_reserved_and_illegal_names() {
        for bad in ["con.md", "LPT1.md", "a<b>.md", "trailing /x.md", "bad\0name.md"] {
            assert!(normalize_relative(bad).is_err(), "should reject {bad}");
        }
    }

    #[test]
    fn resolve_stays_inside_the_vault() {
        let dir = tempfile::tempdir().unwrap();
        let vault = VaultPaths::new(dir.path());
        vault.ensure().unwrap();

        let resolved = vault.resolve("notes/idea.md").unwrap();
        assert!(resolved.starts_with(dir.path()));
        assert!(vault.resolve("../outside.md").is_err());
    }

    #[test]
    fn relativize_round_trips() {
        let dir = tempfile::tempdir().unwrap();
        let vault = VaultPaths::new(dir.path());
        let absolute = vault.root().join("daily").join("2026-09-15.md");
        assert_eq!(vault.relativize(&absolute).unwrap(), "daily/2026-09-15.md");
    }

    #[test]
    fn sanitize_segment_produces_usable_names() {
        assert_eq!(sanitize_segment("Hello / World", "untitled"), "Hello - World");
        assert_eq!(sanitize_segment("   ", "untitled"), "untitled");
        assert_eq!(sanitize_segment("con", "untitled"), "con-note");
        assert_eq!(sanitize_segment("trailing.", "untitled"), "trailing");
    }

    #[test]
    fn internal_paths_are_not_notes() {
        let vault = VaultPaths::new("/tmp/vault");
        assert!(vault.is_internal(".pilcrow/index.sqlite"));
        assert!(vault.is_internal("attachments/cat.png"));
        assert!(!vault.is_internal("notes/cat.md"));
    }
}
