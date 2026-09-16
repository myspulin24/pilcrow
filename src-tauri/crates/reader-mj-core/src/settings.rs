//! Settings persistence.
//!
//! Settings live in `.reader_mj/settings.json` inside the vault, next to the index,
//! so a vault is completely self-describing: copy the folder and your
//! preferences come with it. Nothing here is secret -- credentials belong in
//! `.env`, which is git-ignored and never read into a note.

use std::path::Path;

use crate::error::Result;
use crate::types::VaultSettings;

/// Read settings, falling back to defaults for anything missing or corrupt.
///
/// A settings file that fails to parse is never fatal: the app starts with
/// defaults and the next save rewrites it.
pub fn load(path: &Path) -> VaultSettings {
    let Ok(text) = std::fs::read_to_string(path) else {
        return VaultSettings::default();
    };
    serde_json::from_str(&text).unwrap_or_default()
}

pub fn save(path: &Path, settings: &VaultSettings) -> Result<VaultSettings> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let text = serde_json::to_string_pretty(settings)
        .map_err(|error| crate::error::CoreError::io("writing settings", error))?;
    std::fs::write(path, text)?;
    Ok(settings.clone())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_file_yields_defaults() {
        let settings = load(Path::new("/definitely/not/here/settings.json"));
        assert_eq!(settings.daily_folder, "daily");
        assert_eq!(settings.editor_font_size, 15);
    }

    #[test]
    fn corrupt_file_yields_defaults_instead_of_failing() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        std::fs::write(&path, "{ this is not json").unwrap();
        assert_eq!(load(&path).theme, "system");
    }

    #[test]
    fn partial_file_fills_in_the_rest() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        std::fs::write(&path, r#"{"dailyFolder":"journal"}"#).unwrap();

        let settings = load(&path);
        assert_eq!(settings.daily_folder, "journal");
        assert_eq!(settings.editor_font_size, 15);
        assert!(settings.show_preview);
    }

    #[test]
    fn round_trips() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let mut settings = VaultSettings::default();
        settings.daily_folder = "log".into();
        settings.editor_font_size = 18;

        save(&path, &settings).unwrap();
        let read = load(&path);
        assert_eq!(read.daily_folder, "log");
        assert_eq!(read.editor_font_size, 18);
    }
}
