//! Rozhodování kolem gitu a GitHub CLI -- bez procesů a bez Tauri.
//!
//! Spouštění je v `src-tauri/src/git.rs`. Tady je všechno, co je *rozhodnutí*:
//! kde nástroje hledat, co se smí předat jako jméno větve, jaký tvar mají
//! zprávy pro frontend. Tím pádem je to pokryté testy, které běží v CI bez
//! gitu i bez sítě.

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::assistant::StreamChunk;

/// Co Rust zjistil o gitu, GitHub CLI a otevřené složce.
///
/// Smlouva s `src/core/git.ts`; jména polí čte TypeScript beze změny.
#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitProbe {
    pub git_installed: bool,
    pub git_version: String,
    pub git_path: String,
    pub gh_installed: bool,
    pub gh_version: String,
    pub gh_path: String,
    /// Surový JSON z `gh auth status --json hosts`.
    pub gh_auth: String,
    /// Kořen repozitáře, ve kterém otevřená složka leží. Prázdné = není v repu.
    pub repo_root: String,
    pub branch: String,
    /// Výchozí větev repozitáře (`main`, `master`, …).
    ///
    /// Do ní míří pull requesty. Nesmí se plést s `branch`: ta říká, kde
    /// uživatel právě stojí, a po prvním odeslání to je ta `docs/…` větev,
    /// kterou pak zmerguje a GitHub smaže -- PR by neměl kam mířit.
    pub default_branch: String,
    pub head_sha: String,
    pub remote_url: String,
    pub user_name: String,
    pub user_email: String,
    pub git_install_command: String,
    pub gh_install_command: String,
    pub error: String,
}

/// Co Rust zjistil o GitHub CLI, bez ohledu na jakoukoli složku.
///
/// Výběr repozitáře se děje dřív, než je co otevřít, takže se na stav `gh`
/// musí jít zeptat i bez cesty -- `GitProbe` to neumí, ta začíná složkou.
#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GhProbe {
    pub installed: bool,
    pub version: String,
    /// Surový JSON z `gh auth status --json hosts`.
    pub auth: String,
    pub install_command: String,
    pub error: String,
}

/// Vytáhnout z výstupu gitu větu, která se dá ukázat člověku.
///
/// Bez tohohle zbyl z neúspěchu jen návratový kód -- „skončil s kódem 128“
/// neřekne uživateli ani mně vůbec nic a diagnóza pak stojí na hádání.
/// Git své vysvětlení píše na chybový výstup, uvozené `fatal:` nebo `error:`;
/// bere se to poslední, protože předchozí bývají následky, ne příčina.
///
/// Když nic takového není, vrátí se poslední neprázdný řádek. Průběh se dělí
/// i návratem vozíku, takže se řeže podle obojího.
pub fn failure_reason(output: &str) -> Option<String> {
    let lines: Vec<&str> = output
        .split(['\r', '\n'])
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect();

    let pick = lines
        .iter()
        .rev()
        .find(|line| {
            let lower = line.to_ascii_lowercase();
            lower.starts_with("fatal:") || lower.starts_with("error:")
        })
        .or_else(|| lines.last())?;

    let trimmed: String = pick.chars().take(300).collect();
    (!trimmed.is_empty()).then_some(trimmed)
}

/// Smí se to předat jako `vlastnik/nazev`?
///
/// GitHub povoluje ve jménech písmena, číslice, `-`, `_` a `.`. Tohle je
/// poslední kontrola před tím, než se z toho stane argument příkazu, takže
/// nestačí, že to tak přišlo z API.
pub fn is_safe_repo_slug(slug: &str) -> bool {
    let mut parts = slug.split('/');
    let (Some(owner), Some(name), None) = (parts.next(), parts.next(), parts.next()) else {
        return false;
    };
    [owner, name].iter().all(|part| {
        !part.is_empty()
            && part.len() <= 100
            && !part.starts_with('-')
            && !part.starts_with('.')
            && part
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
    })
}

/// Smí to být jméno složky, do které se klonuje?
///
/// Jeden segment, žádné oddělovače, žádné `..` -- aby se klon nemohl objevit
/// jinde než ve složce, kterou uživatel vybral.
pub fn is_safe_folder_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 120
        && name != "."
        && name != ".."
        && !name.starts_with('-')
        && !name.starts_with('.')
        && !name.ends_with('.')
        && !name.ends_with(' ')
        && !name
            .chars()
            // Raw string: jinak by se z lomítek a uvozovek staly neplatné escapy.
            .any(|c| c.is_control() || r#"/\:*?"<>|"#.contains(c))
}

/// Kousky výstupu z `git` a `gh`. Stejný tvar jako u asistenta.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum GitChunk {
    Out { text: String },
    Finished,
    Failed { message: String },
}

impl StreamChunk for GitChunk {
    fn out(text: String) -> Self {
        GitChunk::Out { text }
    }
    fn finished() -> Self {
        GitChunk::Finished
    }
    fn failed(message: String) -> Self {
        GitChunk::Failed { message }
    }
}

/// Co se má odeslat, tak jak to přijde z frontendu.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishRequest {
    /// Otevřená složka -- ta, ke které má uživatel udělený přístup.
    pub folder: String,
    /// Cesty od kořene repa, s lomítky, tak jak je hlásí `git status`.
    pub files: Vec<String>,
    pub message: String,
    pub branch: String,
}

/// Kde hledat `git`, v pořadí, ve kterém se to má zkoušet.
///
/// PATH první. Jenže aplikace spuštěná z nabídky Start dědí jiné prostředí
/// než terminál, takže se zkusí i místa, kam instalátory git dávají.
pub fn git_candidates(windows: bool, macos: bool) -> Vec<String> {
    let mut found = vec![if windows { "git.exe" } else { "git" }.to_string()];
    let extra: &[&str] = if windows {
        &[
            r"C:\Program Files\Git\cmd\git.exe",
            r"C:\Program Files\Git\bin\git.exe",
            r"C:\Program Files (x86)\Git\cmd\git.exe",
        ]
    } else if macos {
        &["/opt/homebrew/bin/git", "/usr/local/bin/git", "/usr/bin/git"]
    } else {
        &["/usr/bin/git", "/usr/local/bin/git"]
    };
    for candidate in extra {
        if Path::new(candidate).exists() {
            found.push((*candidate).to_string());
        }
    }
    found
}

/// Kde hledat `gh`.
pub fn gh_candidates(home: Option<&Path>, windows: bool, macos: bool) -> Vec<String> {
    let mut found = vec![if windows { "gh.exe" } else { "gh" }.to_string()];
    let extra: &[&str] = if windows {
        &[
            r"C:\Program Files\GitHub CLI\gh.exe",
            r"C:\Program Files (x86)\GitHub CLI\gh.exe",
        ]
    } else if macos {
        &["/opt/homebrew/bin/gh", "/usr/local/bin/gh"]
    } else {
        &["/usr/bin/gh", "/usr/local/bin/gh", "/snap/bin/gh"]
    };
    for candidate in extra {
        if Path::new(candidate).exists() {
            found.push((*candidate).to_string());
        }
    }
    if let Some(home) = home {
        let local = home.join(".local/bin").join(if windows { "gh.exe" } else { "gh" });
        if local.exists() {
            found.push(local.to_string_lossy().to_string());
        }
    }
    found
}

/// Příkazy k doinstalování. Ukazují se, nespouštějí -- instalace přes
/// správce balíčků je věc uživatele a jeho terminálu.
pub fn install_commands(windows: bool, macos: bool) -> (String, String) {
    if windows {
        ("winget install --id Git.Git".into(), "winget install --id GitHub.cli".into())
    } else if macos {
        ("brew install git".into(), "brew install gh".into())
    } else {
        ("sudo apt install git".into(), "sudo apt install gh".into())
    }
}

/// Smí se to předat gitu jako jméno větve?
///
/// Zrcadlo `isValidBranchName` z TypeScriptu. Frontend jméno validuje, ale
/// tohle je poslední místo před tím, než se z něj stane argument příkazu --
/// a tam se nespoléhá na nikoho.
pub fn is_safe_branch(name: &str) -> bool {
    if name.is_empty() || name != name.trim() || name == "@" {
        return false;
    }
    if name
        .chars()
        .any(|c| c.is_whitespace() || c.is_control() || "~^:?*[\\".contains(c))
    {
        return false;
    }
    if name.contains("..") || name.contains("@{") || name.contains("//") {
        return false;
    }
    if name.starts_with('-') || name.starts_with('/') || name.ends_with('/') {
        return false;
    }
    if name.ends_with('.') || name.ends_with(".lock") {
        return false;
    }
    !name
        .split('/')
        .any(|part| part.is_empty() || part.starts_with('.') || part.ends_with(".lock"))
}

/// Cesta od kořene repa, jak ji hlásí `git status`: relativní, s lomítky,
/// bez `..`. Cokoli jiného se do `git add` nedostane.
pub fn is_safe_repo_path(path: &str) -> bool {
    !path.is_empty()
        && !path.starts_with('/')
        && !path.starts_with('-')
        && !path.contains('\\')
        && !path.contains('\0')
        && !path.split('/').any(|part| part.is_empty() || part == "..")
        && !(path.len() > 1 && path.as_bytes()[1] == b':')
}

/// Otevírat se smí jen https. Adresy staví náš kód nebo přijdou z API GitHubu,
/// ale poslední kontrola je tady.
pub fn is_https_url(url: &str) -> bool {
    url.starts_with("https://") && !url.chars().any(|c| c.is_whitespace() || c.is_control())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn candidates_start_with_path_and_add_only_what_exists() {
        assert_eq!(git_candidates(false, false)[0], "git");
        assert_eq!(git_candidates(true, false)[0], "git.exe");
        assert_eq!(gh_candidates(None, false, false)[0], "gh");

        let dir = tempfile::tempdir().unwrap();
        assert_eq!(gh_candidates(Some(dir.path()), false, false).len(), gh_candidates(None, false, false).len());
        let local = dir.path().join(".local/bin");
        std::fs::create_dir_all(&local).unwrap();
        std::fs::write(local.join("gh"), "").unwrap();
        let found = gh_candidates(Some(dir.path()), false, false);
        assert!(found.last().unwrap().ends_with("gh"));
        assert!(found.len() > gh_candidates(None, false, false).len());
    }

    #[test]
    fn install_commands_name_the_package_managers() {
        assert_eq!(install_commands(true, false).1, "winget install --id GitHub.cli");
        assert_eq!(install_commands(false, true).0, "brew install git");
        assert_eq!(install_commands(false, false).1, "sudo apt install gh");
    }

    #[test]
    fn branch_names_follow_check_ref_format() {
        for ok in ["main", "docs/2026-09-19-1030", "fix-typo", "release/v1.2", "a.b"] {
            assert!(is_safe_branch(ok), "{ok}");
        }
        for bad in [
            "", " ", "má mezeru", "-x", "/x", "x/", "a..b", "a//b", ".x", "x/.y", "x.", "x.lock", "a~b",
            "a^b", "a:b", "a?b", "a*b", "a[b", "a\\b", "a@{b", "@", " x", "x\n",
        ] {
            assert!(!is_safe_branch(bad), "{bad:?}");
        }
    }

    #[test]
    fn repo_paths_stay_relative_and_inside() {
        for ok in ["README.md", "docs/a b.md", "docs/sub/č.md"] {
            assert!(is_safe_repo_path(ok), "{ok}");
        }
        for bad in ["", "/abs.md", "../ven.md", "docs/../../ven.md", "C:/x.md", "-flag", "a\\b.md", "a//b.md"] {
            assert!(!is_safe_repo_path(bad), "{bad:?}");
        }
    }

    #[test]
    fn repo_slugs_are_owner_slash_name_and_nothing_else() {
        for ok in ["myspulin24/pilcrow", "a-b/c_d.e", "Org1/repo.js"] {
            assert!(is_safe_repo_slug(ok), "{ok}");
        }
        for bad in [
            "", "bez-lomitka", "a/b/c", "/b", "a/", "-a/b", "a/-b", ".a/b", "a b/c", "a/b c",
            "a/b;rm -rf", "a/--flag", "a/b
",
        ] {
            assert!(!is_safe_repo_slug(bad), "{bad:?}");
        }
    }

    #[test]
    fn clone_folder_names_stay_one_segment() {
        for ok in ["pilcrow", "moje-docs", "a_b.c"] {
            assert!(is_safe_folder_name(ok), "{ok}");
        }
        for bad in [
            "", ".", "..", "a/b", r"a\b", "-flag", ".skryta", "konec.", "konec ", "a:b", "a*b", "a\nb",
            "a\"b", "a|b", "a?b", "a<b",
        ] {
            assert!(!is_safe_folder_name(bad), "{bad:?}");
        }
    }

    #[test]
    fn failure_reason_prefers_what_git_actually_said() {
        // Tohle je ten rozdíl mezi „skončil s kódem 128“ a použitelnou hláškou.
        assert_eq!(
            failure_reason("From github.com:o/r\nfatal: Not possible to fast-forward, aborting.\n")
                .as_deref(),
            Some("fatal: Not possible to fast-forward, aborting.")
        );
        // Poslední fatální řádek vyhrává: ty předchozí bývají následky.
        assert_eq!(
            failure_reason("error: cannot lock ref\nfatal: the real problem\n").as_deref(),
            Some("fatal: the real problem")
        );
        assert_eq!(
            failure_reason("error: Unable to create index.lock: File exists.").as_deref(),
            Some("error: Unable to create index.lock: File exists.")
        );
    }

    #[test]
    fn failure_reason_falls_back_to_the_last_line() {
        assert_eq!(
            failure_reason("Updating files\nsomething odd happened").as_deref(),
            Some("something odd happened")
        );
        // Průběh gitu je oddělený návratem vozíku, ne koncem řádku.
        assert_eq!(
            failure_reason("Receiving objects: 50%\rReceiving objects: 99%\r").as_deref(),
            Some("Receiving objects: 99%")
        );
        assert_eq!(failure_reason(""), None);
        assert_eq!(failure_reason("   \n\r\n  "), None);
    }

    #[test]
    fn failure_reason_does_not_dump_a_whole_log() {
        let long = format!("fatal: {}", "x".repeat(1000));
        let reason = failure_reason(&long).unwrap();
        assert_eq!(reason.chars().count(), 300);
    }

    #[test]
    fn only_https_opens() {
        assert!(is_https_url("https://github.com/a/b/compare/main...x?expand=1"));
        assert!(!is_https_url("http://github.com/a"));
        assert!(!is_https_url("file:///etc/passwd"));
        assert!(!is_https_url("https://github.com/a b"));
    }

    /// Smlouva s TypeScriptem -- viz `chunks_serialise_exactly_as_the_frontend_reads_them`
    /// u asistenta. Stejný důvod, jiný modul.
    #[test]
    fn chunks_and_probe_serialise_as_the_frontend_reads_them() {
        assert_eq!(
            serde_json::to_string(&GitChunk::out("x".into())).unwrap(),
            r#"{"kind":"out","text":"x"}"#
        );
        assert_eq!(serde_json::to_string(&GitChunk::finished()).unwrap(), r#"{"kind":"finished"}"#);
        assert_eq!(
            serde_json::to_string(&GitChunk::failed("spadlo".into())).unwrap(),
            r#"{"kind":"failed","message":"spadlo"}"#
        );

        let json: serde_json::Value = serde_json::to_value(GitProbe::default()).unwrap();
        for key in [
            "gitInstalled", "gitVersion", "gitPath", "ghInstalled", "ghVersion", "ghPath", "ghAuth", "repoRoot",
            "branch", "headSha", "remoteUrl", "userName", "userEmail", "gitInstallCommand", "ghInstallCommand",
            "error",
        ] {
            assert!(json.get(key).is_some(), "chybí pole {key}");
        }
    }

    #[test]
    fn a_publish_request_arrives_in_the_shape_the_frontend_sends() {
        let request: PublishRequest = serde_json::from_str(
            r#"{"folder":"C:/r/docs","files":["docs/a.md"],"message":"Dokumentace: a.md","branch":"docs/x"}"#,
        )
        .unwrap();
        assert_eq!(request.folder, "C:/r/docs");
        assert_eq!(request.files, vec!["docs/a.md"]);
        assert_eq!(request.branch, "docs/x");
    }
}
