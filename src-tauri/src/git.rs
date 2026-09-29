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
use pilcrow_core::explorer::{self, ScanLimits};
use pilcrow_core::git::{
    failure_reason, gh_candidates, git_candidates, install_commands, is_https_url, is_safe_branch,
    is_safe_folder_name, is_safe_repo_path, is_safe_repo_slug, truncate_text, GhProbe, GitChunk,
    GitProbe, PublishMode, PublishRequest,
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
        // Cesty souborů jsou jména, ne vzory. Bez tohohle by `notes[1].md`
        // v `git add` nebo `git restore` zasáhlo i `notes1.md` -- a hranaté
        // závorky jsou ve jménech souborů na Windows úplně běžné.
        .env("GIT_LITERAL_PATHSPECS", "1")
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

/// Výstup gitu tak, jak je, i s nulami a koncovými mezerami -- nebo chyba
/// s tím, co git řekl. Pro výpisy, které čte parser, ne člověk.
fn git_raw(git: &str, dir: &Path, args: &[&str]) -> Result<String> {
    let output = run_in(git, Some(dir), args).map_err(|error| {
        CoreError::Io(format!("`git {}` se nepodařilo spustit: {error}", args.first().unwrap_or(&"")))
    })?;
    if !output.status.success() {
        let details = stderr_of(&output);
        return Err(CoreError::Io(if details.is_empty() {
            format!("`git {}` selhal.", args.first().unwrap_or(&""))
        } else {
            details
        }));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

/// Existuje ta reference? `rev-parse --verify` bez výstupu, jen návratový kód.
fn ref_exists(git: &str, dir: &Path, reference: &str) -> bool {
    run_in(git, Some(dir), &["rev-parse", "--verify", "--quiet", reference])
        .map(|output| output.status.success())
        .unwrap_or(false)
}

/// Výchozí větev podle `origin/HEAD`, bez `origin/`. Prázdná, když ji klon nezná.
///
/// `origin/HEAD` může chybět (repo založené bez klonu) nebo ukazovat na větev,
/// která už není (přejmenování `master` na `main`). Pak se zkusí `main`
/// a `master` -- bez výchozí větve by se ztratilo varování před zápisem do ní.
fn default_branch(git: &str, root: &Path) -> String {
    let named = git_value(git, root, &["symbolic-ref", "--short", "refs/remotes/origin/HEAD"])
        .strip_prefix("origin/")
        .unwrap_or_default()
        .to_string();
    if !named.is_empty() && ref_exists(git, root, &format!("refs/remotes/origin/{named}")) {
        return named;
    }
    ["main", "master"]
        .into_iter()
        .find(|name| ref_exists(git, root, &format!("refs/remotes/origin/{name}")))
        .map(String::from)
        .unwrap_or(named)
}

/// Dvě čísla z `rev-list --left-right --count A...B`: co má jen A, co má jen B.
fn left_right(git: &str, root: &Path, range: &str) -> (i64, i64) {
    let counts = git_value(git, root, &["rev-list", "--left-right", "--count", range]);
    let mut numbers = counts.split_whitespace();
    let left = numbers.next().and_then(|v| v.parse().ok()).unwrap_or(0);
    let right = numbers.next().and_then(|v| v.parse().ok()).unwrap_or(0);
    (left, right)
}

/// Kolik commitů má sledovaná větev navíc proti té, na které se stojí.
fn behind_upstream(git: &str, root: &Path) -> i64 {
    if git_value(git, root, &["rev-parse", "--abbrev-ref", "@{upstream}"]).is_empty() {
        return 0;
    }
    left_right(git, root, "HEAD...@{upstream}").1
}

/// `gh` a jestli jde o GitHub -- to, co potřebuje každý příkaz, který sahá na síť.
fn remote_credentials(state: &GitState, git: &str, root: &Path) -> (Option<String>, bool) {
    let gh = locate_gh(state).map(|(path, _)| path);
    let github = git_value(git, root, &["remote", "get-url", "origin"]).contains("github.com");
    (gh, github)
}

/// `git fetch --prune origin` s půjčeným přihlášením. Vrací chybu jako text:
/// bez sítě se pořád dá pracovat s tím, co se stáhlo minule, a volající
/// o tom má jen říct.
///
/// `--prune` proto, aby větev smazaná na GitHubu zmizela i z výpisu větví --
/// jinak by se nabízela ke stažení věc, která už neexistuje.
fn fetch_origin(git: &str, root: &Path, gh: Option<&str>, github: bool) -> String {
    let mut args = credential_args(gh, github);
    args.extend(["fetch", "--quiet", "--prune", "origin"].map(String::from));
    let fetch: Vec<&str> = args.iter().map(String::as_str).collect();
    match run_in(git, Some(root), &fetch) {
        Ok(output) if output.status.success() => String::new(),
        Ok(output) => stderr_of(&output),
        Err(error) => format!("`git fetch` se nepodařilo spustit: {error}"),
    }
}

/// Jak se přepnout na větev: na tu, co už doma je, nebo založit sledující
/// z `origin`. Vrací popisek kroku a argumenty.
///
/// `git switch` schválně, ne `checkout`: s rozdělanou prací, která by se
/// s cílovou větví prala, odmítne a nic nezahodí. Změny, které se nepřou,
/// si uživatel vezme s sebou -- to je obyčejné chování gitu.
fn switch_step(git: &str, root: &Path, branch: &str) -> Result<(String, Vec<String>)> {
    // `origin/HEAD` je ukazatel, ne větev; `switch -c HEAD` by nadělalo zmatek.
    if branch == "HEAD" {
        return Err(CoreError::InvalidName("HEAD není větev.".into()));
    }
    if ref_exists(git, root, &format!("refs/heads/{branch}")) {
        return Ok((format!("git switch {branch}"), vec!["switch".into(), branch.into()]));
    }
    if ref_exists(git, root, &format!("refs/remotes/origin/{branch}")) {
        return Ok((
            format!("git switch -c {branch} --track origin/{branch}"),
            vec![
                "switch".into(),
                "-c".into(),
                branch.into(),
                "--track".into(),
                format!("origin/{branch}"),
            ],
        ));
    }
    Err(CoreError::NotFound(format!(
        "Větev {branch} není ani tady, ani na GitHubu."
    )))
}

/// Dvě cesty míří na tutéž složku? Porovnává se po `canonicalize`, protože
/// git hlásí kořen po svém -- s lomítky, jinou velikostí písmen i jinou
/// jednotkou.
fn same_dir(a: &Path, b: &Path) -> bool {
    match (a.canonicalize(), b.canonicalize()) {
        (Ok(left), Ok(right)) => left == right,
        _ => a == b,
    }
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
        // `origin/HEAD` ukazuje na výchozí větev; `git remote set-head` ji
        // umí doplnit, ale klon ji nastavuje sám, takže tu skoro vždycky je.
        probe.default_branch = default_branch(&git, &root);
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
    // Jedna operace nad repozitářem naráz. Dřív se nový potomek do slotu jen
    // zapsal přes starý -- ten běžel dál, a jeho `run_step` pak počkal na
    // *cizí* proces a ohlásil jeho návratový kód pod svým jménem. Odmítnout
    // je poctivější než tuhle záměnu.
    if slot.lock().map(|held| held.is_some()).unwrap_or(false) {
        let _ = channel.send(GitChunk::Failed {
            message: format!("{label}: nad tímhle repozitářem už něco běží."),
        });
        return false;
    }

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

    // Výstup se sbírá i stranou, ne jen posílá do panelu: bez něj zbyl
    // z neúspěchu holý návratový kód.
    let seen = Arc::new(Mutex::new(String::new()));

    let stderr_thread = stderr.map(|source| {
        let channel = channel.clone();
        let slot = Arc::clone(slot);
        let seen = Arc::clone(&seen);
        std::thread::spawn(move || pump(source, &channel, slot, Some(&seen)))
    });
    let stdout_ok = stdout
        .map(|source| pump(source, channel, Arc::clone(slot), Some(&seen)))
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
            // Git své vysvětlení píše na výstup; návratový kód sám o sobě
            // uživateli ani nám neřekne nic.
            let reason = seen
                .lock()
                .ok()
                .and_then(|text| failure_reason(&text))
                .unwrap_or_else(|| format!("skončil s kódem {}", status.code().unwrap_or(-1)));
            let _ = channel.send(GitChunk::Failed {
                message: format!("{label}: {reason}"),
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
/// Přihlášení k remote půjčené od `gh`, jen pro jeden příkaz.
///
/// Používá to push, fetch i pull -- všechny tři sahají na síť a všechny tři
/// by se jinak mohly zeptat oknem, které v desktopové aplikaci nikdo nečeká.
fn credential_args(gh: Option<&str>, github: bool) -> Vec<String> {
    let Some(gh) = gh.filter(|_| github) else {
        return Vec::new();
    };
    vec![
        "-c".into(),
        "credential.helper=".into(),
        "-c".into(),
        format!(
            "credential.helper=!'{}' auth git-credential",
            gh.replace('\\', "/")
        ),
    ]
}

/// Commit jen vybraných souborů, ne celého indexu.
///
/// V indexu může být i něco, co si uživatel nevybral -- třeba soubory, které
/// „Vrátit na verzi z main“ nastavilo podle GitHubu, nebo co přidal v
/// terminálu. `git commit -- <cesty>` vezme přesně ty cesty a zbytek nechá
/// ležet, kde je.
fn commit_args(message: &str, files: &[String]) -> Vec<String> {
    let mut args = vec!["commit".to_string(), "-m".into(), message.to_string(), "--".into()];
    args.extend(files.iter().cloned());
    args
}

fn push_args(gh: Option<&str>, github: bool, branch: &str) -> Vec<String> {
    let mut args = credential_args(gh, github);
    args.extend(["push", "-u", "origin", branch].map(String::from));
    args
}

/// Cesta souboru v repu musí ležet v otevřené složce. Smazaný soubor už na
/// disku není, tak se ověří nejbližší složka nad ním, která je -- u souboru,
/// který je jen na main, může chybět i celá jeho podsložka.
fn require_inside(app: &AppState, root: &Path, file: &str) -> Result<()> {
    if !is_safe_repo_path(file) {
        return Err(CoreError::InvalidName(format!(
            "{file} není platná cesta v repozitáři."
        )));
    }
    let mut check = root.join(file);
    while !check.exists() {
        match check.parent() {
            Some(parent) => check = parent.to_path_buf(),
            None => break,
        }
    }
    app.with_access(|access| access.require(&check))
}

/// Odeslat vybrané soubory: větev, add, commit, push.
///
/// Kroky za sebou na vlastním vlákně; první neúspěch zastaví zbytek a repo
/// zůstane v poctivém stavu -- třeba na nové větvi s commitem, ale bez
/// pushe, což jde napravit `git_push`.
///
/// Větev je buď nová (`checkout -b`), nebo existující. U existující se na ni
/// nejdřív přepne, pokud se na ní nestojí, a dorovná se s GitHubem --
/// commit na zastaralém základu by GitHub při pushi odmítl. Že jde o
/// výchozí větev, tady nehraje roli: varovat a nechat potvrdit je práce
/// dialogu, tenhle příkaz dělá, co se mu řekne.
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

    // Přepnutí se zjistí hned, ne až ve vlákně: větev, která neexistuje,
    // je chyba volání, ne krok, který spadne v půlce.
    let switch = match request.mode {
        PublishMode::New => None,
        PublishMode::Existing => {
            let current = git_value(&git, &root, &["rev-parse", "--abbrev-ref", "HEAD"]);
            if current == request.branch {
                None
            } else {
                Some(switch_step(&git, &root, &request.branch)?)
            }
        }
    };

    let (gh, github) = remote_credentials(&state, &git, &root);
    let slot = Arc::clone(&state.running);

    std::thread::spawn(move || {
        let run = |label: &str, args: &[String]| -> bool {
            let mut command = base_command(&git);
            command.current_dir(&root).args(args);
            run_step(command, label, &channel, &slot)
        };

        match request.mode {
            PublishMode::New => {
                let args = vec!["checkout".into(), "-b".into(), request.branch.clone()];
                if !run(&format!("git checkout -b {}", request.branch), &args) {
                    return;
                }
            }
            PublishMode::Existing => {
                if let Some((label, args)) = &switch {
                    if !run(label, args) {
                        return;
                    }
                }
                // Až po přepnutí: teprve teď je jasné, proti čemu se počítá.
                if behind_upstream(&git, &root) > 0 {
                    let args = ["merge", "--ff-only", "@{upstream}"].map(String::from);
                    if !run(&format!("git merge --ff-only origin/{}", request.branch), &args) {
                        return;
                    }
                }
            }
        }

        let mut add: Vec<String> = vec!["add".into(), "--".into()];
        add.extend(request.files.iter().cloned());
        let steps: Vec<(String, Vec<String>)> = vec![
            (format!("git add -- {}", request.files.join(" ")), add),
            ("git commit".into(), commit_args(&request.message, &request.files)),
            (
                format!("git push -u origin {}", request.branch),
                push_args(gh.as_deref(), github, &request.branch),
            ),
        ];
        for (label, args) in &steps {
            if !run(label, args) {
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

/// Jak je na tom otevřená složka proti remote.
///
/// Napřed `git fetch`, jinak by se počítalo proti tomu, co remote dělal
/// naposledy, když si o něj někdo řekl -- a to může být týden staré. Fetch
/// zapisuje jen sledovací větve; pracovního stromu se nedotkne, takže se
/// nemůže poprat s rozdělanou prací.
#[tauri::command]
pub async fn git_sync(
    app: State<'_, AppState>,
    state: State<'_, GitState>,
    folder: String,
) -> Result<String> {
    let folder = granted_folder(&app, &folder)?;
    let git = require_git(&state)?;
    let root = require_root(&git, &folder)?;

    let (gh, github) = remote_credentials(&state, &git, &root);
    let fetch_error = fetch_origin(&git, &root, gh.as_deref(), github);

    let branch = git_value(&git, &root, &["rev-parse", "--abbrev-ref", "HEAD"]);
    let upstream = git_value(&git, &root, &["rev-parse", "--abbrev-ref", "@{upstream}"]);
    // `--left-right --count` vrací "napřed<TAB>pozadu" proti sledované větvi.
    let (ahead, behind) = if upstream.is_empty() {
        (0, 0)
    } else {
        left_right(&git, &root, "HEAD...@{upstream}")
    };

    let dirty = run_in(&git, Some(&root), &["status", "--porcelain"])
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).lines().count() as i64)
        .unwrap_or(0);

    serde_json::to_string(&serde_json::json!({
        "branch": branch,
        "upstream": upstream,
        "ahead": ahead,
        "behind": behind,
        "dirty": dirty,
        "error": fetch_error,
    }))
    .map_err(|error| CoreError::Io(format!("Stav se nepodařilo sestavit: {error}")))
}

/// Stáhnout, co na remote přibylo.
///
/// `--ff-only` schválně: když se větve rozešly, tohle skončí chybou místo
/// toho, aby uživateli uprostřed dokumentace vyrobilo slučovací commit nebo
/// konflikt, o který si neřekl.
#[tauri::command]
pub async fn git_pull(
    app: State<'_, AppState>,
    state: State<'_, GitState>,
    folder: String,
    channel: Channel<GitChunk>,
) -> Result<()> {
    let folder = granted_folder(&app, &folder)?;
    let git = require_git(&state)?;
    let root = require_root(&git, &folder)?;

    let gh = locate_gh(&state).map(|(path, _)| path);
    let github = git_value(&git, &root, &["remote", "get-url", "origin"]).contains("github.com");
    let mut args = credential_args(gh.as_deref(), github);
    args.extend(["pull", "--ff-only"].map(String::from));

    let slot = Arc::clone(&state.running);
    std::thread::spawn(move || {
        let mut command = base_command(&git);
        command.current_dir(&root).args(&args);
        if run_step(command, "git pull --ff-only", &channel, &slot) {
            let _ = channel.send(GitChunk::Finished);
        }
    });
    Ok(())
}

/// Otevřený pull request pro danou větev.
///
/// Hledá se podle větve, ne podle čísla: PR mohl vzniknout i jinde a po
/// restartu aplikace by o něm jinak nevěděla.
#[tauri::command]
pub async fn gh_pr_for_branch(
    app: State<'_, AppState>,
    state: State<'_, GitState>,
    folder: String,
    branch: String,
) -> Result<String> {
    let folder = granted_folder(&app, &folder)?;
    let git = require_git(&state)?;
    let root = require_root(&git, &folder)?;
    if !is_safe_branch(&branch) {
        return Err(CoreError::InvalidName(
            "Tohle se větev jmenovat nemůže.".into(),
        ));
    }

    let gh = require_gh(&state)?;
    let output = run_in(
        &gh,
        Some(&root),
        &[
            "pr", "list", "--head", &branch, "--state", "open", "--limit", "1", "--json",
            "number,title,url,state,isDraft,mergeable,mergeStateStatus,baseRefName,headRefName",
        ],
    )
    .map_err(|error| CoreError::Io(format!("`gh pr list` se nepodařilo spustit: {error}")))?;

    if !output.status.success() {
        let details = stderr_of(&output);
        return Err(CoreError::Io(if details.is_empty() {
            "Pull requesty se nepodařilo načíst.".into()
        } else {
            details
        }));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

/// Které způsoby sloučení repozitář povoluje.
#[tauri::command]
pub async fn gh_merge_methods(
    app: State<'_, AppState>,
    state: State<'_, GitState>,
    folder: String,
) -> Result<String> {
    let folder = granted_folder(&app, &folder)?;
    let git = require_git(&state)?;
    let root = require_root(&git, &folder)?;
    gh_get(&state, &root, "repos/{owner}/{repo}")
}

/// Sloučit pull request a uklidit po něm.
///
/// Čtyři kroky, každý vidět v panelu: sloučit, přepnout na cílovou větev,
/// stáhnout ji a smazat tu sloučenou. Poslední dva jsou úklid -- bez nich by
/// uživatel zůstal stát na větvi, která už je zmergovaná, a další odeslání
/// by z ní odbočilo.
///
/// Sloučení je nevratné a děje se na GitHubu, takže se sem smí dostat jen
/// přes tlačítko a potvrzení; tenhle příkaz se sám o nic neptá.
#[tauri::command]
pub async fn gh_pr_merge(
    app: State<'_, AppState>,
    state: State<'_, GitState>,
    folder: String,
    number: u64,
    method: String,
    base: String,
    head: String,
    delete_branch: bool,
    channel: Channel<GitChunk>,
) -> Result<()> {
    let folder = granted_folder(&app, &folder)?;
    let git = require_git(&state)?;
    let root = require_root(&git, &folder)?;

    let flag = match method.as_str() {
        "merge" => "--merge",
        "squash" => "--squash",
        "rebase" => "--rebase",
        other => {
            return Err(CoreError::InvalidName(format!(
                "{other} není způsob sloučení."
            )))
        }
    };
    if !is_safe_branch(&base) || !is_safe_branch(&head) {
        return Err(CoreError::InvalidName(
            "Tohle se větev jmenovat nemůže.".into(),
        ));
    }

    let gh = require_gh(&state)?;
    let slot = Arc::clone(&state.running);

    std::thread::spawn(move || {
        let number = number.to_string();

        let mut merge = base_command(&gh);
        merge.current_dir(&root).args(["pr", "merge", &number, flag]);
        if !run_step(merge, &format!("gh pr merge {number} {flag}"), &channel, &slot) {
            return;
        }

        // Úklid. Selhání tady už nemění to, že sloučení proběhlo, takže se
        // hlásí, ale nepovažuje za pád celé akce.
        let mut checkout = base_command(&git);
        checkout.current_dir(&root).args(["checkout", &base]);
        if run_step(checkout, &format!("git checkout {base}"), &channel, &slot) {
            let mut pull = base_command(&git);
            pull.current_dir(&root).args(["pull", "--ff-only"]);
            let _ = run_step(pull, "git pull --ff-only", &channel, &slot);

            if delete_branch {
                let mut local = base_command(&git);
                local.current_dir(&root).args(["branch", "-d", &head]);
                let _ = run_step(local, &format!("git branch -d {head}"), &channel, &slot);

                let mut remote = base_command(&git);
                remote
                    .current_dir(&root)
                    .args(["push", "origin", "--delete", &head]);
                let _ = run_step(
                    remote,
                    &format!("git push origin --delete {head}"),
                    &channel,
                    &slot,
                );
            }
        }
        let _ = channel.send(GitChunk::Finished);
    });
    Ok(())
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
///
/// `extra` jsou jednotlivé repozitáře, které leží jinde: stažené do složky,
/// kterou uživatel vybral jen pro ně, nebo napojené jako „soubory mám
/// jinde“. Ty se neprocházejí, jen se ověří, že tam repozitář pořád je --
/// a povolí se stejně jako složka nahoře, ze stejného důvodu.
#[tauri::command]
pub async fn scan_clones(
    app: State<'_, AppState>,
    state: State<'_, GitState>,
    folder: String,
    extra: Option<Vec<String>>,
) -> Result<String> {
    let root = PathBuf::from(&folder);
    let extra: Vec<PathBuf> = extra
        .unwrap_or_default()
        .into_iter()
        .map(PathBuf::from)
        .filter(|path| path.join(".git").exists())
        .collect();
    if !root.is_dir() && extra.is_empty() {
        return Ok("[]".into());
    }
    let git = require_git(&state)?;

    let mut candidates = Vec::new();
    if root.is_dir() {
        app.with_access(|access| {
            access.grant_dir(&root);
            Ok(())
        })?;
        if let Ok(entries) = std::fs::read_dir(&root) {
            candidates.extend(entries.filter_map(std::result::Result::ok).map(|entry| entry.path()));
        }
    }
    for path in extra {
        app.with_access(|access| {
            access.grant_dir(&path);
            Ok(())
        })?;
        candidates.push(path);
    }

    let mut found = Vec::new();
    let mut seen: Vec<PathBuf> = Vec::new();
    for path in candidates {
        if !path.join(".git").exists() || seen.iter().any(|known| same_dir(known, &path)) {
            continue;
        }
        found.push(serde_json::json!({
            "path": path.to_string_lossy(),
            "remote": git_value(&git, &path, &["remote", "get-url", "origin"]),
        }));
        seen.push(path);
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

// -- větve ------------------------------------------------------------------

/// Jeden řádek `for-each-ref`. Pole oddělená nulou, předmět commitu poslední:
/// je to jediné pole, ve kterém může být cokoli -- kromě konce řádku, a ten
/// odděluje záznamy.
const REF_FORMAT: &str = "--format=%(refname)%00%(objectname:short)%00%(committerdate:iso-strict)%00%(authorname)%00%(upstream:short)%00%(upstream:track,nobracket)%00%(subject)";

/// Kolik bajtů rozdílu jednoho souboru se pošle do okna.
const DIFF_LIMIT: usize = 256 * 1024;

/// Větve tady i na GitHubu.
///
/// Napřed `git fetch --prune`, jinak by se ukazovalo, co bylo na GitHubu
/// naposledy, když se někdo ptal -- a z toho se pak vybírá, co stáhnout.
/// Fetch sahá jen na sledovací větve, pracovní strom nechá být. Když se
/// nepovede, vypíše se to, co je známé, a chyba jde vedle.
///
/// Surové řádky čte `parseBranches` v `src/core/branches.ts`.
#[tauri::command]
pub async fn git_branches(
    app: State<'_, AppState>,
    state: State<'_, GitState>,
    folder: String,
) -> Result<String> {
    let folder = granted_folder(&app, &folder)?;
    let git = require_git(&state)?;
    let root = require_root(&git, &folder)?;

    let (gh, github) = remote_credentials(&state, &git, &root);
    let fetch_error = fetch_origin(&git, &root, gh.as_deref(), github);
    branch_list(&git, &root, &fetch_error)
}

fn branch_list(git: &str, root: &Path, fetch_error: &str) -> Result<String> {
    let refs = git_raw(git, root, &["for-each-ref", REF_FORMAT, "refs/heads", "refs/remotes/origin"])?;
    serde_json::to_string(&serde_json::json!({
        "current": git_value(git, root, &["rev-parse", "--abbrev-ref", "HEAD"]),
        "default": default_branch(git, root),
        "fetchError": fetch_error,
        "refs": refs,
    }))
    .map_err(|error| CoreError::Io(format!("Seznam větví se nepodařilo sestavit: {error}")))
}

/// Co větev přinesla proti základu: commity a soubory v otevřené složce.
///
/// Soubory jsou `základ...větev` -- tři tečky, tedy od místa, kde se větev
/// odpojila. Dvě tečky by do seznamu přimíchaly i to, co mezitím přibylo
/// v základu, a vypadalo by to, že to větev maže.
#[tauri::command]
pub async fn git_branch_log(
    app: State<'_, AppState>,
    state: State<'_, GitState>,
    folder: String,
    base: String,
    target: String,
) -> Result<String> {
    let folder = granted_folder(&app, &folder)?;
    let git = require_git(&state)?;
    let root = require_root(&git, &folder)?;
    if !is_safe_branch(&base) || !is_safe_branch(&target) {
        return Err(CoreError::InvalidName("Tohle se větev jmenovat nemůže.".into()));
    }
    branch_report(&git, &root, &folder.to_string_lossy(), &base, &target)
}

fn branch_report(git: &str, root: &Path, pathspec: &str, base: &str, target: &str) -> Result<String> {
    let range = format!("{base}...{target}");
    let (behind, ahead) = left_right(git, root, &range);
    let log = git_raw(
        git,
        root,
        &["log", "--format=%h%x00%an%x00%cI%x00%s", "-n", "50", &format!("{base}..{target}")],
    )?;
    let name_status = git_raw(
        git,
        root,
        &["diff", "--no-renames", "--name-status", "-z", &range, "--", pathspec],
    )?;
    let numstat = git_raw(git, root, &["diff", "--no-renames", "--numstat", "-z", &range, "--", pathspec])?;

    serde_json::to_string(&serde_json::json!({
        "ahead": ahead,
        "behind": behind,
        "log": log,
        "nameStatus": name_status,
        "numstat": numstat,
    }))
    .map_err(|error| CoreError::Io(format!("Přehled větve se nepodařilo sestavit: {error}")))
}

/// Rozdíl jednoho souboru, jak ho vypíše `git diff`.
///
/// Bez `to` je to pracovní strom proti `from` -- „co mám jinak než main“.
/// S `to` je to `from...to`, tedy co změnila větev. Jen čtení.
#[tauri::command]
pub async fn git_diff(
    app: State<'_, AppState>,
    state: State<'_, GitState>,
    folder: String,
    from: String,
    to: String,
    path: String,
) -> Result<String> {
    let folder = granted_folder(&app, &folder)?;
    let git = require_git(&state)?;
    let root = require_root(&git, &folder)?;
    if !is_safe_branch(&from) || (!to.is_empty() && !is_safe_branch(&to)) {
        return Err(CoreError::InvalidName("Tohle se větev jmenovat nemůže.".into()));
    }
    require_inside(&app, &root, &path)?;

    let range = if to.is_empty() { from } else { format!("{from}...{to}") };
    let text = git_raw(&git, &root, &["diff", "--no-renames", "--no-color", &range, "--", &path])?;
    let (text, truncated) = truncate_text(&text, DIFF_LIMIT);
    Ok(if truncated {
        format!("{text}\n… (rozdíl je delší, zbytek se nezobrazuje)\n")
    } else {
        text
    })
}

/// Přepnout na větev -- stáhnout ji, když je jen na GitHubu -- a dorovnat ji.
///
/// Dorovná se jen převinutím. Když se větev rozešla s GitHubem, přepnutí
/// platí a dorovnání skončí chybou; nic se neslučuje samo.
#[tauri::command]
pub async fn git_switch(
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
        return Err(CoreError::InvalidName("Tohle se větev jmenovat nemůže.".into()));
    }
    let (label, args) = switch_step(&git, &root, &branch)?;
    let slot = Arc::clone(&state.running);

    std::thread::spawn(move || {
        let mut command = base_command(&git);
        command.current_dir(&root).args(&args);
        if !run_step(command, &label, &channel, &slot) {
            return;
        }
        if behind_upstream(&git, &root) > 0 {
            let mut merge = base_command(&git);
            merge.current_dir(&root).args(["merge", "--ff-only", "@{upstream}"]);
            if !run_step(merge, &format!("git merge --ff-only origin/{branch}"), &channel, &slot) {
                return;
            }
        }
        let _ = channel.send(GitChunk::Finished);
    });
    Ok(())
}

// -- porovnání s výchozí větví ----------------------------------------------

/// Čím se otevřená složka liší od větve na GitHubu, typicky `origin/main`.
///
/// Pracovní strom proti commitu, ne commit proti commitu: rozdělaná práce je
/// přesně to, na co se uživatel ptá. Soubory, které git nesleduje, `diff`
/// nevidí, takže jdou zvlášť z `ls-files --others`.
///
/// Napřed fetch -- „kontrola na main“ má znamenat main na GitHubu dnes.
#[tauri::command]
pub async fn git_compare(
    app: State<'_, AppState>,
    state: State<'_, GitState>,
    folder: String,
    base: String,
) -> Result<String> {
    let folder = granted_folder(&app, &folder)?;
    let git = require_git(&state)?;
    let root = require_root(&git, &folder)?;
    if !is_safe_branch(&base) {
        return Err(CoreError::InvalidName("Tohle se větev jmenovat nemůže.".into()));
    }

    let (gh, github) = remote_credentials(&state, &git, &root);
    let fetch_error = fetch_origin(&git, &root, gh.as_deref(), github);
    compare_report(&git, &root, &folder.to_string_lossy(), &base, &fetch_error)
}

fn compare_report(git: &str, root: &Path, pathspec: &str, base: &str, fetch_error: &str) -> Result<String> {
    if !ref_exists(git, root, &format!("{base}^{{commit}}")) {
        return Err(CoreError::NotFound(
            format!("Větev {base} není k dispozici. {fetch_error}").trim().to_string(),
        ));
    }
    let (ahead, behind) = left_right(git, root, &format!("HEAD...{base}"));
    let name_status = git_raw(git, root, &["diff", "--no-renames", "--name-status", "-z", base, "--", pathspec])?;
    let numstat = git_raw(git, root, &["diff", "--no-renames", "--numstat", "-z", base, "--", pathspec])?;
    let untracked = git_raw(git, root, &["ls-files", "--others", "--exclude-standard", "-z", "--", pathspec])?;

    serde_json::to_string(&serde_json::json!({
        "base": base,
        "branch": git_value(git, root, &["rev-parse", "--abbrev-ref", "HEAD"]),
        "ahead": ahead,
        "behind": behind,
        "nameStatus": name_status,
        "numstat": numstat,
        "untracked": untracked,
        "fetchError": fetch_error,
    }))
    .map_err(|error| CoreError::Io(format!("Porovnání se nepodařilo sestavit: {error}")))
}

/// Vrátit soubory na podobu z `source`, typicky `origin/main`.
///
/// Přepisuje rozdělanou práci, takže se sem jde jen po potvrzení v okně,
/// kde je vypsané, které soubory to jsou. Soubory, které v `source` nejsou,
/// git odmítne -- ty tahle akce nikdy nemaže.
#[tauri::command]
pub async fn git_restore(
    app: State<'_, AppState>,
    state: State<'_, GitState>,
    folder: String,
    source: String,
    files: Vec<String>,
) -> Result<()> {
    let folder = granted_folder(&app, &folder)?;
    let git = require_git(&state)?;
    let root = require_root(&git, &folder)?;
    if !is_safe_branch(&source) {
        return Err(CoreError::InvalidName("Tohle se větev jmenovat nemůže.".into()));
    }
    if files.is_empty() {
        return Err(CoreError::InvalidName("Není co vrátit: žádný soubor není vybraný.".into()));
    }
    for file in &files {
        require_inside(&app, &root, file)?;
    }

    let args = restore_args(&source, &files);
    let args: Vec<&str> = args.iter().map(String::as_str).collect();
    git_raw(&git, &root, &args).map(|_| ())
}

// -- napojení složky --------------------------------------------------------

/// Co je vybraná složka zač, než se na ni napojí repozitář.
///
/// Rozhodnutí -- jestli je to tentýž repozitář, cizí, nebo obyčejná složka --
/// dělá `inspectionKind` ve frontendu podle remote. Tady se jen zjišťuje.
#[tauri::command]
pub async fn git_inspect_folder(
    app: State<'_, AppState>,
    state: State<'_, GitState>,
    folder: String,
) -> Result<String> {
    let folder = granted_folder(&app, &folder)?;
    let git = require_git(&state)?;

    let (root, remote, is_root) = match repo_root(&git, &folder) {
        Some(root) => {
            let remote = git_value(&git, &root, &["remote", "get-url", "origin"]);
            let is_root = same_dir(&root, &folder);
            (root.to_string_lossy().to_string(), remote, is_root)
        }
        None => (String::new(), String::new(), false),
    };
    let markdown = explorer::scan_folder(&folder, ScanLimits::default())
        .map(|tree| tree.file_count)
        .unwrap_or(0);

    serde_json::to_string(&serde_json::json!({
        "root": root,
        "remote": remote,
        "isRoot": is_root,
        "markdownFiles": markdown,
    }))
    .map_err(|error| CoreError::Io(format!("Složku se nepodařilo prozkoumat: {error}")))
}

/// Kroky napojení: popisek, argumenty, a jestli se po jeho neúspěchu má
/// smazat `.git` -- do fetche včetně ano, potom už je repozitář skoro hotový
/// a mazat ho by bylo horší než ho nechat.
fn link_steps(branch: &str, remote_url: &str, fetch: Vec<String>) -> Vec<(String, Vec<String>, bool)> {
    vec![
        ("git init".into(), vec!["init".into()], true),
        (
            format!("git symbolic-ref HEAD refs/heads/{branch}"),
            vec!["symbolic-ref".into(), "HEAD".into(), format!("refs/heads/{branch}")],
            true,
        ),
        (
            format!("git remote add origin {remote_url}"),
            vec!["remote".into(), "add".into(), "origin".into(), remote_url.into()],
            true,
        ),
        ("git fetch origin".into(), fetch, true),
        (
            format!("git update-ref refs/heads/{branch} origin/{branch}"),
            vec!["update-ref".into(), format!("refs/heads/{branch}"), format!("refs/remotes/origin/{branch}")],
            true,
        ),
        // Index podle větve, pracovní strom beze změny. Tady se ze souborů ve
        // složce stanou „změny proti main“.
        ("git reset".into(), vec!["reset".into(), "-q".into()], false),
        (
            format!("git branch --set-upstream-to=origin/{branch}"),
            vec!["branch".into(), format!("--set-upstream-to=origin/{branch}")],
            false,
        ),
        (
            format!("git remote set-head origin {branch}"),
            vec!["remote".into(), "set-head".into(), "origin".into(), branch.into()],
            false,
        ),
    ]
}

/// Udělat z obyčejné složky pracovní kopii repozitáře, bez sáhnutí na soubory.
///
/// `init`, `origin`, `fetch`, a pak větev postavená na `origin/<výchozí>`
/// s indexem podle ní -- pracovní strom zůstane, jak byl. Git potom vidí
/// přesně to, čím se soubory ve složce liší od main: změněné, chybějící
/// a nové. Nic se nepřepíše a nic se nikam neodešle.
///
/// Když to spadne dřív, než je hotový fetch, `.git`, které tohle volání
/// založilo, se zase smaže -- složka zůstane, jak ji uživatel vybral.
#[tauri::command]
pub async fn git_link_folder(
    app: State<'_, AppState>,
    state: State<'_, GitState>,
    folder: String,
    remote_url: String,
    default_branch: String,
    channel: Channel<GitChunk>,
) -> Result<()> {
    let folder = granted_folder(&app, &folder)?;
    let git = require_git(&state)?;
    if !is_https_url(&remote_url) {
        return Err(CoreError::InvalidName(format!("{remote_url} není adresa repozitáře.")));
    }
    if !is_safe_branch(&default_branch) {
        return Err(CoreError::InvalidName("Tohle se větev jmenovat nemůže.".into()));
    }
    if folder.join(".git").exists() || repo_root(&git, &folder).is_some() {
        return Err(CoreError::Duplicate(format!(
            "{} už v repozitáři gitu je.",
            folder.display()
        )));
    }

    let gh = locate_gh(&state).map(|(path, _)| path);
    let github = remote_url.contains("github.com");
    let slot = Arc::clone(&state.running);

    std::thread::spawn(move || {
        let mut fetch = credential_args(gh.as_deref(), github);
        fetch.extend(["fetch", "--progress", "origin"].map(String::from));

        let steps = link_steps(&default_branch, &remote_url, fetch);
        if run_link(&git, &folder, steps, &channel, &slot) {
            let _ = channel.send(GitChunk::Finished);
        }
    });
    Ok(())
}

/// Projít kroky napojení; při neúspěchu v první půlce po sobě uklidit.
fn run_link(
    git: &str,
    folder: &Path,
    steps: Vec<(String, Vec<String>, bool)>,
    channel: &Channel<GitChunk>,
    slot: &Arc<Mutex<Option<Child>>>,
) -> bool {
    for (label, args, undo) in steps {
        let mut command = base_command(git);
        command.current_dir(folder).args(&args);
        if !run_step(command, &label, channel, slot) {
            if undo {
                let _ = std::fs::remove_dir_all(folder.join(".git"));
            }
            return false;
        }
    }
    true
}

/// Argumenty pro `git restore` ze `source`, do indexu i pracovního stromu.
fn restore_args(source: &str, files: &[String]) -> Vec<String> {
    let mut args = vec![
        "restore".to_string(),
        format!("--source={source}"),
        "--staged".into(),
        "--worktree".into(),
        "--".into(),
    ];
    args.extend(files.iter().cloned());
    args
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
            ("git commit", commit_args("Dokumentace: a.md", &["docs/a.md".into()])),
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
        // Hláška nese, co řekl git -- ne holý návratový kód, ze kterého se
        // nepozná nic.
        assert!(
            transcript.contains("fatal:") || transcript.contains("error:"),
            "chybí gitova vlastní hláška: {transcript}"
        );
        assert!(!transcript.contains("skončil s kódem"), "{transcript}");
        // A po sobě uklidil.
        assert!(slot.lock().unwrap().is_none());
    }

    #[test]
    fn a_failing_step_says_what_git_said() {
        // Dřív tu zbyl holý návratový kód a diagnóza stála na hádání.
        let (_dir, _origin, work) = repo_with_remote();
        let (channel, seen) = collecting_channel();
        let slot: Arc<Mutex<Option<Child>>> = Arc::new(Mutex::new(None));

        let mut command = base_command("git");
        command.current_dir(&work).args(["checkout", "vetev-ktera-neexistuje"]);
        assert!(!run_step(command, "git checkout", &channel, &slot));

        let transcript = seen.lock().unwrap().join("
");
        assert!(transcript.contains("\"kind\":\"failed\""), "{transcript}");
        // Ne "skončil s kódem 1", ale to, co git opravdu řekl.
        assert!(
            transcript.contains("error:") || transcript.contains("fatal:"),
            "chybí gitova vlastní hláška: {transcript}"
        );
    }

    #[test]
    fn a_second_step_is_refused_while_one_runs() {
        // Dřív se nový potomek do slotu jen zapsal přes starý; jeden run_step
        // pak počkal na cizí proces a ohlásil jeho kód pod svým jménem.
        let (_dir, _origin, work) = repo_with_remote();
        let (channel, seen) = collecting_channel();
        let slot: Arc<Mutex<Option<Child>>> = Arc::new(Mutex::new(None));

        // Obsadit slot, jako by něco běželo.
        let mut busy = base_command("git");
        busy.current_dir(&work).args(["status"]);
        busy.stdout(Stdio::piped()).stderr(Stdio::piped());
        let running = busy.spawn().unwrap();
        *slot.lock().unwrap() = Some(running);

        let mut command = base_command("git");
        command.current_dir(&work).args(["status"]);
        assert!(!run_step(command, "git status", &channel, &slot));

        let transcript = seen.lock().unwrap().join("
");
        assert!(transcript.contains("u\u{17e} n\u{11b}co b\u{11b}\"") || transcript.contains("bě"), "{transcript}");

        // Uklidit po sobě: zámek se pustí dřív, než se na potomka čeká.
        let held = slot.lock().unwrap().take();
        if let Some(mut child) = held {
            child.kill_now();
            let _ = child.wait_now();
        }
    }

    /// Druhý klon téhož remote -- „někdo jiný“, kdo mezitím pushuje.
    fn second_clone(dir: &Path, origin: &Path) -> PathBuf {
        let other = dir.join("other");
        git(dir, &["clone", "-q", origin.to_str().unwrap(), other.to_str().unwrap()]);
        git(&other, &["config", "user.name", "Jiný"]);
        git(&other, &["config", "user.email", "jiny@example.com"]);
        other
    }

    /// Obsah souboru bez ohledu na konce řádků -- git na Windows při
    /// checkoutu dělá z `\n` `\r\n` a o to v testu nejde.
    fn text(path: &Path) -> String {
        fs::read_to_string(path).unwrap().replace("\r\n", "\n")
    }

    fn run_all(dir: &Path, steps: Vec<(String, Vec<String>)>) -> String {
        let (channel, seen) = collecting_channel();
        let slot: Arc<Mutex<Option<Child>>> = Arc::new(Mutex::new(None));
        for (label, args) in steps {
            let mut command = base_command("git");
            command.current_dir(dir).args(&args);
            assert!(run_step(command, &label, &channel, &slot), "{label}: {:?}", seen.lock().unwrap());
        }
        let transcript = seen.lock().unwrap().join("\n");
        transcript
    }

    #[test]
    fn linking_a_plain_folder_keeps_its_files_and_shows_the_difference_from_main() {
        let (dir, origin, _work) = repo_with_remote();
        // Soubory k repozitáři, které má uživatel jinde: jeden upravený, jeden
        // nový, a README, které tu vůbec není.
        let plain = dir.path().join("moje-docs");
        fs::create_dir_all(plain.join("docs")).unwrap();
        fs::write(plain.join("docs/a.md"), "# A\n\nmoje verze\n").unwrap();
        fs::write(plain.join("docs/nové.md"), "# N\n").unwrap();

        let (channel, seen) = collecting_channel();
        let slot: Arc<Mutex<Option<Child>>> = Arc::new(Mutex::new(None));
        let fetch = vec!["fetch".into(), "origin".into()];
        let steps = link_steps("main", origin.to_str().unwrap(), fetch);
        assert!(run_link("git", &plain, steps, &channel, &slot), "{:?}", seen.lock().unwrap());

        // Soubory zůstaly bajt po bajtu, jak byly.
        assert_eq!(fs::read_to_string(plain.join("docs/a.md")).unwrap(), "# A\n\nmoje verze\n");
        assert!(!plain.join("README.md").exists(), "nic se nedopsalo");

        // Git vidí přesně rozdíl proti main. (`git()` ořízne úvodní mezeru
        // prvního řádku, proto se hledá bez ní.)
        let status = git(&plain, &["status", "--porcelain=v1", "--untracked-files=all"]);
        assert!(status.contains(" M docs/a.md"), "{status}");
        assert!(status.contains("D README.md"), "{status}");
        assert!(status.contains("?? \"docs/nov") || status.contains("?? docs/nov"), "{status}");

        // A je to plnohodnotná kopie: větev, sledování i výchozí větev.
        assert_eq!(git(&plain, &["rev-parse", "--abbrev-ref", "HEAD"]), "main");
        assert_eq!(git(&plain, &["rev-parse", "--abbrev-ref", "@{upstream}"]), "origin/main");
        assert_eq!(default_branch("git", &plain), "main");

        let report: serde_json::Value = serde_json::from_str(
            &compare_report("git", &plain, plain.to_str().unwrap(), "origin/main", "").unwrap(),
        )
        .unwrap();
        assert_eq!(report["ahead"], 0);
        assert_eq!(report["behind"], 0);
        let names = report["nameStatus"].as_str().unwrap();
        assert!(names.contains("M\0docs/a.md\0"), "{names:?}");
        assert!(names.contains("D\0README.md\0"), "{names:?}");
        assert!(report["untracked"].as_str().unwrap().contains("docs/nové.md\0"));
        assert!(report["numstat"].as_str().unwrap().contains("docs/a.md"));
    }

    #[test]
    fn a_failed_link_leaves_the_folder_as_it_was() {
        let (dir, _origin, _work) = repo_with_remote();
        let plain = dir.path().join("docs-bez-remote");
        fs::create_dir_all(&plain).unwrap();
        fs::write(plain.join("a.md"), "# A\n").unwrap();

        let (channel, seen) = collecting_channel();
        let slot: Arc<Mutex<Option<Child>>> = Arc::new(Mutex::new(None));
        let missing = dir.path().join("neexistuje.git");
        let steps = link_steps("main", missing.to_str().unwrap(), vec!["fetch".into(), "origin".into()]);
        assert!(!run_link("git", &plain, steps, &channel, &slot));

        assert!(!plain.join(".git").exists(), "po neúspěchu zbylo .git");
        assert_eq!(fs::read_to_string(plain.join("a.md")).unwrap(), "# A\n");
        assert!(seen.lock().unwrap().join("\n").contains("\"kind\":\"failed\""));
    }

    #[test]
    fn a_branch_that_is_only_on_github_is_downloaded_and_tracked() {
        let (dir, origin, work) = repo_with_remote();
        let other = second_clone(dir.path(), &origin);
        git(&other, &["checkout", "-q", "-b", "feature/x"]);
        fs::write(other.join("docs/a.md"), "# A\n\nz větve\n").unwrap();
        git(&other, &["commit", "-qam", "Na větvi"]);
        git(&other, &["push", "-q", "-u", "origin", "feature/x"]);

        git(&work, &["fetch", "-q", "origin"]);
        let (label, args) = switch_step("git", &work, "feature/x").unwrap();
        assert_eq!(label, "git switch -c feature/x --track origin/feature/x");
        run_all(&work, vec![(label, args)]);

        assert_eq!(git(&work, &["rev-parse", "--abbrev-ref", "HEAD"]), "feature/x");
        assert_eq!(git(&work, &["rev-parse", "--abbrev-ref", "@{upstream}"]), "origin/feature/x");
        assert_eq!(text(&work.join("docs/a.md")), "# A\n\nz větve\n");

        // Podruhé už je doma, takže se jen přepne.
        git(&work, &["switch", "-q", "main"]);
        assert_eq!(switch_step("git", &work, "feature/x").unwrap().0, "git switch feature/x");
        assert!(switch_step("git", &work, "nikde-neni").is_err());
    }

    #[test]
    fn the_branch_list_names_local_and_remote_branches() {
        let (dir, origin, work) = repo_with_remote();
        git(&work, &["remote", "set-head", "origin", "main"]);
        let other = second_clone(dir.path(), &origin);
        git(&other, &["checkout", "-q", "-b", "docs/nova"]);
        fs::write(other.join("docs/b.md"), "# B\n").unwrap();
        git(&other, &["add", "."]);
        git(&other, &["commit", "-qm", "Přidat b"]);
        git(&other, &["push", "-q", "-u", "origin", "docs/nova"]);
        git(&work, &["fetch", "-q", "origin"]);

        let list: serde_json::Value = serde_json::from_str(&branch_list("git", &work, "").unwrap()).unwrap();
        assert_eq!(list["current"], "main");
        assert_eq!(list["default"], "main");
        let refs = list["refs"].as_str().unwrap();
        assert!(refs.contains("refs/heads/main\0"), "{refs:?}");
        assert!(refs.contains("refs/remotes/origin/docs/nova\0"), "{refs:?}");
        assert!(refs.contains("\0Přidat b\n") || refs.ends_with("\0Přidat b"), "{refs:?}");

        let report: serde_json::Value = serde_json::from_str(
            &branch_report("git", &work, work.to_str().unwrap(), "origin/main", "origin/docs/nova").unwrap(),
        )
        .unwrap();
        assert_eq!(report["ahead"], 1);
        assert_eq!(report["behind"], 0);
        assert!(report["log"].as_str().unwrap().contains("Přidat b"));
        assert!(report["nameStatus"].as_str().unwrap().contains("A\0docs/b.md\0"));
    }

    #[test]
    fn publishing_to_an_existing_branch_catches_up_before_the_commit() {
        let (dir, origin, work) = repo_with_remote();
        // Někdo mezitím přispěl do main.
        let other = second_clone(dir.path(), &origin);
        fs::write(other.join("README.md"), "# R\n\nod kolegy\n").unwrap();
        git(&other, &["commit", "-qam", "Kolega"]);
        git(&other, &["push", "-q", "origin", "main"]);

        fs::write(work.join("docs/a.md"), "# A\n\nmoje\n").unwrap();
        git(&work, &["fetch", "-q", "origin"]);
        assert_eq!(behind_upstream("git", &work), 1);

        run_all(
            &work,
            vec![
                ("git merge --ff-only origin/main".into(), ["merge", "--ff-only", "@{upstream}"].map(String::from).to_vec()),
                ("git add -- docs/a.md".into(), vec!["add".into(), "--".into(), "docs/a.md".into()]),
                ("git commit".into(), vec!["commit".into(), "-m".into(), "Rovnou do main".into()]),
                ("git push -u origin main".into(), push_args(None, false, "main")),
            ],
        );

        // Na main je kolegův commit a na něm ten náš -- nic se nepřepsalo.
        let log = git(&origin, &["log", "--format=%s", "main"]);
        assert_eq!(log.lines().collect::<Vec<_>>(), vec!["Rovnou do main", "Kolega", "init"]);
    }

    #[test]
    fn restore_puts_back_the_version_from_main() {
        let (_dir, _origin, work) = repo_with_remote();
        fs::write(work.join("docs/a.md"), "# A\n\nrozdělané\n").unwrap();
        fs::remove_file(work.join("README.md")).unwrap();

        let args = restore_args("origin/main", &["docs/a.md".into(), "README.md".into()]);
        let args: Vec<&str> = args.iter().map(String::as_str).collect();
        git_raw("git", &work, &args).unwrap();

        assert_eq!(text(&work.join("docs/a.md")), "# A\n");
        assert!(work.join("README.md").exists());
        assert_eq!(git(&work, &["status", "--porcelain"]), "");
    }

    #[test]
    fn file_names_with_brackets_are_names_not_patterns() {
        // `notes[1].md` jako vzor odpovídá i `notes1.md`. Vrátit nebo odeslat
        // se smí jen ten soubor, který se jmenuje přesně tak.
        let (_dir, _origin, work) = repo_with_remote();
        fs::write(work.join("notes[1].md"), "# Závorky\n").unwrap();
        fs::write(work.join("notes1.md"), "# Bez závorek\n").unwrap();
        git(&work, &["add", "."]);
        git(&work, &["commit", "-qm", "dva soubory"]);
        fs::write(work.join("notes[1].md"), "# Závorky\n\nzměna\n").unwrap();
        fs::write(work.join("notes1.md"), "# Bez závorek\n\nrozdělané\n").unwrap();

        let args = restore_args("HEAD", &["notes[1].md".into()]);
        let args: Vec<&str> = args.iter().map(String::as_str).collect();
        git_raw("git", &work, &args).unwrap();

        assert_eq!(text(&work.join("notes[1].md")), "# Závorky\n");
        assert_eq!(text(&work.join("notes1.md")), "# Bez závorek\n\nrozdělané\n", "cizí soubor zůstal");

        // A totéž u `git add`: do indexu jde jen jmenovaný soubor.
        fs::write(work.join("notes[1].md"), "# Závorky\n\nznovu\n").unwrap();
        run_all(&work, vec![("git add".into(), vec!["add".into(), "--".into(), "notes[1].md".into()])]);
        let staged = git(&work, &["diff", "--cached", "--name-only"]);
        assert_eq!(staged, "notes[1].md");
    }

    #[test]
    fn a_commit_takes_only_the_chosen_files_even_with_more_in_the_index() {
        let (_dir, _origin, work) = repo_with_remote();
        fs::write(work.join("docs/a.md"), "# A\n\nvybrané\n").unwrap();
        fs::write(work.join("README.md"), "# R\n\nv indexu, ale nevybrané\n").unwrap();
        git(&work, &["add", "README.md"]);

        run_all(
            &work,
            vec![
                ("git add".into(), vec!["add".into(), "--".into(), "docs/a.md".into()]),
                ("git commit".into(), commit_args("Jen a.md", &["docs/a.md".into()])),
            ],
        );

        let files = git(&work, &["show", "--name-only", "--format=", "HEAD"]);
        assert_eq!(files.trim(), "docs/a.md");
        // README zůstalo v indexu, nikam neodešlo.
        assert_eq!(git(&work, &["diff", "--cached", "--name-only"]), "README.md");
    }

    #[test]
    fn the_default_branch_is_found_even_without_origin_head() {
        let (_dir, _origin, work) = repo_with_remote();
        // `push -u` do bare repa `origin/HEAD` nenastaví -- přesně případ repa
        // založeného bez klonu.
        assert!(git_value("git", &work, &["symbolic-ref", "refs/remotes/origin/HEAD"]).is_empty());
        assert_eq!(default_branch("git", &work), "main");

        // Ukazatel na větev, která už není, se nepoužije.
        git(&work, &["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/master"]);
        assert_eq!(default_branch("git", &work), "main");
        assert!(switch_step("git", &work, "HEAD").is_err());
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
