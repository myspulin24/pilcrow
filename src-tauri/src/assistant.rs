//! Spuštění `claude` a přeposílání toho, co vypíše.
//!
//! Tenhle soubor je schválně hloupý. Nerozumí ani odpovědím, ani stavu
//! přihlášení -- jen spustí proces a posílá frontendu, co mu přišlo pod ruku.
//! Rozumět tomu se učí `src/core/assistant.ts`, stejně jako Markdownu rozumí
//! jen TypeScript. Jedna definice, jedno místo k opravě, jedno místo k testům.
//!
//! Předplatné se tu neřeší: `claude` je přihlášený sám, přes klíčenku systému.
//! Pilcrow se tak nikdy nedotkne žádného tokenu ani hesla.
//!
//! Čte se po **bajtech**, ne po řádcích. Dvakrát je to potřeba: přihlašovací
//! výzva „Paste code here“ končí mezerou, ne odřádkováním, a řádek by na ni
//! čekal donekonečna; a odpověď má chodit po kouscích, jak vzniká. Hranice
//! řádků si pak najde TypeScript, který je stejně jediný, kdo jim rozumí.

use std::io::{Read, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};

use tauri::ipc::{Channel, IpcResponse};

use pilcrow_core::assistant::{
    claude_candidates, install_command, take_decodable, AskRequest, AssistantChunk, AssistantProbe,
    StreamChunk, INSTALL_URL_UNIX, INSTALL_URL_WINDOWS,
};
use pilcrow_core::error::{CoreError, Result};

/// Nástroje Claude Code, které v poznámkovníku nemají co dělat.
///
/// `claude` je primárně agent na kód -- umí číst a přepisovat soubory nebo
/// spouštět příkazy. Tady má vést rozhovor nad jednou poznámkou a nic víc,
/// takže se mu to všechno zakáže. Poznámky upravuje uživatel, ne on.
const DENIED_TOOLS: &str = "Bash Edit Write Read Glob Grep NotebookEdit Task WebFetch WebSearch";

/// Co drží aplikace mezi voláními.
#[derive(Default)]
pub struct AssistantState {
    /// Nalezená cesta ke `claude`. Po instalaci se zahodí, aby se hledalo znovu.
    resolved: Mutex<Option<String>>,
    /// Běžící dotaz, aby šel zrušit.
    asking: Arc<Mutex<Option<Child>>>,
    /// Běžící přihlašování; drží se i jeho vstup, kam se píše kód z prohlížeče.
    login: Arc<Mutex<Option<LoginSession>>>,
}

struct LoginSession {
    child: Child,
    stdin: Option<ChildStdin>,
}

// -- hledání ----------------------------------------------------------------

pub(crate) fn home() -> Option<std::path::PathBuf> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(std::path::PathBuf::from)
}

/// Spustit `claude` s danými argumenty a počkat na celý výstup.
fn run(program: &str, args: &[&str]) -> std::io::Result<std::process::Output> {
    let mut command = Command::new(program);
    command.args(args).stdin(Stdio::null());
    hide_console(&mut command);
    command.output()
}

/// Na Windows by se jinak při každém spuštění mihlo okno konzole.
pub(crate) fn hide_console(command: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    let _ = command;
}

/// První kandidát, který odpoví na `--version`.
fn locate(state: &AssistantState) -> Option<(String, String)> {
    if let Some(cached) = state.resolved.lock().ok().and_then(|slot| slot.clone()) {
        if let Ok(output) = run(&cached, &["--version"]) {
            if output.status.success() {
                let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
                return Some((cached, version));
            }
        }
    }

    for candidate in claude_candidates(home().as_deref(), cfg!(windows)) {
        let Ok(output) = run(&candidate, &["--version"]) else {
            continue;
        };
        if !output.status.success() {
            continue;
        }
        let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if let Ok(mut slot) = state.resolved.lock() {
            *slot = Some(candidate.clone());
        }
        return Some((candidate, version));
    }
    None
}

fn require(state: &AssistantState) -> Result<String> {
    locate(state).map(|(path, _)| path).ok_or_else(|| {
        CoreError::Unavailable(
            "Claude Code na tomhle počítači není. Nainstaluj ho v nastavení asistenta.".into(),
        )
    })
}

// -- stav -------------------------------------------------------------------

/// Je nainstalováno? Je přihlášeno? A pod jakým účtem?
///
/// Dvě spuštění procesu, obě rychlá, a odpověď se nikde nekešuje. Nastavení
/// se na to ptá po otevření a po každém kroku, takže musí vidět dnešek --
/// ne to, co platilo, když se aplikace startovala.
#[tauri::command]
pub async fn assistant_status(state: tauri::State<'_, AssistantState>) -> Result<AssistantProbe> {
    let Some((path, version)) = locate(&state) else {
        return Ok(AssistantProbe {
            installed: false,
            version: String::new(),
            path: String::new(),
            auth: String::new(),
            error: String::new(),
        });
    };

    let (auth, error) = match run(&path, &["auth", "status", "--json"]) {
        Ok(output) => {
            let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if text.is_empty() {
                let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
                (String::new(), stderr)
            } else {
                (text, String::new())
            }
        }
        Err(error) => (String::new(), format!("`claude auth status` selhal: {error}")),
    };

    Ok(AssistantProbe {
        installed: true,
        version,
        path,
        auth,
        error,
    })
}

/// Přesný příkaz, který instalace spustí. UI ho ukáže dřív, než se klikne.
#[tauri::command]
pub fn assistant_install_command() -> String {
    install_command(cfg!(windows))
}

// -- proudové čtení ---------------------------------------------------------

/// Číst výstup potomka a posílat ho po kouscích, jak vzniká.
///
/// Generické přes typ kousku: totéž čerpadlo slouží asistentovi i gitu,
/// každý si jen nese svůj enum pro frontend.
pub(crate) fn pump<C: StreamChunk + IpcResponse>(
    mut source: impl Read,
    channel: &Channel<C>,
    slot: Arc<Mutex<Option<impl Killable>>>,
    // Kam si výstup zároveň odložit. Sekce Git ho potřebuje, aby uměla říct,
    // co přesně se pokazilo; asistentovi stačí, že text dorazí do panelu.
    seen: Option<&Mutex<String>>,
) -> bool {
    let mut buffer = [0_u8; 4096];
    let mut pending: Vec<u8> = Vec::new();

    loop {
        let read = match source.read(&mut buffer) {
            Ok(0) => break,
            Ok(count) => count,
            Err(error) => {
                let _ = channel.send(C::failed(format!("Čtení výstupu selhalo: {error}")));
                return false;
            }
        };

        pending.extend_from_slice(&buffer[..read]);
        let Some(text) = take_decodable(&mut pending) else {
            continue;
        };

        if let Some(seen) = seen {
            if let Ok(mut buffer) = seen.lock() {
                buffer.push_str(&text);
            }
        }
        if channel.send(C::out(text)).is_err() {
            // Frontend přestal poslouchat (zavřené okno, zrušený dotaz).
            // Nemá smysl pokračovat ani čekat na konec.
            if let Ok(mut held) = slot.lock() {
                if let Some(child) = held.as_mut() {
                    child.kill_now();
                }
            }
            return false;
        }
    }
    true
}

/// Cokoli, co se dá zabít, když už o to nikdo nestojí.
pub trait Killable {
    fn kill_now(&mut self);
    fn wait_now(&mut self) -> std::io::Result<std::process::ExitStatus>;
}

impl Killable for Child {
    fn kill_now(&mut self) {
        let _ = self.kill();
    }
    fn wait_now(&mut self) -> std::io::Result<std::process::ExitStatus> {
        self.wait()
    }
}

impl Killable for LoginSession {
    fn kill_now(&mut self) {
        // Vstup se zavře první, ať čekající `claude` nezůstane viset na čtení.
        self.stdin.take();
        let _ = self.child.kill();
    }
    fn wait_now(&mut self) -> std::io::Result<std::process::ExitStatus> {
        self.child.wait()
    }
}

/// Dočíst výstup, počkat na konec a ohlásit, jak to dopadlo.
///
/// Potomek je ve sdíleném slotu, ne v téhle funkci, aby ho mohlo zrušit
/// i tlačítko „Zastavit“. Čeká se až po vyjmutí ze slotu -- držet zámek přes
/// celé čekání by znamenalo, že rušení čeká na to, co má zrušit.
pub(crate) fn drain<T, C>(
    stdout: impl Read + Send + 'static,
    stderr: Option<impl Read + Send + 'static>,
    channel: Channel<C>,
    slot: Arc<Mutex<Option<T>>>,
) where
    T: Killable + Send + 'static,
    C: StreamChunk + IpcResponse + Send + 'static,
{
    std::thread::spawn(move || {
        let complete = pump(stdout, &channel, Arc::clone(&slot), None);
        let held = slot.lock().ok().and_then(|mut slot| slot.take());

        if !complete {
            // Čtení skončilo předčasně: chyba už odešla, nebo si o konec
            // řekl frontend. Není co hlásit, jen po sobě uklidit -- proces už
            // dostal `kill`, ale dokud se na něj nepočká, zůstane po něm
            // v tabulce procesů zápis.
            if let Some(mut child) = held {
                let _ = child.wait_now();
            }
            return;
        }

        let Some(mut child) = held else {
            // Někdo zatím stiskl „Zastavit“. Pro uživatele to není chyba.
            let _ = channel.send(C::finished());
            return;
        };

        match child.wait_now() {
            Ok(status) if status.success() => {
                let _ = channel.send(C::finished());
            }
            Ok(status) => {
                // Neúspěšný konec bez jediného slova by byl jen mlčení;
                // ať je aspoň vidět, co k tomu proces napsal.
                let details = stderr
                    .map(|mut handle| {
                        let mut text = String::new();
                        let _ = handle.read_to_string(&mut text);
                        text
                    })
                    .unwrap_or_default();
                let code = status.code().unwrap_or(-1);
                let message = if details.trim().is_empty() {
                    format!("Proces skončil s kódem {code}.")
                } else {
                    details.trim().chars().take(600).collect()
                };
                let _ = channel.send(C::failed(message));
            }
            Err(error) => {
                let _ = channel.send(C::failed(format!("Na proces se nepodařilo počkat: {error}")));
            }
        }
    });
}

// -- dotaz ------------------------------------------------------------------

/// Zeptat se Clauda a streamovat odpověď.
///
/// Čte se na vlastním vlákně, aby okno neztuhlo: odpověď může trvat desítky
/// vteřin a každý kousek má dorazit, jakmile vznikne, ne až na konci.
#[tauri::command]
pub async fn assistant_ask(
    state: tauri::State<'_, AssistantState>,
    request: AskRequest,
    channel: Channel<AssistantChunk>,
) -> Result<()> {
    let program = require(&state)?;

    let mut command = Command::new(program);
    command
        .arg("--print")
        .arg("--output-format")
        .arg("stream-json")
        .arg("--include-partial-messages")
        .arg("--verbose")
        // Bez zeptání se nic nepovolí; v poznámkovníku není komu se ptát.
        .arg("--permission-prompts")
        .arg("none")
        // Claude Code je agent na kód. Jeho vlastní pokyny, nástroje, CLAUDE.md
        // a připojené servery MCP tady nemají co dělat: k poznámce nic
        // nepřidají, zato by šly s každým dotazem přes drát a platily by se.
        // S nimi stojí jedna otázka zhruba dvakrát tolik než bez nich.
        .arg("--safe-mode")
        .arg("--restricted")
        .arg("--disable-slash-commands")
        .arg("--disallowed-tools")
        .arg(DENIED_TOOLS)
        .arg("--system-prompt")
        .arg(&request.system);

    // Pracovní složka rozhoduje, kam si `claude` ukládá sezení, takže musí být
    // pokaždé stejná -- jinak by `--resume` nenašlo, na co navazuje. Domovská
    // složka je jediná, která existuje vždycky. Nic se z ní nečte: soubory má
    // asistent zakázané.
    if let Some(home) = home() {
        command.current_dir(home);
    }

    if let Some(model) = request.model.as_deref().filter(|m| !m.trim().is_empty()) {
        command.arg("--model").arg(model);
    }

    // Pokračování rozhovoru. Bez toho by Claude u druhé otázky nevěděl,
    // o čem byla ta první.
    if let Some(session) = request.session_id.as_deref().filter(|s| !s.trim().is_empty()) {
        command.arg("--resume").arg(session);
    }

    command
        .arg(&request.prompt)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    hide_console(&mut command);

    let mut child = command
        .spawn()
        .map_err(|error| CoreError::Io(format!("Clauda se nepodařilo spustit: {error}")))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| CoreError::Io("Claude nedal k dispozici svůj výstup.".into()))?;
    let stderr = child.stderr.take();

    let slot = Arc::clone(&state.asking);
    if let Ok(mut held) = slot.lock() {
        if let Some(previous) = held.as_mut() {
            previous.kill_now();
        }
        *held = Some(child);
    }

    drain(stdout, stderr, channel, slot);
    Ok(())
}

/// Zastavit rozepsanou odpověď.
#[tauri::command]
pub fn assistant_cancel(state: tauri::State<'_, AssistantState>) {
    if let Ok(mut held) = state.asking.lock() {
        if let Some(mut child) = held.take() {
            child.kill_now();
        }
    }
}

// -- instalace --------------------------------------------------------------

/// Doinstalovat Claude Code oficiálním skriptem Anthropicu.
///
/// Stahuje a spouští skript z internetu, takže si o to musí říct uživatel
/// a musí u toho vidět, co přesně se spustí -- viz `assistant_install_command`.
/// Výstup instalátoru jde rovnou do panelu; když něco selže, je vidět co.
#[tauri::command]
pub async fn assistant_install(
    state: tauri::State<'_, AssistantState>,
    channel: Channel<AssistantChunk>,
) -> Result<()> {
    // Po instalaci bude `claude` jinde, než kde jsme naposledy hledali.
    if let Ok(mut slot) = state.resolved.lock() {
        *slot = None;
    }

    let mut command = if cfg!(windows) {
        let mut command = Command::new("powershell.exe");
        command
            .arg("-NoProfile")
            .arg("-ExecutionPolicy")
            .arg("Bypass")
            .arg("-Command")
            .arg(format!("irm {INSTALL_URL_WINDOWS} | iex"));
        command
    } else {
        let mut command = Command::new("sh");
        command
            .arg("-c")
            .arg(format!("curl -fsSL {INSTALL_URL_UNIX} | bash"));
        command
    };

    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        // Instalátor píše průběh na chybový výstup; bez sloučení by panel
        // mlčel a pak najednou skončil.
        .stderr(Stdio::piped());
    hide_console(&mut command);

    let mut child = command
        .spawn()
        .map_err(|error| CoreError::Io(format!("Instalaci se nepodařilo spustit: {error}")))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| CoreError::Io("Instalátor nedal k dispozici svůj výstup.".into()))?;
    let stderr = child.stderr.take();

    // Instalace se neruší: přerušit ji v půlce by nechalo rozbitou instalaci.
    let slot: Arc<Mutex<Option<Child>>> = Arc::new(Mutex::new(Some(child)));
    drain(stdout, stderr, channel, slot);
    Ok(())
}

// -- přihlášení -------------------------------------------------------------

/// Spustit přihlášení k předplatnému Claude.
///
/// `claude auth login` otevře prohlížeč a čeká, až mu na vstup přijde kód,
/// který se v prohlížeči objeví. Proto se tu drží jeho vstup otevřený:
/// uživatel kód vloží do políčka v aplikaci a `assistant_login_code` ho pošle
/// dál. Pilcrow ten kód nikde neukládá ani nečte -- jen ho podá.
#[tauri::command]
pub async fn assistant_login(
    state: tauri::State<'_, AssistantState>,
    channel: Channel<AssistantChunk>,
) -> Result<()> {
    let program = require(&state)?;

    let mut command = Command::new(program);
    command
        .arg("auth")
        .arg("login")
        // Výslovně předplatné, ne fakturace přes Console. Výchozí to sice je,
        // ale tohle je věc, kterou nikdo nechce zjistit až z faktury.
        .arg("--claudeai")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    hide_console(&mut command);

    let mut child = command
        .spawn()
        .map_err(|error| CoreError::Io(format!("Přihlášení se nepodařilo spustit: {error}")))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| CoreError::Io("Přihlášení nedalo k dispozici svůj výstup.".into()))?;
    let stderr = child.stderr.take();
    let stdin = child.stdin.take();

    let slot = Arc::clone(&state.login);
    if let Ok(mut held) = slot.lock() {
        if let Some(previous) = held.as_mut() {
            previous.kill_now();
        }
        *held = Some(LoginSession { child, stdin });
    }

    drain(stdout, stderr, channel, slot);
    Ok(())
}

/// Poslat přihlašování kód z prohlížeče.
#[tauri::command]
pub fn assistant_login_code(state: tauri::State<'_, AssistantState>, code: String) -> Result<()> {
    let mut held = state
        .login
        .lock()
        .map_err(|_| CoreError::Io("Stav přihlášení je nepoužitelný.".into()))?;

    let session = held
        .as_mut()
        .ok_or_else(|| CoreError::Unavailable("Přihlašování už neběží. Spusť ho znovu.".into()))?;

    let stdin = session
        .stdin
        .as_mut()
        .ok_or_else(|| CoreError::Unavailable("Přihlašování už kód nepřijímá.".into()))?;

    writeln!(stdin, "{}", code.trim())
        .and_then(|()| stdin.flush())
        .map_err(|error| CoreError::Io(format!("Kód se nepodařilo předat: {error}")))
}

/// Zrušit rozdělané přihlašování.
#[tauri::command]
pub fn assistant_login_cancel(state: tauri::State<'_, AssistantState>) {
    if let Ok(mut held) = state.login.lock() {
        if let Some(mut session) = held.take() {
            session.kill_now();
        }
    }
}

/// Odhlásit se.
#[tauri::command]
pub async fn assistant_logout(state: tauri::State<'_, AssistantState>) -> Result<()> {
    let program = require(&state)?;
    let output = run(&program, &["auth", "logout"])
        .map_err(|error| CoreError::Io(format!("Odhlášení se nepodařilo spustit: {error}")))?;

    if output.status.success() {
        return Ok(());
    }
    let details = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Err(CoreError::Io(if details.is_empty() {
        "Odhlášení selhalo.".into()
    } else {
        details
    }))
}

