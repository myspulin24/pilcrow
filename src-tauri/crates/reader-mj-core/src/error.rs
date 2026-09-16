//! Errors that cross the IPC boundary.
//!
//! Every error is serialised as `{ kind, message, conflict? }`, which is
//! exactly the `VaultError` shape the TypeScript side expects. Keeping the
//! discriminant a string (rather than a Rust enum tag) means the frontend can
//! branch on `kind` without a generated binding.

use serde::{Deserialize, Serialize};

/// The disk/editor pair shown by the conflict-resolution view.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConflictPayload {
    pub path: String,
    /// What the editor tried to write.
    pub local: String,
    /// What the file actually contains right now.
    pub disk: String,
    /// Hash the editor loaded from.
    pub base_hash: String,
    pub disk_hash: String,
    pub detected_at: i64,
}

#[derive(Debug, thiserror::Error)]
pub enum CoreError {
    #[error("{0}")]
    NotFound(String),

    #[error("Soubor {} se na disku změnil od chvíle, kdy byl otevřen", .0.path)]
    Conflict(Box<ConflictPayload>),

    #[error("{0}")]
    InvalidName(String),

    #[error("{0}")]
    Permission(String),

    #[error("{0}")]
    Duplicate(String),

    #[error("{0}")]
    Unavailable(String),

    #[error("{0}")]
    Io(String),
}

impl CoreError {
    pub fn kind(&self) -> &'static str {
        match self {
            CoreError::NotFound(_) => "not-found",
            CoreError::Conflict(_) => "conflict",
            CoreError::InvalidName(_) => "invalid-name",
            CoreError::Permission(_) => "permission",
            CoreError::Duplicate(_) => "duplicate",
            CoreError::Unavailable(_) => "unavailable",
            CoreError::Io(_) => "io",
        }
    }

    pub fn io(context: impl std::fmt::Display, error: impl std::fmt::Display) -> Self {
        CoreError::Io(format!("{context}: {error}"))
    }
}

impl Serialize for CoreError {
    // Note the fully-qualified `Result`: this module defines its own alias
    // below, which would otherwise shadow the one this signature needs.
    fn serialize<S: serde::Serializer>(
        &self,
        serializer: S,
    ) -> std::result::Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut state = serializer.serialize_struct("VaultError", 3)?;
        state.serialize_field("kind", self.kind())?;
        state.serialize_field("message", &self.to_string())?;
        match self {
            CoreError::Conflict(payload) => state.serialize_field("conflict", payload)?,
            _ => state.skip_field("conflict")?,
        }
        state.end()
    }
}

impl From<std::io::Error> for CoreError {
    fn from(error: std::io::Error) -> Self {
        match error.kind() {
            std::io::ErrorKind::NotFound => CoreError::NotFound(error.to_string()),
            std::io::ErrorKind::PermissionDenied => CoreError::Permission(format!(
                "{error}. Povol Reader_MJ přístup ke složce trezoru a zkus to znovu."
            )),
            std::io::ErrorKind::AlreadyExists => CoreError::Duplicate(error.to_string()),
            _ => CoreError::Io(error.to_string()),
        }
    }
}

impl From<rusqlite::Error> for CoreError {
    fn from(error: rusqlite::Error) -> Self {
        CoreError::Io(format!("rejstřík: {error}"))
    }
}

pub type Result<T> = std::result::Result<T, CoreError>;
