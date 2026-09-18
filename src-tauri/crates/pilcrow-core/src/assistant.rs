//! Rozhodování kolem Claude Code -- bez procesů a bez Tauri.
//!
//! Spouštění samotné patří do `src-tauri/src/assistant.rs`, kde se nedá
//! testovat, aniž by se něco doopravdy spustilo. Všechno, co je *rozhodnutí*
//! -- kde hledat, co spustit, kdy je kus výstupu hotový text -- je tady,
//! a tím pádem pokryté testy, které běží v CI.

use std::path::Path;

use serde::{Deserialize, Serialize};

/// Co Rust zjistil o Claude Code na tomhle počítači.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistantProbe {
    /// Je `claude` na tomhle počítači?
    pub installed: bool,
    /// Co vypsalo `claude --version`. Prázdné, když spustit nejde.
    pub version: String,
    /// Kde jsme ho našli -- ať je v nastavení vidět, co se vlastně spouští.
    pub path: String,
    /// Surový JSON z `claude auth status --json`; rozumí mu TypeScript.
    pub auth: String,
    /// Proč se nic nepovedlo, když se nepovedlo.
    pub error: String,
}

/// Co se posílá frontendu. Text jde beze změny, zbytek je jen rámec.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum AssistantChunk {
    /// Kus standardního výstupu, tak jak přišel.
    Out { text: String },
    /// Proces doběhl v pořádku.
    Finished,
    /// Proces se nepodařilo spustit, přečíst, nebo skončil chybou.
    Failed { message: String },
}

/// Dotaz, tak jak přijde z frontendu.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AskRequest {
    pub prompt: String,
    /// Celý systémový pokyn, ne přídavek -- viz `src/core/assistant.ts`.
    pub system: String,
    /// Sezení, ve kterém se pokračuje. Prázdné = nový rozhovor.
    pub session_id: Option<String>,
    /// `opus`, `sonnet`, nebo plné jméno modelu.
    pub model: Option<String>,
}

/// Odkud se bere instalátor Claude Code.
///
/// Oficiální adresy Anthropicu, schválně na očích: instalace stáhne a spustí
/// skript z internetu, což je jediná věc svého druhu v celé aplikaci.
/// Panel ji ukáže uživateli dřív, než se na cokoli klikne.
pub const INSTALL_URL_WINDOWS: &str = "https://claude.ai/install.ps1";
pub const INSTALL_URL_UNIX: &str = "https://claude.ai/install.sh";

/// Přesný příkaz, kterým se Claude Code doinstaluje.
pub fn install_command(windows: bool) -> String {
    if windows {
        format!("irm {INSTALL_URL_WINDOWS} | iex")
    } else {
        format!("curl -fsSL {INSTALL_URL_UNIX} | bash")
    }
}

/// Kde hledat `claude`, v pořadí, ve kterém se to má zkoušet.
///
/// První je holé jméno, tedy PATH. Jenže instalátor Claude Code dává program
/// do `~/.local/bin`, což na Windows v PATH běžně není -- a aplikace spuštěná
/// z nabídky Start dědí jiné prostředí než terminál. Spoléhat jen na PATH by
/// znamenalo, že to komu funguje a komu ne podle toho, jak aplikaci spustil.
///
/// Vrací jen cesty, které opravdu existují; neexistující se přeskočí, aby se
/// kvůli nim nespouštěl proces zbytečně.
pub fn claude_candidates(home: Option<&Path>, windows: bool) -> Vec<String> {
    let mut found = vec![if windows { "claude.exe" } else { "claude" }.to_string()];

    if let Some(home) = home {
        for relative in [".local/bin/claude.exe", ".local/bin/claude", "bin/claude"] {
            let path = home.join(relative);
            if path.exists() {
                found.push(path.to_string_lossy().to_string());
            }
        }
    }
    found
}

/// Vzít z nasbíraných bajtů to, co už tvoří platný text.
///
/// Kus přečtený z roury může skončit uprostřed vícebajtového znaku -- a české
/// odpovědi jsou jich plné. Nedopsaný konec proto zůstane v `pending` a počká
/// si na další čtení, místo aby se z něj stal otazník v kosočtverci.
///
/// Vrací `None`, když ještě není co poslat.
pub fn take_decodable(pending: &mut Vec<u8>) -> Option<String> {
    let valid = match std::str::from_utf8(pending) {
        Ok(_) => pending.len(),
        Err(error) => error.valid_up_to(),
    };
    if valid == 0 {
        return None;
    }

    let text = String::from_utf8_lossy(&pending[..valid]).into_owned();
    pending.drain(..valid);
    Some(text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn whole_text_goes_through_untouched() {
        let mut pending = "Na jaře je 120 tisíc.".as_bytes().to_vec();
        assert_eq!(
            take_decodable(&mut pending).as_deref(),
            Some("Na jaře je 120 tisíc.")
        );
        assert!(pending.is_empty());
    }

    #[test]
    fn a_character_split_across_two_reads_survives() {
        // „ř“ jsou v UTF-8 dva bajty. Roura je může rozdělit kdekoli, a kdyby
        // se ten první poslal sám, uživatel by místo písmene viděl otazník.
        let bytes = "jaře".as_bytes().to_vec();
        let split = bytes.len() - 2; // uprostřed „ř“

        let mut pending = bytes[..split].to_vec();
        assert_eq!(take_decodable(&mut pending).as_deref(), Some("ja"));
        assert_eq!(pending.len(), 1, "první bajt písmene čeká na druhý");

        pending.extend_from_slice(&bytes[split..]);
        assert_eq!(take_decodable(&mut pending).as_deref(), Some("ře"));
        assert!(pending.is_empty());
    }

    #[test]
    fn a_four_byte_character_split_at_every_point_survives() {
        // Emoji má čtyři bajty; projdeme všechny tři možné hrany.
        let bytes = "ok 🙂".as_bytes().to_vec();
        for split in (bytes.len() - 3)..bytes.len() {
            let mut pending = bytes[..split].to_vec();
            let first = take_decodable(&mut pending).unwrap_or_default();
            pending.extend_from_slice(&bytes[split..]);
            let second = take_decodable(&mut pending).unwrap_or_default();
            assert_eq!(format!("{first}{second}"), "ok 🙂", "rozděleno na {split}");
        }
    }

    #[test]
    fn nothing_decodable_yet_means_nothing_is_sent() {
        // Samotný úvodní bajt vícebajtového znaku.
        let mut pending = vec![0xC5];
        assert_eq!(take_decodable(&mut pending), None);
        assert_eq!(pending, vec![0xC5]);

        let mut empty = Vec::new();
        assert_eq!(take_decodable(&mut empty), None);
    }

    #[test]
    fn install_command_names_the_official_source() {
        // Příkaz se uživateli ukazuje dřív, než na něco klikne. Kdyby se
        // adresa změnila, má to shodit test, ne až důvěru.
        assert_eq!(install_command(true), "irm https://claude.ai/install.ps1 | iex");
        assert_eq!(
            install_command(false),
            "curl -fsSL https://claude.ai/install.sh | bash"
        );
    }

    #[test]
    fn path_comes_first_and_the_installer_folder_second() {
        let dir = tempfile::tempdir().unwrap();
        let local = dir.path().join(".local/bin");
        std::fs::create_dir_all(&local).unwrap();
        std::fs::write(local.join("claude"), "").unwrap();

        let found = claude_candidates(Some(dir.path()), false);
        assert_eq!(found[0], "claude", "nejdřív PATH");
        assert!(found[1].ends_with("claude"), "pak složka instalátoru");
        assert_eq!(found.len(), 2);
    }

    /// Smlouva s TypeScriptem.
    ///
    /// Tvar těchhle zpráv čte `src/assistant/api.ts` a nikde se negeneruje,
    /// takže přejmenované pole by se poznalo až za běhu -- panel by mlčel
    /// a nikdo by nevěděl proč. Tady to shodí test.
    #[test]
    fn chunks_serialise_exactly_as_the_frontend_reads_them() {
        let out = serde_json::to_string(&AssistantChunk::Out {
            text: "ahoj".into(),
        })
        .unwrap();
        assert_eq!(out, r#"{"kind":"out","text":"ahoj"}"#);

        let finished = serde_json::to_string(&AssistantChunk::Finished).unwrap();
        assert_eq!(finished, r#"{"kind":"finished"}"#);

        let failed = serde_json::to_string(&AssistantChunk::Failed {
            message: "spadlo".into(),
        })
        .unwrap();
        assert_eq!(failed, r#"{"kind":"failed","message":"spadlo"}"#);
    }

    #[test]
    fn the_probe_serialises_exactly_as_the_frontend_reads_it() {
        let probe = AssistantProbe {
            installed: true,
            version: "2.1.0".into(),
            path: "claude".into(),
            auth: r#"{"loggedIn":true}"#.into(),
            error: String::new(),
        };
        let json: serde_json::Value = serde_json::to_value(&probe).unwrap();
        for key in ["installed", "version", "path", "auth", "error"] {
            assert!(json.get(key).is_some(), "chybí pole {key}");
        }
    }

    #[test]
    fn a_request_arrives_in_the_shape_the_frontend_sends() {
        // `sessionId` a `model` posílá frontend jako `null`, když nejsou.
        let request: AskRequest = serde_json::from_str(
            r#"{"prompt":"co?","system":"buď stručný","sessionId":null,"model":"opus"}"#,
        )
        .unwrap();
        assert_eq!(request.prompt, "co?");
        assert_eq!(request.system, "buď stručný");
        assert_eq!(request.session_id, None);
        assert_eq!(request.model.as_deref(), Some("opus"));
    }

    #[test]
    fn folders_that_do_not_exist_are_not_offered() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(claude_candidates(Some(dir.path()), true), vec!["claude.exe"]);
        assert_eq!(claude_candidates(None, false), vec!["claude"]);
    }
}
