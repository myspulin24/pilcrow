//! Collections: your own groups of files.
//!
//! A collection is a named list of Markdown files that can live anywhere on the
//! machine -- one note in the vault, one in a project folder, one on another
//! drive. It is the answer to "I want these six documents together" without
//! moving or copying anything.
//!
//! Two things make it work:
//!
//! 1. **It is stored in the vault** (`.pilcrow/collections.json`), so it
//!    survives restarts and travels with the vault.
//! 2. **Membership is consent.** Adding a file to a collection means you
//!    pointed at it, so its path is granted on load -- otherwise a linked file
//!    would be unreadable the next time the app starts, which would make the
//!    whole feature pointless.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{CoreError, Result};
use crate::explorer::AccessRegistry;

/// One file inside a collection.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CollectionItem {
    /// Absolute path for an external file, vault-relative for a note.
    pub path: String,
    /// What to show in the list. Defaults to the file name.
    pub label: String,
    /// False for a vault note, true for anything else on disk.
    pub external: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Collection {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub items: Vec<CollectionItem>,
}

/// The whole file, versioned so the shape can change later without guessing.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CollectionsFile {
    #[serde(default = "default_version")]
    version: u32,
    #[serde(default)]
    collections: Vec<Collection>,
}

fn default_version() -> u32 {
    1
}

/// Read collections from disk.
///
/// A missing or unreadable file is not an error: it means "no collections yet".
/// Losing the list would be annoying; refusing to start would be worse.
pub fn load(path: &Path) -> Vec<Collection> {
    let Ok(text) = std::fs::read_to_string(path) else {
        return Vec::new();
    };
    serde_json::from_str::<CollectionsFile>(&text)
        .map(|file| file.collections)
        .unwrap_or_default()
}

pub fn save(path: &Path, collections: &[Collection]) -> Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let file = CollectionsFile {
        version: default_version(),
        collections: collections.to_vec(),
    };
    let text = serde_json::to_string_pretty(&file)
        .map_err(|error| CoreError::io("writing collections", error))?;
    std::fs::write(path, text)?;
    Ok(())
}

/// Grant read access to every external file referenced by a collection.
///
/// Called on load and on save. Vault-relative items are skipped -- the vault is
/// already readable, and treating a relative path as absolute here would be a
/// way to smuggle one past the registry.
pub fn grant_linked_files(registry: &mut AccessRegistry, collections: &[Collection]) -> usize {
    let mut granted = 0;
    for collection in collections {
        for item in &collection.items {
            if !item.external {
                continue;
            }
            let path = PathBuf::from(&item.path);
            if !path.is_absolute() {
                continue;
            }
            registry.grant_file(&path);
            granted += 1;
        }
    }
    granted
}

/// Drop items whose file no longer exists, so a collection cannot rot silently.
///
/// Returns the removed items so the caller can say what happened.
pub fn prune_missing(collections: &mut [Collection]) -> Vec<CollectionItem> {
    let mut removed = Vec::new();
    for collection in collections.iter_mut() {
        collection.items.retain(|item| {
            if !item.external {
                return true;
            }
            if Path::new(&item.path).is_file() {
                return true;
            }
            removed.push(item.clone());
            false
        });
    }
    removed
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn item(path: &str, external: bool) -> CollectionItem {
        CollectionItem {
            path: path.to_string(),
            label: path.rsplit(['/', '\\']).next().unwrap_or(path).to_string(),
            external,
        }
    }

    fn sample() -> Vec<Collection> {
        vec![
            Collection {
                id: "c1".into(),
                name: "Work".into(),
                items: vec![item("notes/plan.md", false), item("/projects/spec.md", true)],
            },
            Collection {
                id: "c2".into(),
                name: "Reading".into(),
                items: vec![],
            },
        ]
    }

    #[test]
    fn round_trips_through_a_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("collections.json");

        save(&path, &sample()).unwrap();
        let loaded = load(&path);

        assert_eq!(loaded, sample());
        assert_eq!(loaded[0].items[1].path, "/projects/spec.md");
        assert!(loaded[0].items[1].external);
    }

    #[test]
    fn a_missing_file_means_no_collections() {
        assert!(load(Path::new("/definitely/not/here.json")).is_empty());
    }

    #[test]
    fn a_corrupt_file_means_no_collections_rather_than_a_crash() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("collections.json");
        fs::write(&path, "{ not json at all").unwrap();
        assert!(load(&path).is_empty());
    }

    #[test]
    fn an_empty_collection_survives_a_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("collections.json");
        save(&path, &sample()).unwrap();
        assert_eq!(load(&path)[1].items.len(), 0);
    }

    #[test]
    fn linked_external_files_become_readable() {
        let dir = tempfile::tempdir().unwrap();
        let linked = dir.path().join("linked.md");
        fs::write(&linked, "# linked").unwrap();

        let collections = vec![Collection {
            id: "c1".into(),
            name: "Work".into(),
            items: vec![item(&linked.to_string_lossy(), true)],
        }];

        let mut registry = AccessRegistry::default();
        assert!(!registry.allows(&linked));

        assert_eq!(grant_linked_files(&mut registry, &collections), 1);
        assert!(registry.allows(&linked), "a linked file must open after a restart");
    }

    #[test]
    fn vault_items_never_grant_anything() {
        // A relative path must not be treated as absolute and granted.
        let collections = vec![Collection {
            id: "c1".into(),
            name: "Work".into(),
            items: vec![item("notes/plan.md", false), item("also/relative.md", true)],
        }];

        let mut registry = AccessRegistry::default();
        assert_eq!(grant_linked_files(&mut registry, &collections), 0);
        assert!(registry.granted_dirs().is_empty());
    }

    #[test]
    fn pruning_drops_files_that_no_longer_exist() {
        let dir = tempfile::tempdir().unwrap();
        let present = dir.path().join("here.md");
        fs::write(&present, "# here").unwrap();
        let gone = dir.path().join("gone.md");

        let mut collections = vec![Collection {
            id: "c1".into(),
            name: "Work".into(),
            items: vec![
                item(&present.to_string_lossy(), true),
                item(&gone.to_string_lossy(), true),
                item("notes/in-vault.md", false),
            ],
        }];

        let removed = prune_missing(&mut collections);
        assert_eq!(removed.len(), 1);
        assert_eq!(collections[0].items.len(), 2, "the vault note is kept, unchecked");
        assert!(collections[0].items.iter().all(|entry| entry.path != gone.to_string_lossy()));
    }
}
