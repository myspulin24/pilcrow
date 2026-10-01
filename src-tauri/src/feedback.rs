//! Odeslání feedbacku na Worker.
//!
//! Jediná síťová cesta, kudy z aplikace odchází text napsaný uživatelem,
//! a vede na jednu adresu: zakompilovanou, nebo přepsanou proměnnou
//! `PILCROW_FEEDBACK_URL` z `.env` (kvůli `wrangler dev`). Webview adresu
//! určit nemůže -- pošle jen obsah, a ten se tu ještě jednou zkontroluje.
//!
//! Rozhodnutí (co je platná zpráva, kam smí odejít) jsou v
//! `pilcrow_core::feedback`. Tady se jen posílá.

use std::time::Duration;

use serde::Serialize;
use tauri::AppHandle;

use pilcrow_core::error::{CoreError, Result};
use pilcrow_core::feedback::{
    build_payload, endpoint_host, resolve_endpoint, FeedbackPayload, FeedbackReceipt, FeedbackRequest,
};

/// Co okno potřebuje vědět předem: jestli posílat jde a kam to odejde.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackStatus {
    pub available: bool,
    /// Hostitel, kam feedback odejde -- ukazuje se v okně.
    pub host: String,
    pub version: String,
    pub os: String,
    pub error: String,
}

fn override_url() -> Option<String> {
    std::env::var("PILCROW_FEEDBACK_URL").ok()
}

fn os_label() -> String {
    format!("{} ({})", std::env::consts::OS, std::env::consts::ARCH)
}

#[tauri::command]
pub fn feedback_status(app: AppHandle) -> FeedbackStatus {
    let version = app.package_info().version.to_string();
    match resolve_endpoint(override_url().as_deref()) {
        Ok(url) => FeedbackStatus {
            available: true,
            host: endpoint_host(&url),
            version,
            os: os_label(),
            error: String::new(),
        },
        Err(error) => FeedbackStatus {
            available: false,
            host: String::new(),
            version,
            os: os_label(),
            error: error.to_string(),
        },
    }
}

#[tauri::command]
pub async fn feedback_send(app: AppHandle, request: FeedbackRequest) -> Result<FeedbackReceipt> {
    let version = app.package_info().version.to_string();
    let payload = build_payload(request, &version, &os_label())?;
    let url = resolve_endpoint(override_url().as_deref())?;
    send(&url, &version, &payload).await
}

/// Poslat zprávu a přečíst odpověď Workeru.
///
/// Worker odpovídá `{ ok, id }`, nebo `{ ok: false, error }` s větou, kterou
/// jde ukázat člověku. Když neodpoví vůbec (bez sítě, Worker spí), řekne se
/// to obecně -- text zprávy zůstane v okně a dá se poslat znovu.
pub(crate) async fn send(url: &str, version: &str, payload: &FeedbackPayload) -> Result<FeedbackReceipt> {
    // Stejně jako updater: rustls bez vestavěného poskytovatele kryptografie,
    // tak se jednou nastaví ring. Druhé nastavení je neškodné a nic nevrací.
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }

    let client = reqwest::Client::builder()
        .user_agent(format!("Pilcrow/{version}"))
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| CoreError::Io(format!("Odesílání se nepodařilo připravit: {error}")))?;

    let response = client
        .post(url)
        .header("x-pilcrow-version", version)
        .json(payload)
        .send()
        .await
        .map_err(|_| CoreError::Io("Feedback se nepodařilo odeslat -- jsi připojený k internetu?".into()))?;

    let status = response.status();
    let body: serde_json::Value = response.json().await.unwrap_or(serde_json::Value::Null);
    if status.is_success() && body["ok"] == serde_json::Value::Bool(true) {
        let id = body["id"].as_str().unwrap_or_default().to_string();
        return Ok(FeedbackReceipt { id });
    }
    let reason = body["error"]
        .as_str()
        .map(str::to_string)
        .unwrap_or_else(|| format!("Příjem feedbacku odpověděl {}.", status.as_u16()));
    Err(CoreError::Io(reason))
}

#[cfg(test)]
mod tests {
    //! Proti skutečnému HTTP serveru na tomhle počítači: ověřuje, že
    //! odchází přesně to, co Worker čte, i s hlavičkami.

    use super::*;
    use std::io::{BufRead, BufReader, Read, Write};
    use std::net::TcpListener;
    use std::sync::mpsc;

    use pilcrow_core::feedback::FeedbackRequest;

    /// Server na jedno spojení: vrátí odpověď a pošle zpět, co přišlo.
    fn one_shot(status: &str, body: &'static str) -> (String, mpsc::Receiver<(String, String)>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/v1/feedback", listener.local_addr().unwrap());
        let (sender, receiver) = mpsc::channel();
        let status = status.to_string();
        std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut headers = String::new();
            let mut length = 0usize;
            loop {
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                if line == "\r\n" || line.is_empty() {
                    break;
                }
                if let Some(value) = line.to_ascii_lowercase().strip_prefix("content-length:") {
                    length = value.trim().parse().unwrap();
                }
                headers.push_str(&line);
            }
            let mut body_bytes = vec![0; length];
            reader.read_exact(&mut body_bytes).unwrap();
            let reply = format!(
                "HTTP/1.1 {status}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                body.len()
            );
            stream.write_all(reply.as_bytes()).unwrap();
            sender.send((headers, String::from_utf8(body_bytes).unwrap())).unwrap();
        });
        (url, receiver)
    }

    fn payload() -> FeedbackPayload {
        let request: FeedbackRequest = serde_json::from_str(
            r#"{"kind":"improvement","message":"Tmavší okraj, prosím.","location":"Poznámka v trezoru"}"#,
        )
        .unwrap();
        build_payload(request, "0.13.0", "windows (x86_64)").unwrap()
    }

    #[test]
    fn sends_the_payload_with_the_app_headers_and_reads_the_receipt() {
        let (url, received) = one_shot("200 OK", r#"{"ok":true,"id":"abcd1234","number":3}"#);
        let receipt = tauri::async_runtime::block_on(send(&url, "0.13.0", &payload())).unwrap();
        assert_eq!(receipt.id, "abcd1234");

        let (headers, body) = received.recv().unwrap();
        let headers = headers.to_ascii_lowercase();
        assert!(headers.contains("x-pilcrow-version: 0.13.0"), "{headers}");
        assert!(headers.contains("user-agent: pilcrow/0.13.0"), "{headers}");
        assert!(headers.contains("content-type: application/json"), "{headers}");
        let json: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(json["kind"], "improvement");
        assert_eq!(json["context"]["version"], "0.13.0");
        assert!(json["author"].is_null(), "bez autora je to anonym");
    }

    #[test]
    fn the_workers_own_reason_reaches_the_user() {
        let (url, _received) = one_shot("429 Too Many Requests", r#"{"ok":false,"error":"Feedbacku přišlo moc najednou."}"#);
        let error = tauri::async_runtime::block_on(send(&url, "0.13.0", &payload())).unwrap_err();
        assert!(error.to_string().contains("moc najednou"), "{error}");
    }

    /// Naostro přes https na nasazený Worker. Spouští se ručně
    /// (`cargo test -p pilcrow feedback -- --ignored`): sahá na síť, a kdyby
    /// měl Worker nastavený token, založil by issue.
    #[test]
    #[ignore]
    fn the_deployed_worker_answers_over_https() {
        let url = resolve_endpoint(override_url().as_deref()).unwrap();
        let result = tauri::async_runtime::block_on(send(&url, "0.0.0-test", &payload()));
        // Bez tokenu odpoví Worker vlastní větou; s ním vrátí ID. Obojí
        // znamená, že TLS i cesta fungují -- selhat smí jen spojení samo.
        match result {
            Ok(receipt) => assert!(!receipt.id.is_empty()),
            Err(error) => assert!(!error.to_string().contains("připojený k internetu"), "{error}"),
        }
    }

    #[test]
    fn no_server_means_a_plain_message_not_a_stack_trace() {
        // Port, na kterém nic neposlouchá.
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/v1/feedback", listener.local_addr().unwrap());
        drop(listener);
        let error = tauri::async_runtime::block_on(send(&url, "0.13.0", &payload())).unwrap_err();
        assert!(error.to_string().contains("připojený k internetu"), "{error}");
    }
}
