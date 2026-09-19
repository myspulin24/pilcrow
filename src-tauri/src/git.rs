//! Spuštění `git` a `gh` nad otevřenou složkou a přeposílání toho, co vypíší.
//!
//! Stejně hloupý soubor jako `assistant.rs`, a ze stejného důvodu: rozumět
//! výstupu se učí `src/core/git.ts`, tady se jen spouští konkrétní program
//! s konkrétními argumenty. Žádný shell, žádné skládání příkazů z textu.
//!
//! Tři pravidla, která tenhle soubor hlídá a frontend na ně nemá vliv:
//!
//!  1. **Přístup.** Každý příkaz začíná složkou, ke které uživatel udělil
//!     přístup v dialogu. Soubory do commitu musí ležet v ní -- i když kořen
//!     repa je výš.
//!  2. **Z GitHubu se jen čte.** `gh api` se volá bez metody, tedy GET, a jen
//!     na cesty, které tu jsou napsané. Spouštět běhy nebo měnit workflow
//!     odsud nejde.
//!  3. **Nikdy se neptá terminálu.** Git ani gh nedostanou terminál, takže
//!     místo čekání na heslo, které nikdo nezadá, skončí chybou, kterou
//!     uživatel uvidí.
//!
//! Přihlášení k pushi si git půjčí od `gh` -- jen pro ten jeden příkaz,
//! přes `-c credential.helper`. Do globální konfigurace gitu se nesahá.

use std::path::{Path, PathBuf};
use std::process::{Child, Command, Output, Stdio};
use std::sync::{Arc, Mutex};

use tauri::ipc::Channel;
use tauri::{AppHandle, State};

use pilcrow_core::error::{CoreError, Result};
use pilcrow_core::git::{
    gh_candidates, git_candidates, install_commands, is_https_url, is_safe_branch,
    is_safe_folder_name, is_safe_repo_path, is_safe_repo_slug, GhProbe, GitChunk, GitProbe,
    PublishRequest,
};

use crate::assistant::{hide_console, home, pump, Killable};
use crate::state::AppState;

/// Co drží aplikace mezi voláními.
#[derive(Default)]
pub struct GitState {
    git: Mutex<Option<String>>,
    gh: Mutex<Option<String>>,
    /// Běžící odeslání nebo push, aby šlo zrušit.
    running: Arc<Mutex<Option<Child>>>,
    /// Běžící přihlašování k GitHubu.
    login: Arc<Mutex<Option<Child>>>,
}

// -- spouštění --------------------------------------------------------------

/// Příkaz, který se nikdy nezeptá terminálu.
fn base_command(program: &str) -> Command {
    let mut command = Command::new(program);
    command
        .stdin(Stdio::null())
        // Bez terminálu by git čekal na heslo, které nikdo nezadá; takhle
        // rovnou selže a chyba dojde do panelu.
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GCM_INTERACTIVE", "never")
        .env("GH_PROMPT_DISABLED", "1")
        .env("GH_NO_UPDATE_NOTIFIER", "1")
        .env("NO_COLOR", "1");
    hide_console(&mut command);
    command
}

fn run_in(program: &str, dir: Option<&Path>, args: &[&str]) -> std::io::Result<Output> {
    let mut command = base_command(program);
    command.args(args);
    if let Some(dir) = dir {
        command.current_dir(dir);
    }
    command.output()
}

fn stdout_of(output: &Output) -> String {
    String::from_utf8_lossy(&output.stdout).trim().to_string()
}

fn stderr_of(output: &Output) -> String {
    String::from_utf8_lossy(&output.stderr).trim().to_string()
}

/// První kandidát, který odpoví na `--version`; nalezená cesta se pamatuje.
fn locate(slot: &Mutex<Option<String>>, candidates: Vec<String>) -> Option<(String, String)> {
    if let Some(cached) = slot.lock().ok().and_then(|held| held.clone()) {
        if let Ok(output) = run_in(&cached, None, &["--version"]) {
            if output.status.success() {
                return Some((cached, stdout_of(&output)));
            }
        }
    }
    for candidate in candidates {
        let Ok(output) = run_in(&candidate, None, &["--version"]) else {
            continue;
        };
        if !output.status.success() {
            continue;
        }
        if let Ok(mut held) = slot.lock() {
            *held = Some(candidate.clone());
        }
        return Some((candidate, stdout_of(&output)));
    }
    None
}

fn locate_git(state: &GitState) -> Option<(String, String)> {
    locate(&state.git, git_candidates(cfg!(windows), cfg!(target_os = "macos")))
}

fn locate_gh(state: &GitState) -> Option<(String, String)> {
    locate(
        &state.gh,
        gh_candidates(home().as_deref(), cfg!(windows), cfg!(target_os = "macos")),
    )
}

fn require_git(state: &GitState) -> Result<String> {
    locate_git(state)
        .map(|(path, _)| path)
        .ok_or_else(|| CoreError::Unavailable("Git na tomhle počítači není.".into()))
}

fn require_gh(state: &GitState) -> Result<String> {
    locate_gh(state)
        .map(|(path, _)| path)
        .ok_or_else(|| CoreError::Unavailable("GitHub CLI na tomhle počítači není.".into()))
}

/// Složka, ke které uživatel udělil přístup. Odsud začíná každý příkaz.
fn granted_folder(app: &AppState, folder: &str) -> Result<PathBuf> {
    let path = PathBuf::from(folder);
    if !path.is_dir() {
        return Err(CoreError::NotFound(format!("{} není složka.", path.display())));
    }
    app.with_access(|access| access.require(&path))?;
    Ok(path)
}

/// Kořen repa nad složkou. `None`, když složka v žádném repu není.
fn repo_root(git: &str, folder: &Path) -> Option<PathBuf> {
    let output = run_in(git, Some(folder), &["rev-parse", "--show-toplevel"]).ok()?;
    if !output.status.success() {
        return None;
    }
    let text = stdout_of(&output);
    (!text.is_empty()).then(|| PathBuf::from(text))
}

fn require_root(git: &str, folder: &Path) -> Result<PathBuf> {
    repo_root(git, folder).ok_or_else(|| {
        CoreError::NotFound(format!(
            "{} není v žádném repozitáři gitu.",
            folder.display()
        ))
    })
}

/// Hodnota z gitu, nebo prázdno. Nepřítomný remote není chyba, jen prázdné pole.
fn git_value(git: &str, dir: &Path, args: &[&str]) -> String {
    run_in(git, Some(dir), args)
        .ok()
        .filter(|output| output.status.success())
        .map(|output| stdout_of(&output))
        .unwrap_or_default()
}

// -- stav -------------------------------------------------------------------

/// Co je na tomhle počítači a v téhle složce.
///
/// Několik rychlých spuštění, nic se nekešuje: sekce se ptá po otevření složky
/// a po každém kroku a má vidět dnešek.
#[tauri::command]
pub async fn git_probe(
    app: State<'_, AppState>,
    state: State<'_, GitState>,
    folder: String,
) -> Result<GitProbe> {
    let folder = granted_folder(&app, &folder)?;
    let (git_install_command, gh_install_command) =
        install_commands(cfg!(windows), cfg!(target_os = "macos"));
    let mut probe = GitProbe {
        git_install_command,
        gh_install_command,
        ..GitProbe::default()
    };

    let Some((git, git_version)) = locate_git(&state) else {
        return Ok(probe);
    };
    probe.git_installed = true;
    probe.git_version = git_version;
    probe.git_path = git.clone();

    if let Some(root) = repo_root(&git, &folder) {
        probe.repo_root = root.to_string_lossy().to_string();
        probe.branch = git_value(&git, &root, &["rev-parse", "--abbrev-ref", "HEAD"]);
        probe.head_sha = git_value(&git, &root, &["rev-parse", "HEAD"]);
        probe.remote_url = git_value(&git, &root, &["remote", "get-url", "origin"]);
        probe.user_name = git_value(&git, &root, &["config", "user.name"]);
        probe.user_email = git_value(&git, &root, &["config", "user.email"]);
    }

    if let Some((gh, gh_version)) = locate_gh(&state) {
        probe.gh_installed = true;
        probe.gh_version = gh_version;
        probe.gh_path = gh.clone();
        match run_in(&gh, None, &["auth", "status", "--json", "hosts"]) {
            Ok(output) => {
                let text = stdout_of(&output);
                if text.is_empty() {
                    probe.error = stderr_of(&output);
                } else {
                    probe.gh_auth = text;
                }
            }
            Err(error) => probe.error = format!("`gh auth status` selhal: {error}"),
        }
    }

    Ok(probe)
}

/// `git status` omezený na otevřenou složku.
///
/// Pathspec je ta složka, ne celé repo: co je mimo ni, uživatel v Pilcrow
/// neotevřel a nemá to co vidět ani commitovat. `--untracked-files=all`
/// proto, aby se nový soubor v nové podsložce ukázal jménem, ne jako `dir/`.
#[tauri::command]
pub async fn git_status(
    app: State<'_, AppState>,
    state: State<'_, GitState>,
    folder: String,
) -> Result<String> {
    let folder = granted_folder(&app, &folder)?;
    let git = require_git(&state)?;
    let root = require_root(&git, &folder)?;
    let pathspec = folder.to_string_lossy().to_string();
    let output = run_in(
        &git,
        Some(&root),
        &["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", &pathspec],
    )
    .map_err(|error| CoreError::Io(format!("`git status` se nepodařilo spustit: {error}")))?;

    if !output.status.success() {
        let details = stderr_of(&output);
        return Err(CoreError::Io(if details.is_empty() {
            "`git status` selhal.".into()
        } else {
            details
        }));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

// -- proudové spuštění ------------------------------------------------------

/// Spustit jeden krok, přelít oba jeho výstupy do panelu a počkat na konec.
///
/// `true` znamená úspěch. Neúspěch už je ohlášený (`Failed`), volající jen
/// přestane. Potomek sedí ve sdíleném slotu, aby ho mohlo zrušit tlačítko.
///
/// Chybový výstup má vlastní vlákno: git tam píše průběh pushe a číst obě
/// roury střídavě by znamenalo čekat na tu, která zrovna mlčí.
fn run_step(
    mut command: Command,
    label: &str,
    channel: &Channel<GitChunk>,
    slot: &Arc<Mutex<Option<Child>>>,
) -> bool {
    let _ = channel.send(GitChunk::Out {
        text: format!("$ {label}\n"),
    });
    command.stdout(Stdio::piped()).stderr(Stdio::piped());

    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            let _ = channel.send(GitChunk::Failed {
                message: format!("{label}: nepodařilo se spustit ({error})."),
            });
            return false;
        }
    };
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    if let Ok(mut held) = slot.lock() {
        *held = Some(child);
    }

    let stderr_thread = stderr.map(|source| {
        let channel = channel.clone();
        let slot = Arc::clone(slot);
        std::thread::spawn(move || pump(source, &channel, slot))
    });
    let stdout_ok = stdout
        .map(|source| pump(source, channel, Arc::clone(slot)))
        .unwrap_or(true);
    let stderr_ok = stderr_thread
        .map(|thread| thread.join().unwrap_or(false))
        .unwrap_or(true);

    let held = slot.lock().ok().and_then(|mut held| held.take());
    let Some(mut child) = held else {
        // Někdo zatím stiskl „Zrušit“.
        let _ = channel.send(GitChunk::Failed {
            message: "Zrušeno.".into(),
        });
        return false;
    };
    if !stdout_ok || !stderr_ok {
        // Čtení skončilo předčasně: chyba už odešla, nebo frontend přestal
        // poslouchat. Jen po sobě uklidit.
        let _ = child.wait_now();
        return false;
    }

    match child.wait_now() {
        Ok(status) if status.success() => true,
        Ok(status) => {
            let _ = channel.send(GitChunk::Failed {
                message: format!("{label} skončil s kódem {}.", status.code().unwrap_or(-1)),
            });
            false
        }
        Err(error) => {
            let _ = channel.send(GitChunk::Failed {
                message: format!("Na {label} se nepodařilo počkat: {error}"),
            });
            false
        }
    }
}

/// Argumenty pro push. Přihlášení si půjčí od `gh`, když je a když jde o GitHub.
///
/// Prázdný `credential.helper=` první vyřadí globální helpery -- jinak by se
/// Git Credential Manager mohl zeptat oknem přes aplikaci. Pak přijde `gh`
/// jako jediný helper, a jen pro tenhle příkaz.
fn push_args(gh: Option<&str>, github: bool, branch: &str) -> Vec<String> {
    let mut args = Vec::new();
    if let (Some(gh), true) = (gh, github) {
        args.push("-c".into());
        args.push("credential.helper=".into());
        args.push("-c".into());
        args.push(format!(
            "credential.helper=!'{}' auth git-credential",
            gh.replace('\\', "/")
        ));
    }
    args.extend(["push", "-u", "origin", branch].map(String::from));
    args
}

/// Cesta souboru v repu musí ležet v otevřené složce. Smazaný soubor už na
/// disku není, tak se ověří jeho složka.
fn require_inside(app: &AppState, root: &Path, file: &str) -> Result<()> {
    if !is_safe_repo_path(file) {
        return Err(CoreError::InvalidName(format!(
            "{file} není platná cesta v repozitáři."
        )));
    }
    let absolute = root.join(file);
    let check = if absolute.exists() {
        absolute
    } else {
        absolute
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or(absolute)
    };
    app.with_access(|access| access.require(&check))
}

/// Odeslat vybrané soubory: nová větev, add, commit, push.
///
/// Čtyři kroky za sebou na vlastním vlákně; první neúspěch zastaví zbytek
/// a repo zůstane v poctivém stavu -- třeba na nové větvi s commitem, ale
/// bez pushe, což jde napravit `git_push`.
#[tauri::command]
pub async fn git_publish(
    app: State<'_, AppState>,
    state: State<'_, GitState>,
    request: PublishRequest,
    channel: Channel<GitChunk>,
) -> Result<()> {
    let folder = granted_folder(&app, &request.folder)?;
    let git = require_git(&state)?;
    let root = require_root(&git, &folder)?;

    if !is_safe_branch(&request.branch) {
        return Err(CoreError::InvalidName(
            "Tohle se větev jmenovat nemůže.".into(),
        ));
    }
    if request.message.trim().is_empty() {
        return Err(CoreError::InvalidName(
            "Zpráva commitu nemůže být prázdná.".into(),
        ));
    }
    if request.files.is_empty() {
        return Err(CoreError::InvalidName(
            "Není co odeslat: žádný soubor není vybraný.".into(),
        ));
    }
    for file in &request.files {
        require_inside(&app, &root, file)?;
    }

    let gh = locate_gh(&state).map(|(path, _)| path);
    let github = git_value(&git, &root, &["remote", "get-url", "origin"]).contains("github.com");

    let slot = Arc::clone(&state.running);
    if let Ok(mut held) = slot.lock() {
        if let Some(previous) = held.as_mut() {
            previous.kill_now();
        }
    }

    std::thread::spawn(move || {
        let mut add: Vec<String> = vec!["add".into(), "--".into()];
        add.extend(request.files.iter().cloned());

        let steps: Vec<(String, Vec<String>)> = vec![
            (
                format!("git checkout -b {}", request.branch),
                vec!["checkout".into(), "-b".into(), request.branch.clone()],
            ),
            (format!("git add -- {}", request.files.join(" ")), add),
            (
                "git commit".into(),
                vec!["commit".into(), "-m".into(), request.message.clone()],
            ),
            (
                format!("git push -u origin {}", request.branch),
                push_args(gh.as_deref(), github, &request.branch),
            ),
        ];

        for (label, args) in steps {
            let mut command = base_command(&git);
            command.current_dir(&root).args(&args);
            if !run_step(command, &label, &channel, &slot) {
                return;
            }
        }
        let _ = channel.send(GitChunk::Finished);
    });
    Ok(())
}

/// Znovu pushnout větev, když první push selhal. Commit už je.
#[tauri::command]
pub async fn git_push(
    app: State<'_, AppState>,
    state: State<'_, GitState>,
    folder: String,
    branch: String,
    channel: Channel<GitChunk>,
) -> Result<()> {
    let folder = granted_folder(&app, &folder)?;
    let git = require_git(&state)?;
    let root = require_root(&git, &folder)?;
    if !is_safe_branch(&branch) {
        return Err(CoreError::InvalidName(
            "Tohle se větev jmenovat nemůže.".into(),
        ));
    }

    let gh = locate_gh(&state).map(|(path, _)| path);
    let github = git_value(&git, &root, &["remote", "get-url", "origin"]).contains("github.com");
    let slot = Arc::clone(&state.running);

    std::thread::spawn(move || {
        let mut command = base_command(&git);
        command
            .current_dir(&root)
            .args(push_args(gh.as_deref(), github, &branch));
        if run_step(command, &format!("git push -u origin {branch}"), &channel, &slot) {
            let _ = channel.send(GitChunk::Finished);
        }
    });
    Ok(())
}

/// Zastavit rozběhnuté odeslání.
#[tauri::command]
pub fn git_cancel(state: State<'_, GitState>) {
    if let Ok(mut held) = state.running.lock() {
        if let Some(mut child) = held.take() {
            child.kill_now();
        }
    }
}

// -- GitHub: jen čtení ------------------------------------------------------

/// `gh api <cesta>` bez metody, tedy GET. Cesty jsou jen ty napsané níže.
fn gh_get(state: &GitState, root: &Path, path: &str) -> Result<String> {
    let gh = require_gh(state)?;
    let output = run_in(&gh, Some(root), &["api", path])
        .map_err(|error| CoreError::Io(format!("`gh api` se nepodařilo spustit: {error}")))?;
    if !output.status.success() {
        let details = stderr_of(&output);
        return Err(CoreError::Io(if details.is_empty() {
            format!("`gh api {path}` selhal.")
        } else {
            details
        }));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

fn is_sha(value: &str) -> bool {
    (7..=64).contains(&value.len()) && value.chars().all(|c| c.is_ascii_hexdigit())
}

/// Běhy Actions pro daný commit -- tedy *ten svůj*, ne poslední v repu.
#[tauri::command]
pub async fn gh_runs(
    app: State<'_, AppState>,
    state: State<'_, GitState>,
    folder: String,
    head_sha: String,
) -> Result<String> {
    let folder = granted_folder(&app, &folder)?;
    let git = require_git(&state)?;
    let root = require_root(&git, &folder)?;
    if !is_sha(&head_sha) {
        return Err(CoreError::InvalidName(format!("{head_sha} není SHA commitu.")));
    }
    gh_get(
        &state,
        &root,
        &format!("repos/{{owner}}/{{repo}}/actions/runs?head_sha={head_sha}&per_page=20"),
    )
}

/// Úlohy a kroky jednoho běhu.
#[tauri::command]
pub async fn gh_jobs(
    app: State<'_, AppState>,
    state: State<'_, GitState>,
    folder: String,
    run_id: u64,
) -> Result<String> {
    let folder = granted_folder(&app, &folder)?;
    let git = require_git(&state)?;
    let root = require_root(&git, &folder)?;
    gh_get(
        &state,
        &root,
        &format!("repos/{{owner}}/{{repo}}/actions/runs/{run_id}/jobs?per_page=100"),
    )
}

/// Posledních deset běhů v repu, k nahlédnutí.
#[tauri::command]
pub async fn gh_recent_runs(
    app: State<'_, AppState>,
    state: State<'_, GitState>,
    folder: String,
) -> Result<String> {
    let folder = granted_folder(&app, &folder)?;
    let git = require_git(&state)?;
    let root = require_root(&git, &folder)?;
    gh_get(&state, &root, "repos/{owner}/{repo}/actions/runs?per_page=10")
}

// -- přihlášení -------------------------------------------------------------

/// Přihlásit GitHub CLI přes prohlížeč.
///
/// `gh auth login --web` bez terminálu vypíše jednorázový kód a adresu a čeká,
/// až ho uživatel v prohlížeči zadá. Kód jde do panelu, Pilcrow ho nikam
/// neposílá ani neukládá -- token si `gh` uloží do klíčenky sám.
#[tauri::command]
pub async fn gh_login(state: State<'_, GitState>, channel: Channel<GitChunk>) -> Result<()> {
    let gh = require_gh(&state)?;
    let mut command = base_command(&gh);
    command.args([
        "auth",
        "login",
        "--web",
        "--hostname",
        "github.com",
        "--git-protocol",
        "https",
        "--skip-ssh-key",
    ]);

    let slot = Arc::clone(&state.login);
    if let Ok(mut held) = slot.lock() {
        if let Some(previous) = held.as_mut() {
            previous.kill_now();
        }
    }
    std::thread::spawn(move || {
        if run_step(command, "gh auth login --web", &channel, &slot) {
            let _ = channel.send(GitChunk::Finished);
        }
    });
    Ok(())
}

/// Zrušit rozdělané přihlašování.
#[tauri::command]
pub fn gh_login_cancel(state: State<'_, GitState>) {
    if let Ok(mut held) = state.login.lock() {
        if let Some(mut child) = held.take() {
            child.kill_now();
        }
    }
}

// -- prohlížeč --------------------------------------------------------------

/// Otevřít stránku PR nebo běhu v prohlížeči. Jen https.
#[tauri::command]
pub fn open_url(app: AppHandle, url: String) -> Result<()> {
    use tauri_plugin_opener::OpenerExt;

    if !is_https_url(&url) {
        return Err(CoreError::InvalidName(
            "Otevírat se smí jen adresy https.".into(),
        ));
    }
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|error| CoreError::Io(format!("Prohlížeč se nepodařilo otevřít: {error}")))
}

/// Workflows, které v repozitáři existují.
///
/// Slouží k jediné otázce: má vůbec smysl čekat na běh? Repozitář bez
/// workflows žádný nespustí, a mlčky u toho čekat tři minuty je horší než
/// to rovnou říct.
#[tauri::command]
pub async fn gh_workflows(
    app: State<'_, AppState>,
    state: State<'_, GitState>,
    folder: String,
) -> Result<String> {
    let folder = granted_folder(&app, &folder)?;
    let git = require_git(&state)?;
    let root = require_root(&git, &folder)?;
    gh_get(&state, &root, "repos/{owner}/{repo}/actions/workflows")
}

/// Založit pull request bez prohlížeče.
///
/// `gh pr create` vypíše na výstup adresu hotového PR; ta se vrací frontendu,
/// aby ji mohl ukázat. Prázdný popis je v pořádku -- název je povinný.
#[tauri::command]
pub async fn gh_pr_create(
    app: State<'_, AppState>,
    state: State<'_, GitState>,
    folder: String,
    base: String,
    head: String,
    title: String,
    body: String,
) -> Result<String> {
    let folder = granted_folder(&app, &folder)?;
    let git = require_git(&state)?;
    let root = require_root(&git, &folder)?;

    if !is_safe_branch(&base) || !is_safe_branch(&head) {
        return Err(CoreError::InvalidName(
            "Tohle se větev jmenovat nemůže.".into(),
        ));
    }
    if title.trim().is_empty() {
        return Err(CoreError::InvalidName(
            "Název pull requestu nemůže být prázdný.".into(),
        ));
    }

    let gh = require_gh(&state)?;
    let output = run_in(
        &gh,
        Some(&root),
        &[
            "pr", "create", "--base", &base, "--head", &head, "--title", title.trim(), "--body",
            &body,
        ],
    )
    .map_err(|error| CoreError::Io(format!("`gh pr create` se nepodařilo spustit: {error}")))?;

    if !output.status.success() {
        let details = stderr_of(&output);
        return Err(CoreError::Io(if details.is_empty() {
            "Pull request se nepodařilo založit.".into()
        } else {
            details
        }));
    }

    // Adresa je poslední neprázdný řádek; `gh` před ni občas vypíše poznámku.
    let text = stdout_of(&output);
    let url = text
        .lines()
        .rev()
        .map(str::trim)
        .find(|line| line.starts_with("https://"))
        .unwrap_or(&text)
        .to_string();
    Ok(url)
}

// -- výběr repozitáře -------------------------------------------------------

/// Stav GitHub CLI bez ohledu na složku.
///
/// Repozitář se vybírá dřív, než je co otevřít, takže `git_probe` -- která
/// začíná složkou -- se na tohle zeptat nedá.
#[tauri::command]
pub async fn gh_status(state: State<'_, GitState>) -> Result<GhProbe> {
    let (_, install_command) = install_commands(cfg!(windows), cfg!(target_os = "macos"));
    let mut probe = GhProbe {
        install_command,
        ..GhProbe::default()
    };

    let Some((gh, version)) = locate_gh(&state) else {
        return Ok(probe);
    };
    probe.installed = true;
    probe.version = version;

    match run_in(&gh, None, &["auth", "status", "--json", "hosts"]) {
        Ok(output) => {
            let text = stdout_of(&output);
            if text.is_empty() {
                probe.error = stderr_of(&output);
            } else {
                probe.auth = text;
            }
        }
        Err(error) => probe.error = format!("`gh auth status` selhal: {error}"),
    }
    Ok(probe)
}

/// Repozitáře, ke kterým má přihlášený uživatel přístup.
///
/// `affiliation` je schválně široké: vlastní, organizační i ty, kam je někdo
/// přizvaný jako spolupracovník. Strop je sto -- víc by znamenalo stránkovat
/// a seznam, ve kterém se stejně hledá, nemá cenu mít delší.
///
/// Čtení, nic jiného: `gh api` bez metody je GET.
#[tauri::command]
pub async fn gh_repos(state: State<'_, GitState>) -> Result<String> {
    let gh = require_gh(&state)?;
    let output = run_in(
        &gh,
        None,
        &[
            "api",
            "user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member",
        ],
    )
    .map_err(|error| CoreError::Io(format!("`gh api` se nepodařilo spustit: {error}")))?;

    if !output.status.success() {
        let details = stderr_of(&output);
        return Err(CoreError::Io(if details.is_empty() {
            "Seznam repozitářů se nepodařilo načíst.".into()
        } else {
            details
        }));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

/// Projít složku s repozitáři a zjistit, co v ní už leží.
///
/// Vrací dvojice cesta + `origin`; párovat se pak musí podle remote, ne podle
/// jména složky -- `things-3` klidně může být repo `Notes_MJ`.
///
/// Složku přitom povolí. Je z nastavení, kam se dostala výběrem v dialogu,
/// takže je to stejná úmluva jako u [`reopen_folder`](crate::commands::reopen_folder):
/// cestu vybral uživatel, jen v jiném spuštění.
#[tauri::command]
pub async fn scan_clones(
    app: State<'_, AppState>,
    state: State<'_, GitState>,
    folder: String,
) -> Result<String> {
    let root = PathBuf::from(&folder);
    if !root.is_dir() {
        return Ok("[]".into());
    }
    app.with_access(|access| {
        access.grant_dir(&root);
        Ok(())
    })?;
    let git = require_git(&state)?;

    let Ok(entries) = std::fs::read_dir(&root) else {
        return Ok("[]".into());
    };
    let mut found = Vec::new();
    for entry in entries.filter_map(std::result::Result::ok) {
        let path = entry.path();
        if !path.join(".git").exists() {
            continue;
        }
        found.push(serde_json::json!({
            "path": path.to_string_lossy(),
            "remote": git_value(&git, &path, &["remote", "get-url", "origin"]),
        }));
    }

    serde_json::to_string(&found)
        .map_err(|error| CoreError::Io(format!("Seznam se nepodařilo sestavit: {error}")))
}

/// Stáhnout repozitář do složky, kterou uživatel vybral.
///
/// Cílová cesta se vrací hned; jestli se stahování povedlo, řekne kanál.
/// `gh repo clone` schválně místo holého `git clone`: umí soukromá repa bez
/// řešení přihlášení a u forku rovnou nastaví `upstream`.
///
/// Existující složku nikdy nepřepíše -- klonovat přes cizí data by byl
/// nejdražší možný omyl.
#[tauri::command]
pub async fn gh_clone(
    app: State<'_, AppState>,
    state: State<'_, GitState>,
    repo: String,
    parent: String,
    folder: String,
    channel: Channel<GitChunk>,
) -> Result<String> {
    if !is_safe_repo_slug(&repo) {
        return Err(CoreError::InvalidName(format!(
            "{repo} není platné jméno repozitáře."
        )));
    }
    if !is_safe_folder_name(&folder) {
        return Err(CoreError::InvalidName(format!(
            "{folder} není platné jméno složky."
        )));
    }

    let root = PathBuf::from(&parent);
    if !root.is_dir() {
        return Err(CoreError::NotFound(format!(
            "{} není složka.",
            root.display()
        )));
    }
    app.with_access(|access| {
        access.grant_dir(&root);
        Ok(())
    })?;

    let target = root.join(&folder);
    if target.exists() {
        return Err(CoreError::Duplicate(format!(
            "{} už existuje. Buď ji přejmenuj, nebo repozitář rovnou otevři.",
            target.display()
        )));
    }

    let gh = require_gh(&state)?;
    let target_text = target.to_string_lossy().to_string();
    let label = format!("gh repo clone {repo}");
    let clone_target = target_text.clone();

    let slot = Arc::clone(&state.running);
    if let Ok(mut held) = slot.lock() {
        if let Some(previous) = held.as_mut() {
            previous.kill_now();
        }
    }

    std::thread::spawn(move || {
        let mut command = base_command(&gh);
        // `--progress` schválně: bez terminálu git mlčí a u velkého
        // repozitáře by panel vypadal zaseknutě.
        command.args(["repo", "clone", &repo, &clone_target, "--", "--progress"]);
        if run_step(command, &label, &channel, &slot) {
            let _ = channel.send(GitChunk::Finished);
        }
    });
    Ok(target_text)
}

#[cfg(test)]
mod tests {
    //! Proti skutečnému gitu: dočasné repo s bare remotem vedle. Bez sítě
    //! a bez GitHubu -- ale příkazy, které se posílají, jsou ty ostré.
    //! Paměťové testy ve frontendu dokazují, co udělá UI; tohle dokazuje,
    //! co udělá git.

    use super::*;
    use std::fs;

    use tauri::ipc::InvokeResponseBody;

    fn git(dir: &Path, args: &[&str]) -> String {
        let output = run_in("git", Some(dir), args).expect("git se spustí");
        assert!(output.status.success(), "git {args:?}: {}", stderr_of(&output));
        stdout_of(&output)
    }

    /// Pracovní repo s jedním commitem na `main` a bare remote `origin` vedle.
    fn repo_with_remote() -> (tempfile::TempDir, PathBuf, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let origin = dir.path().join("origin.git");
        let work = dir.path().join("work");
        fs::create_dir_all(work.join("docs")).unwrap();
        git(&work, &["init", "-q", "-b", "main"]);
        git(&work, &["config", "user.name", "Test"]);
        git(&work, &["config", "user.email", "test@example.com"]);
        fs::write(work.join("docs/a.md"), "# A\n").unwrap();
        fs::write(work.join("README.md"), "# R\n").unwrap();
        git(&work, &["add", "."]);
        git(&work, &["commit", "-q", "-m", "init"]);
        git(dir.path(), &["init", "-q", "--bare", origin.to_str().unwrap()]);
        git(&work, &["remote", "add", "origin", origin.to_str().unwrap()]);
        git(&work, &["push", "-q", "-u", "origin", "main"]);
        (dir, origin, work)
    }

    /// Kanál, který si kousky schová jako JSON -- to, co by viděl frontend.
    fn collecting_channel() -> (Channel<GitChunk>, Arc<Mutex<Vec<String>>>) {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let sink = Arc::clone(&seen);
        let channel = Channel::new(move |body: InvokeResponseBody| {
            if let InvokeResponseBody::Json(json) = body {
                sink.lock().unwrap().push(json);
            }
            Ok(())
        });
        (channel, seen)
    }

    #[test]
    fn repo_root_is_found_from_a_subfolder() {
        let (_dir, _origin, work) = repo_with_remote();
        let root = repo_root("git", &work.join("docs")).expect("docs leží v repu");
        assert_eq!(root.canonicalize().unwrap(), work.canonicalize().unwrap());
        assert_eq!(git_value("git", &root, &["rev-parse", "--abbrev-ref", "HEAD"]), "main");
        assert!(git_value("git", &root, &["remote", "get-url", "origin"]).ends_with("origin.git"));
    }

    #[test]
    fn status_is_scoped_to_the_opened_folder() {
        let (_dir, _origin, work) = repo_with_remote();
        let docs = work.join("docs");
        fs::write(docs.join("a.md"), "# A\n\nzměna\n").unwrap();
        fs::write(docs.join("nový soubor.md"), "# N\n").unwrap();
        fs::write(work.join("README.md"), "# R2\n").unwrap();

        let output = run_in(
            "git",
            Some(&work),
            &["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", docs.to_str().unwrap()],
        )
        .unwrap();
        assert!(output.status.success(), "{}", stderr_of(&output));
        let text = String::from_utf8_lossy(&output.stdout).to_string();
        assert!(text.contains(" M docs/a.md\0"), "{text:?}");
        assert!(text.contains("?? docs/nový soubor.md\0"), "mezera i diakritika bez uvozovek: {text:?}");
        assert!(!text.contains("README.md"), "mimo otevřenou složku se nehlásí: {text:?}");
    }

    #[test]
    fn the_publish_steps_land_exactly_the_chosen_files_on_the_remote() {
        let (_dir, origin, work) = repo_with_remote();
        fs::write(work.join("docs/a.md"), "# A\n\nzměna\n").unwrap();
        // Změněné, ale nevybrané: musí zůstat doma.
        fs::write(work.join("README.md"), "# R2\n").unwrap();

        let (channel, seen) = collecting_channel();
        let slot: Arc<Mutex<Option<Child>>> = Arc::new(Mutex::new(None));
        let steps: Vec<(&str, Vec<String>)> = vec![
            ("git checkout -b docs/test", vec!["checkout".into(), "-b".into(), "docs/test".into()]),
            ("git add -- docs/a.md", vec!["add".into(), "--".into(), "docs/a.md".into()]),
            ("git commit", vec!["commit".into(), "-m".into(), "Dokumentace: a.md".into()]),
            ("git push -u origin docs/test", push_args(None, false, "docs/test")),
        ];
        for (label, args) in steps {
            let mut command = base_command("git");
            command.current_dir(&work).args(&args);
            assert!(
                run_step(command, label, &channel, &slot),
                "{label} selhal: {:?}",
                seen.lock().unwrap()
            );
        }

        // Na remote je větev s jedním novým commitem...
        assert_eq!(git(&origin, &["log", "--format=%s", "-1", "docs/test"]), "Dokumentace: a.md");
        // ...a v něm jen vybraný soubor.
        let files = git(&origin, &["show", "--name-only", "--format=", "docs/test"]);
        assert_eq!(files.trim(), "docs/a.md");
        assert!(git(&work, &["status", "--porcelain"]).contains("README.md"), "README zůstalo rozdělané");
        // main na remote se nehnul.
        assert_eq!(git(&origin, &["log", "--format=%s", "-1", "main"]), "init");

        // Frontend viděl každý krok jako `$ …` a žádný neúspěch.
        let transcript = seen.lock().unwrap().join("\n");
        for label in [
            "$ git checkout -b docs/test",
            "$ git add -- docs/a.md",
            "$ git commit",
            "$ git push -u origin docs/test",
        ] {
            assert!(transcript.contains(label), "chybí {label}: {transcript}");
        }
        assert!(!transcript.contains("\"failed\""), "{transcript}");
    }

    #[test]
    fn a_failing_step_reports_and_stops() {
        let (_dir, _origin, work) = repo_with_remote();
        let (channel, seen) = collecting_channel();
        let slot: Arc<Mutex<Option<Child>>> = Arc::new(Mutex::new(None));

        // `main` už existuje, takže `checkout -b main` musí spadnout.
        let mut command = base_command("git");
        command.current_dir(&work).args(["checkout", "-b", "main"]);
        assert!(!run_step(command, "git checkout -b main", &channel, &slot));

        let transcript = seen.lock().unwrap().join("\n");
        assert!(transcript.contains("\"kind\":\"failed\""), "{transcript}");
        assert!(transcript.contains("skončil s kódem"), "{transcript}");
        // A po sobě uklidil.
        assert!(slot.lock().unwrap().is_none());
    }

    #[test]
    fn push_borrows_credentials_from_gh_only_for_github() {
        assert_eq!(push_args(Some("gh"), false, "x"), vec!["push", "-u", "origin", "x"]);
        assert_eq!(push_args(None, true, "x"), vec!["push", "-u", "origin", "x"]);

        let github = push_args(Some(r"C:\Program Files\GitHub CLI\gh.exe"), true, "x");
        assert_eq!(github[0], "-c");
        assert_eq!(github[1], "credential.helper=");
        assert_eq!(github[2], "-c");
        assert_eq!(
            github[3],
            "credential.helper=!'C:/Program Files/GitHub CLI/gh.exe' auth git-credential"
        );
        assert_eq!(&github[4..], ["push", "-u", "origin", "x"]);
    }
}
