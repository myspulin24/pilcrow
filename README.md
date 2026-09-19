<div align="center">

<img src="src-tauri/icons/128x128.png" alt="Pilcrow" width="96" height="96">

# Pilcrow

**Čtečka Markdownu a poznámkovník, který má všechno u vás v počítači.**

[![Vydání](https://img.shields.io/github/v/release/myspulin24/pilcrow?label=vyd%C3%A1n%C3%AD)](https://github.com/myspulin24/pilcrow/releases/latest)
[![CI](https://github.com/myspulin24/pilcrow/actions/workflows/ci.yml/badge.svg)](https://github.com/myspulin24/pilcrow/actions/workflows/ci.yml)
[![Licence](https://img.shields.io/badge/licence-MIT-blue)](LICENSE)
[![Platformy](https://img.shields.io/badge/platformy-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)](https://github.com/myspulin24/pilcrow/releases/latest)

[Instalace](#instalace) · [Funkce](#funkce) · [Konfigurace](#konfigurace) · [Vývoj](#vývoj) · [Soukromí](#soukromí-a-oprávnění)

</div>

---

## Přehled

Pilcrow je desktopová aplikace pro čtení a psaní Markdownu. Poznámky ukládá jako
obyčejné soubory `.md` ve složce, kterou si zvolíte — bez účtu, bez serveru,
bez proprietárního formátu. Vedle vlastního trezoru umí otevřít libovolnou
složku na disku, pracovat s dokumentací v gitovém repozitáři a odpovídat na
otázky k otevřené poznámce.

| | |
| --- | --- |
| **Platformy** | Windows 10/11, macOS 12+, Linux |
| **Formát dat** | Markdown (`.md`) + rebuildovatelný index SQLite |
| **Technologie** | Tauri 2, Rust, React 18, TypeScript, SQLite |
| **Jazyk rozhraní** | čeština |
| **Licence** | MIT |

---

## Instalace

Stáhněte instalátor pro svůj systém ze [stránky vydání](https://github.com/myspulin24/pilcrow/releases/latest).

| Systém | Soubor | Poznámka |
| --- | --- | --- |
| Windows | `Pilcrow_<verze>_x64-setup.exe` | Doporučeno. Aktualizace se instalují na místě. |
| Windows | `Pilcrow_<verze>_x64_cs-CZ.msi` | Pro hromadné nasazení. |
| macOS | `Pilcrow_<verze>_universal.dmg` | Univerzální balíček (Apple Silicon i Intel). |
| Linux | `Pilcrow_<verze>_amd64.AppImage` | Spustitelné bez instalace. |
| Linux | `Pilcrow_<verze>_amd64.deb`, `.rpm` | Pro správce balíčků. |

Instalátory pro Windows jsou podepsané vlastnoručně podepsaným certifikátem.
Systém proto při instalaci zobrazí varování „Neznámý vydavatel“ — to je
očekávané chování u certifikátu, který nevydala komerční certifikační autorita.

Aplikace kontroluje dostupnost nové verze při startu a nabídne ji ke stažení.
Kontrolu lze vypnout v nastavení nebo proměnnou `PILCROW_AUTO_UPDATE=0`.

---

## Funkce

### Poznámky

Vlastní trezor s poznámkami v Markdownu. Výchozí umístění je
`Dokumenty/Pilcrow`, lze změnit proměnnou `PILCROW_VAULT_PATH`.

- Štítky (`#projekt/klient`) s hierarchií a filtrováním
- Odkazy `[[wikilink]]` a automatické zpětné odkazy
- Fulltextové hledání (SQLite FTS5) s podporou dotazovacích operátorů
- Denní poznámky, skupiny souborů, paleta příkazů (`Ctrl` `K`)
- Lišta formátování a editor matematických vzorců (13 zápisů včetně LaTeXu,
  MathML, AsciiMath a Typstu)
- Třípolohový přepínač zobrazení: zdroj, obojí, náhled

### Soubory

Otevřete jednotlivý soubor `.md` nebo celou složku a procházejte ji jako strom.
Otevřená složka se pamatuje i mezi spuštěními.

- Vypisuje pouze Markdown; složky bez Markdownu se skrývají
- Přeskakuje `node_modules`, `target`, `.git` a podobné; limit 16 úrovní
  a 20 000 položek
- Soubory mimo trezor se ukládají beze změny — Pilcrow do nich nepřidává
  frontmatter ani metadata
- Detekce souběžné změny na disku s nabídkou řešení konfliktu
- Volitelné přesunutí externího souboru do trezoru

### Git a GitHub

Určeno pro práci s dokumentací v repozitáři. Vyžaduje nainstalovaný `git`;
pro práci s GitHubem navíc [GitHub CLI](https://cli.github.com) (`gh`).

- **Otevřít repozitář** — výběr ze seznamu repozitářů dostupných přihlášenému
  účtu, s naznačením, které už jsou na disku. Vybraný repozitář se stáhne
  a otevře jako složka.
- **Změny** — přehled upravených souborů `.md` v otevřené složce. Soubory
  upravené v Pilcrow jsou předvybrané; ostatní změny v repozitáři se zobrazí,
  ale nevyberou se samy.
- **Odeslání** — vybrané soubory se odešlou v novém commitu na novou větev.
  Do výchozí větve se nezapisuje; pull request se zakládá na GitHubu.
- **Průběh CI** — po odeslání se zobrazí stav běhu GitHub Actions pro daný
  commit, včetně jednotlivých úloh a kroků.

Přihlášení obstarává GitHub CLI; aplikace nemá přístup k přístupovému tokenu.
Z GitHubu se pouze čte — běhy se nespouštějí a workflow se nemění.

### Asistent

Volitelný panel pro dotazy k otevřené poznámce. Komunikaci zajišťuje
[Claude Code](https://claude.com/claude-code), takže aplikace nepracuje
s žádnými přihlašovacími údaji.

Funkce je **ve výchozím stavu vypnutá**, protože text otevřené poznámky
při dotazu opouští počítač. Zapíná se jednorázovým potvrzením v panelu.

---

## Konfigurace

Nastavení chování aplikace najdete v okně **Nastavení** (`Ctrl` `,`): motiv,
velikost písma, výchozí zobrazení, složka denních poznámek a kontrola
aktualizací.

Proměnné prostředí se načítají ze souboru `.env` v kořeni projektu. Vzorem je
[`.env.example`](.env.example).

| Proměnná | Výchozí | Popis |
| --- | --- | --- |
| `PILCROW_VAULT_PATH` | `~/Dokumenty/Pilcrow` | Umístění trezoru s poznámkami |
| `PILCROW_DAILY_FOLDER` | `daily` | Podsložka pro denní poznámky |
| `PILCROW_AUTO_UPDATE` | `1` | Kontrola aktualizací při startu |
| `PILCROW_DEV_PORT` | `5273` | Port vývojového serveru |
| `RUST_LOG` | `info` | Úroveň logování backendu |

Proměnné pro podepisování vydání (`TAURI_SIGNING_*`, `WINDOWS_CERTIFICATE*`)
jsou potřeba pouze při sestavování vydání, nikoli za běhu aplikace. Popis je
v `.env.example`.

### Synchronizace

Pilcrow neprovozuje vlastní synchronizaci. Trezor je běžná složka, takže ji
lze synchronizovat libovolným nástrojem — iCloud Drive, OneDrive, Dropbox,
Syncthing. Pro zařízení Apple nastavte `PILCROW_VAULT_PATH` do iCloud Drive.

Index (`.pilcrow/index.sqlite`) synchronizovat není nutné; kdykoli se dá
přestavět z Markdownu příkazem **Přestavět vyhledávací rejstřík**.

---

## Vývoj

### Požadavky

- [Node.js](https://nodejs.org) 20.10 nebo novější
- [Rust](https://rustup.rs) 1.77 nebo novější
- Na Linuxu [systémové závislosti Tauri](https://tauri.app/start/prerequisites/)

### Spuštění

```bash
npm start
```

Ověří nástroje, nainstaluje závislosti, vytvoří `.env`, vygeneruje ikony
a spustí aplikaci. První spuštění kompiluje Rust a trvá několik minut.

| Příkaz | Popis |
| --- | --- |
| `npm start` | Kompletní příprava a spuštění |
| `npm run setup` | Pouze příprava prostředí |
| `npm run dev` | Spuštění aplikace |
| `npm run dev:web` | Rozhraní v prohlížeči nad trezorem v paměti |
| `npm run build` | Sestavení vydání včetně instalátorů |
| `npm test` | Kompletní testovací sada |
| `npm run typecheck` | Kontrola typů |

### Sestavení

```bash
npm run build
```

Výstupy najdete v `src-tauri/target/release/bundle/`. Přepínač `--no-bundle`
sestaví pouze spustitelný soubor bez instalátorů.

Soubor `Pilcrow.exe` je na Windows soběstačný — využívá WebView2, které je
součástí systému. Instalátory slouží k zápisu do nabídky Start a k odinstalaci.

### Testy

```bash
npm test
```

Sada běží ve čtyřech fázích a pokračuje i po selhání, takže jeden příkaz
nahlásí všechny problémy najednou:

| Fáze | Nástroj | Rozsah |
| --- | --- | --- |
| Typy | `tsc --noEmit` | Kontrola typů celého frontendu |
| Rust | `cargo test -p pilcrow-core` | Souborová vrstva, cesty, index, procházení složek, registr přístupů |
| Jádro | `vitest run` | Parsování Markdownu, štítky, odkazy, hledání, git, repozitáře, texty |
| End-to-end | `vitest run --config vitest.e2e.config.ts` | Průchod aplikací přes DOM nad adaptéry v paměti |

Jednotlivé fáze lze spustit samostatně: `npm test -- rust`, `npm test -- unit`,
`npm test -- e2e`.

Integrační testy proti skutečnému `git` (dočasný repozitář s bare remotem)
vyžadují celý crate aplikace a spouští se zvlášť:

```bash
cargo test --manifest-path src-tauri/Cargo.toml -p pilcrow git::tests
```

### Architektura

```
src/core/          Čisté funkce bez I/O — Markdown, štítky, hledání, git
src/vault/         Rozhraní trezoru: TauriVault (disk) | MemoryVault (paměť)
src/git/           Rozhraní gitu:     TauriGit   (procesy) | MemoryGit
src/assistant/     Rozhraní asistenta
src/state/         Stavové stores (React context + reducer)
src/ui/            Komponenty rozhraní
src-tauri/         Backend v Rustu
  crates/pilcrow-core/   Souborová vrstva a rozhodovací logika bez Tauri
```

Architektura stojí na dvou pravidlech:

1. **Rozhodovací logika je v čistém jádru.** Rust i TypeScript spouštějí
   procesy a čtou soubory, ale porozumění výstupu má vždy jedno místo, které
   jde otestovat bez procesu, bez sítě a bez souborového systému.
2. **Každé rozhraní má dvě skutečné implementace.** Vedle produkční existuje
   paměťová se stejnou sémantikou. Díky tomu běží end-to-end testy nad reálnou
   aplikací a `npm run dev:web` funguje bez Rustu.

---

## Soukromí a oprávnění

Pilcrow nemá účty, telemetrii, analytiku ani hostované služby. Sám od sebe
navazuje jediné síťové spojení: dotaz na GitHub, zda vyšla novější verze.
Vypíná se proměnnou `PILCROW_AUTO_UPDATE=0`.

Dvě funkce komunikují se sítí, ale pouze na výslovný pokyn:

| Funkce | Co odchází | Kdy |
| --- | --- | --- |
| Asistent | Text otevřené poznámky (Anthropicu) | Po zapnutí funkce a odeslání dotazu |
| Git | Commit a push na váš vlastní remote | Po stisknutí tlačítka Odeslat |

Aplikace si vyžaduje minimální sadu oprávnění — úplný a systémem vynucovaný
seznam je v [`src-tauri/capabilities/default.json`](src-tauri/capabilities/default.json).

| Oprávnění | Účel |
| --- | --- |
| Čtení a zápis složky trezoru | Poznámky |
| Čtení souborů otevřených uživatelem | Pouze vybrané cesty, pouze pro dané spuštění |
| `dialog:allow-open` | Výběr souboru a složky |
| `opener:allow-reveal-item-in-dir` | Zobrazení ve správci souborů |
| `updater`, `process:allow-restart` | Aktualizace a restart |

Externí procesy (`claude`, `git`, `gh`) spouští backend v Rustu s pevně danými
argumenty. Plugin shellu není v oprávněních, takže webview nemůže sestavit
vlastní příkaz. Vykreslený Markdown se escapuje u zdroje a u odkazů se ověřuje
schéma.

**macOS:** při prvním otevření trezoru v `~/Documents` nebo iCloud Drive si
systém vyžádá přístup ke složce.

---

## Bezpečnost

Bezpečnostní chyby hlaste prosím
[soukromým hlášením](https://github.com/myspulin24/pilcrow/security/advisories/new),
nikoli veřejným issue. Rozsah a postup popisuje [SECURITY.md](SECURITY.md).

---

## Přispívání

Chyby a náměty patří do [issues](https://github.com/myspulin24/pilcrow/issues).
Před odesláním pull requestu spusťte `npm test`; stejnou sadu ověřuje CI.

Historie změn je v [CHANGELOG.md](CHANGELOG.md). Text vydání se z něj přebírá
automaticky a zobrazuje se v okně aktualizace.

---

## Licence

MIT © 2026 Michal Jašek — viz [LICENSE](LICENSE).
