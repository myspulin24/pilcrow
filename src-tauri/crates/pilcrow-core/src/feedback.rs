//! Feedback do Workeru -- rozhodovací část bez sítě.
//!
//! Okno v aplikaci sestaví zprávu, Rust k ní přidá verzi a systém a pošle ji
//! na jednu pevnou adresu. Tady je, co se z webview přijme, jak vypadá
//! zpráva pro Worker a kam smí odejít. Síť je v `src-tauri/src/feedback.rs`.
//!
//! Adresu nevybírá webview: je zakompilovaná, a jen kdo spouští aplikaci, ji
//! může přepsat proměnnou `PILCROW_FEEDBACK_URL` (kvůli `wrangler dev`). Tím
//! je feedback jediná cesta, kudy text z aplikace odejde, a vede jen tam.

use serde::{Deserialize, Serialize};

use crate::error::{CoreError, Result};

/// Kam feedback odchází, když se nic nepřepíše.
pub const DEFAULT_ENDPOINT: &str = "https://pilcrow-feedback.michal-jasek.workers.dev/v1/feedback";

/// Limity stejné jako ve Workeru. Rozhoduje Worker; tohle je jen zdvořilost,
/// ať se zjevně neplatná zpráva vůbec neposílá.
pub const MAX_MESSAGE: usize = 10_000;
pub const MAX_ATTACHMENT_BASE64: usize = 2 * 1024 * 1024 * 4 / 3 + 4;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackElement {
    pub label: String,
    #[serde(default)]
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackAuthor {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub email: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackAttachment {
    pub name: String,
    #[serde(rename = "type")]
    pub kind: String,
    /// Obsah v base64.
    pub data: String,
}

/// Co pošle okno feedbacku.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackRequest {
    /// `bug` | `change` | `improvement`.
    pub kind: String,
    pub message: String,
    #[serde(default)]
    pub location: String,
    #[serde(default)]
    pub element: Option<FeedbackElement>,
    /// `None` = anonymně.
    #[serde(default)]
    pub author: Option<FeedbackAuthor>,
    #[serde(default)]
    pub attachment: Option<FeedbackAttachment>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackContext {
    pub version: String,
    pub os: String,
    pub location: String,
    pub element: Option<FeedbackElement>,
}

/// Co dorazí do Workeru. Smlouva s `feedback/src/feedback.ts`.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackPayload {
    pub kind: String,
    pub message: String,
    pub context: FeedbackContext,
    pub author: Option<FeedbackAuthor>,
    pub attachment: Option<FeedbackAttachment>,
}

/// Co aplikaci řekne Worker, když feedback přijme.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackReceipt {
    pub id: String,
}

/// Zkontrolovat zprávu z webview a doplnit k ní, co ví jen Rust.
pub fn build_payload(request: FeedbackRequest, version: &str, os: &str) -> Result<FeedbackPayload> {
    if !matches!(request.kind.as_str(), "bug" | "change" | "improvement") {
        return Err(CoreError::InvalidName("Neznámý druh feedbacku.".into()));
    }
    let message = request.message.trim().to_string();
    if message.is_empty() {
        return Err(CoreError::InvalidName("Napiš, o co jde -- zpráva je prázdná.".into()));
    }
    if message.chars().count() > MAX_MESSAGE {
        return Err(CoreError::InvalidName("Zpráva je příliš dlouhá.".into()));
    }
    if let Some(attachment) = &request.attachment {
        if attachment.data.len() > MAX_ATTACHMENT_BASE64 {
            return Err(CoreError::InvalidName("Příloha je větší než 2 MB.".into()));
        }
    }
    // Prázdný autor je totéž co anonym: Worker by ho stejně zahodil.
    let author = request
        .author
        .filter(|author| !author.name.trim().is_empty() || !author.email.trim().is_empty());

    Ok(FeedbackPayload {
        kind: request.kind,
        message,
        context: FeedbackContext {
            version: version.to_string(),
            os: os.to_string(),
            location: request.location.trim().to_string(),
            element: request.element,
        },
        author,
        attachment: request.attachment,
    })
}

/// Kam feedback poslat: přepsaná adresa, jinak ta zakompilovaná.
///
/// Přepsaná smí být jen https -- a http jen na tenhle počítač, kvůli
/// `wrangler dev`. Text z aplikace nesmí odejít nešifrovaně po síti.
pub fn resolve_endpoint(override_url: Option<&str>) -> Result<String> {
    let chosen = override_url.map(str::trim).filter(|url| !url.is_empty()).unwrap_or(DEFAULT_ENDPOINT);
    let local = ["http://127.0.0.1:", "http://localhost:", "http://127.0.0.1/", "http://localhost/"]
        .iter()
        .any(|prefix| chosen.starts_with(prefix));
    let valid = (chosen.starts_with("https://") || local)
        && !chosen.chars().any(|c| c.is_whitespace() || c.is_control());
    if !valid {
        return Err(CoreError::InvalidName(format!(
            "{chosen} není adresa, kam se smí feedback posílat."
        )));
    }
    Ok(chosen.to_string())
}

/// Hostitel z adresy -- ukazuje se v okně, ať je vidět, kam zpráva odejde.
pub fn endpoint_host(url: &str) -> String {
    url.split("://")
        .nth(1)
        .and_then(|rest| rest.split('/').next())
        .unwrap_or(url)
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request() -> FeedbackRequest {
        serde_json::from_str(
            r#"{"kind":"bug","message":"  Nejde to.  ","location":"Poznámka v trezoru",
                "element":{"label":"tlačítko „Větve…“","path":"button.git__branch-button"},
                "author":{"name":"Michal","email":""},"attachment":null}"#,
        )
        .unwrap()
    }

    #[test]
    fn the_payload_carries_what_the_worker_reads() {
        let payload = build_payload(request(), "0.13.0", "windows (x86_64)").unwrap();
        let json: serde_json::Value = serde_json::to_value(&payload).unwrap();
        assert_eq!(json["kind"], "bug");
        assert_eq!(json["message"], "Nejde to.");
        assert_eq!(json["context"]["version"], "0.13.0");
        assert_eq!(json["context"]["os"], "windows (x86_64)");
        assert_eq!(json["context"]["location"], "Poznámka v trezoru");
        assert_eq!(json["context"]["element"]["label"], "tlačítko „Větve…“");
        assert_eq!(json["author"]["name"], "Michal");
        assert!(json["attachment"].is_null());
    }

    #[test]
    fn an_attachment_keeps_its_type_field_name() {
        let mut with_file = request();
        with_file.attachment = Some(FeedbackAttachment {
            name: "a.png".into(),
            kind: "image/png".into(),
            data: "AAAA".into(),
        });
        let json = serde_json::to_value(build_payload(with_file, "v", "o").unwrap()).unwrap();
        assert_eq!(json["attachment"]["type"], "image/png");
    }

    #[test]
    fn empty_author_means_anonymous() {
        let mut anonymous = request();
        anonymous.author = Some(FeedbackAuthor { name: " ".into(), email: String::new() });
        assert!(build_payload(anonymous, "v", "o").unwrap().author.is_none());
    }

    #[test]
    fn invalid_requests_never_leave() {
        let mut empty = request();
        empty.message = "   ".into();
        assert!(build_payload(empty, "v", "o").is_err());

        let mut odd = request();
        odd.kind = "spam".into();
        assert!(build_payload(odd, "v", "o").is_err());

        let mut big = request();
        big.attachment = Some(FeedbackAttachment {
            name: "a.png".into(),
            kind: "image/png".into(),
            data: "A".repeat(MAX_ATTACHMENT_BASE64 + 4),
        });
        assert!(build_payload(big, "v", "o").is_err());
    }

    #[test]
    fn the_endpoint_is_https_or_this_machine() {
        assert_eq!(resolve_endpoint(None).unwrap(), DEFAULT_ENDPOINT);
        assert_eq!(resolve_endpoint(Some("  ")).unwrap(), DEFAULT_ENDPOINT);
        assert_eq!(
            resolve_endpoint(Some("http://127.0.0.1:8787/v1/feedback")).unwrap(),
            "http://127.0.0.1:8787/v1/feedback"
        );
        assert!(resolve_endpoint(Some("https://example.com/x")).is_ok());
        assert!(resolve_endpoint(Some("http://example.com/x")).is_err());
        assert!(resolve_endpoint(Some("http://localhost.evil.com/x")).is_err());
        assert!(resolve_endpoint(Some("file:///etc/passwd")).is_err());
    }

    #[test]
    fn the_host_is_shown_without_the_path() {
        assert_eq!(endpoint_host(DEFAULT_ENDPOINT), "pilcrow-feedback.michal-jasek.workers.dev");
        assert_eq!(endpoint_host("http://127.0.0.1:8787/v1/feedback"), "127.0.0.1:8787");
    }
}
