//! Soubory, se kterými někdo Pilcrow spustil -- bez Tauri a bez okna.
//!
//! Cesta přijde třemi způsoby: v argumentech při startu (`Pilcrow.exe
//! poznamka.md`, dvojklik, „Otevřít v programu“), v argumentech druhého
//! spuštění, které plugin single-instance přepošle tomu běžícímu, a na macOS
//! jako `file://` adresa z Finderu nebo z `open -a Pilcrow`. Všechny tři
//! končí tady, takže o tom, co se otevře, rozhoduje jedno místo pokryté testy.
//!
//! Samotné předání do okna a udělení přístupu je v `src-tauri/src/launch.rs`;
//! tady je i [`LaunchInbox`], pravidlo, podle kterého se to předání řídí.

use std::ffi::OsStr;
use std::path::{Path, PathBuf};

use crate::explorer::is_markdown;

/// Kudy jdou soubory ze spuštění do okna: frontou, nebo rovnou.
///
/// Soubory z příkazové řádky jsou známé dřív, než frontend poslouchá, a to,
/// co by se mu poslalo do okna, které se teprve načítá, by se ztratilo.
/// Proto čekají ve frontě, dokud si ji frontend nevyzvedne ([`Self::take`]),
/// a teprve potom chodí rovnou ([`Self::offer`] je vrátí k odeslání). Kdo
/// drží obojí pod jedním zámkem, nemůže o soubor přijít ani ho dostat dvakrát.
#[derive(Debug, Default)]
pub struct LaunchInbox {
    pending: Vec<PathBuf>,
    taken: bool,
}

impl LaunchInbox {
    /// Přijmout soubory. Vrací ty, které se mají oknu poslat hned.
    ///
    /// Dokud si frontend frontu nevyzvedl, nevrací nic: soubory se zařadí,
    /// každý jen jednou.
    pub fn offer(&mut self, files: Vec<PathBuf>) -> Vec<PathBuf> {
        if self.taken {
            return files;
        }
        for file in files {
            if !self.pending.contains(&file) {
                self.pending.push(file);
            }
        }
        Vec::new()
    }

    /// Vyzvednout frontu. Od téhle chvíle `offer` posílá soubory rovnou,
    /// takže druhé vyzvednutí je prázdné.
    pub fn take(&mut self) -> Vec<PathBuf> {
        self.taken = true;
        std::mem::take(&mut self.pending)
    }
}

/// Které z argumentů jsou soubory, které má Pilcrow otevřít.
///
/// `args` jsou argumenty *bez* nultého, tedy bez cesty k programu samotnému.
/// Relativní cesta se dopočítá vůči `cwd`, složce, ze které se spouštělo --
/// u druhého spuštění je to jeho složka, ne ta běžící instance.
///
/// Projde jen existující soubor Markdownu. Přepínače (`-x`, `--neco`,
/// `-psn_…`, který macOS přidává starším aplikacím), složky, cesty, které
/// neexistují, a soubory jiného typu se tiše přeskočí: argumenty nepíše
/// uživatel ručně a hláška „tohle neznám“ by neměla komu pomoct. Každý soubor
/// se vrátí jen jednou, v pořadí, v jakém přišel.
pub fn files_from_args<I, S>(args: I, cwd: &Path) -> Vec<PathBuf>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    let mut files: Vec<PathBuf> = Vec::new();
    for arg in args {
        let Some(path) = path_from_arg(arg.as_ref()) else {
            continue;
        };
        let path = if path.is_absolute() { path } else { cwd.join(path) };
        if path.is_file() && is_markdown(&path) && !files.contains(&path) {
            files.push(path);
        }
    }
    files
}

/// Cesta z jednoho argumentu, nebo `None`, když to cesta není.
fn path_from_arg(arg: &OsStr) -> Option<PathBuf> {
    let text = arg.to_string_lossy();
    if text.is_empty() || text.starts_with('-') {
        return None;
    }
    // Adresa `file://` se rozpozná podle začátku, ne pokusem o rozparsování:
    // `C:\poznamky\a.md` je pro parser adres taky adresa, se schématem `c`.
    // `get` místo řezu, protože sedmý bajt může padnout doprostřed `č`.
    let is_file_url = text
        .get(..7)
        .is_some_and(|scheme| scheme.eq_ignore_ascii_case("file://"));
    if is_file_url {
        return url::Url::parse(&text).ok()?.to_file_path().ok();
    }
    Some(PathBuf::from(arg))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn fixture() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("schuzka.md"), "# Schůzka").unwrap();
        fs::write(dir.path().join("zapis.markdown"), "# Zápis").unwrap();
        fs::write(dir.path().join("fotka.png"), "png").unwrap();
        fs::create_dir_all(dir.path().join("slozka.md")).unwrap();
        dir
    }

    fn arg(path: &Path) -> String {
        path.to_string_lossy().to_string()
    }

    #[test]
    fn an_absolute_markdown_path_is_opened() {
        let dir = fixture();
        let file = dir.path().join("schuzka.md");
        assert_eq!(files_from_args([arg(&file)], Path::new("/")), vec![file]);
    }

    #[test]
    fn a_relative_path_resolves_against_the_launching_folder() {
        let dir = fixture();
        assert_eq!(
            files_from_args(["schuzka.md"], dir.path()),
            vec![dir.path().join("schuzka.md")]
        );
    }

    #[test]
    fn flags_are_skipped() {
        let dir = fixture();
        let file = dir.path().join("schuzka.md");
        let found = files_from_args(
            ["--verbose".to_string(), "-psn_0_12345".to_string(), arg(&file)],
            dir.path(),
        );
        assert_eq!(found, vec![file]);
    }

    #[test]
    fn missing_files_folders_and_other_types_are_skipped() {
        let dir = fixture();
        let found = files_from_args(
            [
                arg(&dir.path().join("neexistuje.md")),
                arg(&dir.path().join("fotka.png")),
                // Složka, i když se jmenuje jako soubor Markdownu.
                arg(&dir.path().join("slozka.md")),
                String::new(),
            ],
            dir.path(),
        );
        assert!(found.is_empty(), "nic z toho se otevřít nemá: {found:?}");
    }

    #[test]
    fn every_markdown_extension_the_explorer_shows_is_accepted() {
        let dir = fixture();
        let found = files_from_args(["schuzka.md", "zapis.markdown"], dir.path());
        assert_eq!(found.len(), 2);
    }

    #[test]
    fn the_same_file_twice_is_opened_once_in_the_order_given() {
        let dir = fixture();
        let first = dir.path().join("zapis.markdown");
        let second = dir.path().join("schuzka.md");
        let found = files_from_args(
            [arg(&first), arg(&second), "zapis.markdown".to_string()],
            dir.path(),
        );
        assert_eq!(found, vec![first, second]);
    }

    #[test]
    fn a_file_url_is_turned_into_a_path() {
        // Tak to posílá macOS, a tak to umí předat i některé správce souborů.
        let dir = fixture();
        fs::write(dir.path().join("s mezerou.md"), "# Mezera").unwrap();
        let file = dir.path().join("s mezerou.md");
        let url = url::Url::from_file_path(&file).unwrap().to_string();
        assert!(url.contains("%20"), "adresa má mezeru zakódovanou: {url}");

        assert_eq!(files_from_args([url], Path::new("/")), vec![file]);
    }

    #[test]
    fn other_urls_are_not_paths() {
        let dir = fixture();
        let found = files_from_args(
            ["https://example.com/schuzka.md", "file://"],
            dir.path(),
        );
        assert!(found.is_empty());
    }

    #[test]
    fn short_non_ascii_names_do_not_trip_the_url_check() {
        // `čččč` má osm bajtů a sedmý padne doprostřed znaku.
        let dir = fixture();
        fs::write(dir.path().join("čččč.md"), "# č").unwrap();
        assert_eq!(
            files_from_args(["čččč.md"], dir.path()),
            vec![dir.path().join("čččč.md")]
        );
    }

    #[test]
    fn nothing_in_nothing_out() {
        let dir = fixture();
        assert!(files_from_args(Vec::<String>::new(), dir.path()).is_empty());
    }

    #[test]
    fn files_offered_before_the_take_wait_for_it() {
        let mut inbox = LaunchInbox::default();
        assert!(inbox.offer(vec![PathBuf::from("/a.md")]).is_empty());
        assert!(inbox.offer(vec![PathBuf::from("/b.md")]).is_empty());

        assert_eq!(inbox.take(), vec![PathBuf::from("/a.md"), PathBuf::from("/b.md")]);
    }

    #[test]
    fn after_the_take_files_go_straight_through_and_only_once() {
        let mut inbox = LaunchInbox::default();
        inbox.offer(vec![PathBuf::from("/a.md")]);
        assert_eq!(inbox.take().len(), 1);

        assert_eq!(inbox.offer(vec![PathBuf::from("/b.md")]), vec![PathBuf::from("/b.md")]);
        // Nic z toho nezůstalo ve frontě, takže se to nepošle podruhé.
        assert!(inbox.take().is_empty());
    }

    #[test]
    fn a_file_offered_twice_before_the_take_is_queued_once() {
        // Dvojklik a hned druhý, zatímco se Pilcrow teprve spouští.
        let mut inbox = LaunchInbox::default();
        inbox.offer(vec![PathBuf::from("/a.md")]);
        inbox.offer(vec![PathBuf::from("/a.md")]);
        assert_eq!(inbox.take(), vec![PathBuf::from("/a.md")]);
    }
}
