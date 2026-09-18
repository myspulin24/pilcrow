//! The file explorer: scanning a folder into a tree, and deciding what the
//! app is allowed to read.
//!
//! Two responsibilities, deliberately kept together because they are two halves
//! of the same rule:
//!
//! 1. **Scanning.** Turn a folder the user picked into a tree of folders and
//!    Markdown files. Folders that contain no Markdown anywhere are pruned, so
//!    opening a source repository shows the handful of `.md` files rather than
//!    every directory in it.
//! 2. **Access.** Pilcrow can read the vault, plus exactly the files and
//!    folders the user has explicitly opened through a native dialog this
//!    session. Nothing else. The registry below is what enforces that, so an
//!    IPC call cannot be talked into reading `~/.ssh/id_rsa`.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{CoreError, Result};

/// Extensions the explorer shows. Everything else is invisible.
const MARKDOWN_EXTENSIONS: [&str; 4] = ["md", "markdown", "mdown", "mkd"];

/// Directories that are never worth walking into for Markdown.
const SKIP_DIRS: [&str; 10] = [
    "node_modules",
    "target",
    "dist",
    "build",
    "vendor",
    "__pycache__",
    ".git",
    ".svn",
    ".hg",
    "venv",
];

/// How deep to recurse, and how many nodes to return, before giving up.
///
/// A reader should never hang because someone opened `C:\`. When a limit is
/// hit the tree is returned anyway, flagged as truncated, and the UI says so.
#[derive(Debug, Clone, Copy)]
pub struct ScanLimits {
    pub max_depth: usize,
    pub max_nodes: usize,
}

impl Default for ScanLimits {
    fn default() -> Self {
        Self {
            max_depth: 16,
            max_nodes: 20_000,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TreeNode {
    /// Display name: the final path segment.
    pub name: String,
    /// Absolute path, in the platform's own form. Opaque to the frontend.
    pub path: String,
    /// `"dir"` or `"file"`.
    pub kind: String,
    /// Always present for directories (possibly empty); always empty for files.
    pub children: Vec<TreeNode>,
}

impl TreeNode {
    fn file(path: &Path) -> Self {
        Self {
            name: file_name_of(path),
            path: path.to_string_lossy().to_string(),
            kind: "file".into(),
            children: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderTree {
    pub root: TreeNode,
    /// Number of Markdown files in the tree.
    pub file_count: i64,
    /// Number of folders shown.
    pub folder_count: i64,
    /// True when a depth or node limit stopped the scan early.
    pub truncated: bool,
}

fn file_name_of(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().to_string())
        // A drive root such as `C:\` has no file name; show the path itself.
        .unwrap_or_else(|| path.to_string_lossy().to_string())
}

pub fn is_markdown(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| {
            let lower = ext.to_ascii_lowercase();
            MARKDOWN_EXTENSIONS.contains(&lower.as_str())
        })
        .unwrap_or(false)
}

fn is_skippable_dir(name: &str) -> bool {
    name.starts_with('.') || SKIP_DIRS.contains(&name)
}

struct ScanState {
    limits: ScanLimits,
    nodes: usize,
    truncated: bool,
    files: i64,
    folders: i64,
}

/// Scan a folder into a tree of directories and Markdown files.
///
/// Directories with no Markdown anywhere beneath them are dropped, which is
/// what keeps the tree readable. Symlinks are not followed, so a loop in the
/// file system cannot turn into an infinite scan.
pub fn scan_folder(root: &Path, limits: ScanLimits) -> Result<FolderTree> {
    if !root.is_dir() {
        return Err(CoreError::NotFound(format!(
            "{} není složka.",
            root.display()
        )));
    }

    let mut state = ScanState {
        limits,
        nodes: 0,
        truncated: false,
        files: 0,
        folders: 0,
    };

    let children = scan_dir(root, 0, &mut state);
    state.folders += 1;

    Ok(FolderTree {
        root: TreeNode {
            name: file_name_of(root),
            path: root.to_string_lossy().to_string(),
            kind: "dir".into(),
            children,
        },
        file_count: state.files,
        folder_count: state.folders,
        truncated: state.truncated,
    })
}

fn scan_dir(dir: &Path, depth: usize, state: &mut ScanState) -> Vec<TreeNode> {
    if depth >= state.limits.max_depth {
        state.truncated = true;
        return Vec::new();
    }

    let Ok(entries) = std::fs::read_dir(dir) else {
        // An unreadable folder is skipped rather than failing the whole scan:
        // one permission-denied directory must not hide the rest of the tree.
        return Vec::new();
    };

    let mut dirs: Vec<TreeNode> = Vec::new();
    let mut files: Vec<TreeNode> = Vec::new();

    for entry in entries.flatten() {
        if state.nodes >= state.limits.max_nodes {
            state.truncated = true;
            break;
        }
        let path = entry.path();
        let name = file_name_of(&path);

        // `file_type` does not follow symlinks, which is what we want.
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_symlink() {
            continue;
        }

        if file_type.is_dir() {
            if is_skippable_dir(&name) {
                continue;
            }
            let children = scan_dir(&path, depth + 1, state);
            // Prune: a folder with no Markdown beneath it is noise.
            if children.is_empty() {
                continue;
            }
            state.nodes += 1;
            state.folders += 1;
            dirs.push(TreeNode {
                name,
                path: path.to_string_lossy().to_string(),
                kind: "dir".into(),
                children,
            });
        } else if file_type.is_file() && is_markdown(&path) {
            state.nodes += 1;
            state.files += 1;
            files.push(TreeNode::file(&path));
        }
    }

    // Folders first, then files; each alphabetical and case-insensitive, so the
    // order matches what a file manager shows.
    dirs.sort_by(|a, b| natural_cmp(&a.name, &b.name));
    files.sort_by(|a, b| natural_cmp(&a.name, &b.name));
    dirs.extend(files);
    dirs
}

fn natural_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    a.to_lowercase().cmp(&b.to_lowercase()).then_with(|| a.cmp(b))
}

/// What the app may read outside its own vault.
///
/// Empty at start-up. A native file dialog is the only thing that adds to it,
/// so "the user chose this" and "the app may read this" are the same fact.
#[derive(Debug, Default)]
pub struct AccessRegistry {
    /// Folders the user opened; everything beneath them is readable.
    dirs: Vec<PathBuf>,
    /// Individual files the user opened.
    files: Vec<PathBuf>,
}

/// Canonicalise for comparison, falling back to the path as given when the
/// target does not exist yet (a file about to be written, for instance).
fn normalize(path: &Path) -> PathBuf {
    path.canonicalize().unwrap_or_else(|_| path.to_path_buf())
}

impl AccessRegistry {
    pub fn grant_dir(&mut self, path: &Path) {
        let normalized = normalize(path);
        if !self.dirs.contains(&normalized) {
            self.dirs.push(normalized);
        }
    }

    pub fn grant_file(&mut self, path: &Path) {
        let normalized = normalize(path);
        if !self.files.contains(&normalized) {
            self.files.push(normalized);
        }
    }

    /// True when `path` is one of the granted files, or sits inside a granted
    /// folder. `..` cannot help: the path is canonicalised first.
    pub fn allows(&self, path: &Path) -> bool {
        let normalized = normalize(path);
        if self.files.contains(&normalized) {
            return true;
        }
        self.dirs.iter().any(|root| normalized.starts_with(root))
    }

    /// Reject anything not granted, with a message that says what to do.
    pub fn require(&self, path: &Path) -> Result<()> {
        if self.allows(path) {
            return Ok(())
        }
        Err(CoreError::Permission(format!(
            "Pilcrow nemá přístup k {}. Otevři to nejdřív přes „Otevřít soubor“ nebo „Otevřít složku“.",
            path.display()
        )))
    }

    pub fn granted_dirs(&self) -> &[PathBuf] {
        &self.dirs
    }
}

/// What a drag-and-drop from the OS resolved to.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DroppedPaths {
    /// First folder that was dropped, if any.
    pub folder: Option<String>,
    /// First Markdown file that was dropped, if any.
    pub file: Option<String>,
    /// How many dropped items were neither.
    pub ignored: i64,
}

/// Grant access to dropped paths and say what they are.
///
/// A drop is a deliberate gesture with a path attached, exactly like choosing
/// one in a dialog, so it grants access the same way. Anything that is not a
/// folder or a Markdown file is counted and ignored -- dropping a photo onto
/// a Markdown reader should say "that is not Markdown", not fail silently.
pub fn accept_drop(registry: &mut AccessRegistry, paths: &[String]) -> DroppedPaths {
    let mut result = DroppedPaths::default();

    for raw in paths {
        let path = Path::new(raw);
        if path.is_dir() {
            registry.grant_dir(path);
            if result.folder.is_none() {
                result.folder = Some(path.to_string_lossy().to_string());
            }
        } else if path.is_file() && is_markdown(path) {
            registry.grant_file(path);
            if result.file.is_none() {
                result.file = Some(path.to_string_lossy().to_string());
            }
        } else {
            result.ignored += 1;
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn fixture() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();

        fs::write(root.join("README.md"), "# readme").unwrap();
        fs::write(root.join("notes.txt"), "not markdown").unwrap();

        fs::create_dir_all(root.join("guides/deep")).unwrap();
        fs::write(root.join("guides/intro.md"), "# intro").unwrap();
        fs::write(root.join("guides/deep/advanced.markdown"), "# adv").unwrap();

        // No Markdown anywhere beneath: should be pruned.
        fs::create_dir_all(root.join("assets/images")).unwrap();
        fs::write(root.join("assets/logo.png"), "png").unwrap();

        // Denylisted and hidden folders, even though they contain Markdown.
        fs::create_dir_all(root.join("node_modules/pkg")).unwrap();
        fs::write(root.join("node_modules/pkg/readme.md"), "# dep").unwrap();
        fs::create_dir_all(root.join(".git")).unwrap();
        fs::write(root.join(".git/COMMIT_EDITMSG.md"), "# git").unwrap();

        dir
    }

    fn names(nodes: &[TreeNode]) -> Vec<&str> {
        nodes.iter().map(|node| node.name.as_str()).collect()
    }

    #[test]
    fn shows_markdown_files_and_folders_only() {
        let dir = fixture();
        let tree = scan_folder(dir.path(), ScanLimits::default()).unwrap();

        // Folders first, then files, each alphabetical.
        assert_eq!(names(&tree.root.children), vec!["guides", "README.md"]);
        assert_eq!(tree.file_count, 3);
        assert!(!tree.truncated);
    }

    #[test]
    fn prunes_folders_with_no_markdown() {
        let dir = fixture();
        let tree = scan_folder(dir.path(), ScanLimits::default()).unwrap();
        assert!(!names(&tree.root.children).contains(&"assets"));
    }

    #[test]
    fn skips_hidden_and_denylisted_folders() {
        let dir = fixture();
        let tree = scan_folder(dir.path(), ScanLimits::default()).unwrap();
        let top = names(&tree.root.children);
        assert!(!top.contains(&"node_modules"));
        assert!(!top.contains(&".git"));
    }

    #[test]
    fn nests_subfolders_and_keeps_their_files() {
        let dir = fixture();
        let tree = scan_folder(dir.path(), ScanLimits::default()).unwrap();

        let guides = tree
            .root
            .children
            .iter()
            .find(|node| node.name == "guides")
            .expect("guides folder");
        assert_eq!(guides.kind, "dir");
        assert_eq!(names(&guides.children), vec!["deep", "intro.md"]);

        let deep = &guides.children[0];
        assert_eq!(names(&deep.children), vec!["advanced.markdown"]);
        assert!(deep.children[0].children.is_empty());
    }

    #[test]
    fn every_node_carries_an_absolute_path() {
        let dir = fixture();
        let tree = scan_folder(dir.path(), ScanLimits::default()).unwrap();
        fn check(node: &TreeNode) {
            assert!(Path::new(&node.path).is_absolute(), "{} is not absolute", node.path);
            for child in &node.children {
                check(child);
            }
        }
        check(&tree.root);
    }

    #[test]
    fn depth_limit_truncates_instead_of_recursing_forever() {
        let dir = fixture();
        let tree = scan_folder(dir.path(), ScanLimits { max_depth: 1, max_nodes: 1000 }).unwrap();
        assert!(tree.truncated);
        // `guides` is pruned at depth 1 because its children were not scanned.
        assert_eq!(names(&tree.root.children), vec!["README.md"]);
    }

    #[test]
    fn node_limit_truncates() {
        let dir = fixture();
        let tree = scan_folder(dir.path(), ScanLimits { max_depth: 16, max_nodes: 1 }).unwrap();
        assert!(tree.truncated);
    }

    #[test]
    fn an_empty_folder_scans_to_an_empty_tree() {
        let dir = tempfile::tempdir().unwrap();
        let tree = scan_folder(dir.path(), ScanLimits::default()).unwrap();
        assert!(tree.root.children.is_empty());
        assert_eq!(tree.file_count, 0);
    }

    #[test]
    fn scanning_a_file_is_an_error() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("a.md");
        fs::write(&file, "x").unwrap();
        assert!(scan_folder(&file, ScanLimits::default()).is_err());
    }

    #[test]
    fn markdown_detection_is_case_insensitive() {
        assert!(is_markdown(Path::new("a.md")));
        assert!(is_markdown(Path::new("a.MD")));
        assert!(is_markdown(Path::new("a.Markdown")));
        assert!(!is_markdown(Path::new("a.txt")));
        assert!(!is_markdown(Path::new("a")));
    }

    #[test]
    fn access_is_denied_until_granted() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("a.md");
        fs::write(&file, "x").unwrap();

        let mut registry = AccessRegistry::default();
        assert!(!registry.allows(&file));
        assert!(registry.require(&file).is_err());

        registry.grant_file(&file);
        assert!(registry.allows(&file));
        assert!(registry.require(&file).is_ok());
    }

    #[test]
    fn granting_a_folder_covers_everything_beneath_it() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir_all(dir.path().join("sub")).unwrap();
        let nested = dir.path().join("sub/a.md");
        fs::write(&nested, "x").unwrap();

        let mut registry = AccessRegistry::default();
        registry.grant_dir(dir.path());
        assert!(registry.allows(&nested));
    }

    #[test]
    fn a_granted_file_does_not_grant_its_siblings() {
        let dir = tempfile::tempdir().unwrap();
        let granted = dir.path().join("a.md");
        let sibling = dir.path().join("b.md");
        fs::write(&granted, "x").unwrap();
        fs::write(&sibling, "y").unwrap();

        let mut registry = AccessRegistry::default();
        registry.grant_file(&granted);
        assert!(registry.allows(&granted));
        assert!(!registry.allows(&sibling), "opening one file must not expose the folder");
    }

    #[test]
    fn traversal_out_of_a_granted_folder_is_refused() {
        let outer = tempfile::tempdir().unwrap();
        fs::create_dir_all(outer.path().join("inside")).unwrap();
        let secret = outer.path().join("secret.md");
        fs::write(&secret, "s").unwrap();

        let mut registry = AccessRegistry::default();
        registry.grant_dir(&outer.path().join("inside"));

        // Both the direct path and a `..` dodge must be refused.
        assert!(!registry.allows(&secret));
        assert!(!registry.allows(&outer.path().join("inside/../secret.md")));
    }

    #[test]
    fn a_drop_grants_access_and_classifies_what_was_dropped() {
        let dir = tempfile::tempdir().unwrap();
        let folder = dir.path().join("notes");
        fs::create_dir_all(&folder).unwrap();
        let markdown = dir.path().join("a.md");
        let other = dir.path().join("photo.png");
        fs::write(&markdown, "# a").unwrap();
        fs::write(&other, "png").unwrap();

        let mut registry = AccessRegistry::default();
        let dropped = accept_drop(
            &mut registry,
            &[
                folder.to_string_lossy().to_string(),
                markdown.to_string_lossy().to_string(),
                other.to_string_lossy().to_string(),
            ],
        );

        assert!(dropped.folder.is_some());
        assert!(dropped.file.is_some());
        assert_eq!(dropped.ignored, 1, "the png is not Markdown");

        // Both dropped paths are now readable; the png is not.
        assert!(registry.allows(&folder));
        assert!(registry.allows(&markdown));
        assert!(!registry.allows(&other));
    }

    #[test]
    fn dropping_nothing_usable_grants_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let other = dir.path().join("photo.png");
        fs::write(&other, "png").unwrap();

        let mut registry = AccessRegistry::default();
        let dropped = accept_drop(&mut registry, &[
            other.to_string_lossy().to_string(),
            "/does/not/exist.md".to_string(),
        ]);

        assert!(dropped.folder.is_none());
        assert!(dropped.file.is_none());
        assert_eq!(dropped.ignored, 2);
        assert!(!registry.allows(&other));
    }

    #[test]
    fn granting_is_idempotent() {
        let dir = tempfile::tempdir().unwrap();
        let mut registry = AccessRegistry::default();
        registry.grant_dir(dir.path());
        registry.grant_dir(dir.path());
        assert_eq!(registry.granted_dirs().len(), 1);
    }
}
