# Reader_MJ

Čtečka Markdownu a poznámkovník, který má všechno u tebe v počítači.

**Čti** jakýkoli Markdown, který máš na disku: otevři jeden soubor `.md`, nebo
otevři celou složku a procházej ji jako rozbalovací strom — rovnou pod
vyhledávacím polem, ve stejném sloupci jako tvoje poznámky. Nebo soubory prostě
přetáhni na okno. Třípolohový přepínač se posouvá mezi zdrojovým Markdownem,
oběma panely a vykresleným náhledem.

**Piš** do vlastního trezoru: poznámky se štítky, odkazy `[[...]]` a zpětnými
odkazy, okamžité fulltextové hledání, denní poznámky a paleta příkazů ovládaná
z klávesnice — všechno uložené jako **obyčejné soubory Markdown ve složce, která
patří tobě**.

Žádný účet. Žádný server. Žádná telemetrie. Jediné, co jde ven, je dotaz na
GitHub, jestli vyšla novější verze — a i ten se dá vypnout. Tvoje poznámky jsou
soubory `.md`; všechno ostatní je jen mezipaměť, která se z nich dá kdykoli
postavit znovu.

```
┌──────────────┬─────────────────────┬──────────────────────────┐
│ Reader_MJ  « │ [ hledat ]          │ [ Zdroj │Obojí│ Náhled ] │
│              │                     │                          │
│ SKUPINY    + │ ▾ POZNÁMKY       12 │   čtečka / editor        │
│ ▾ Bitdefender│    Vítej            │   + živý náhled          │
│   📄 KONFIG  │    Seznam ke čtení  │   + zpětné odkazy        │
│   📄 PLÁN    │                     │                          │
│ ▸ Ke čtení   │ ▾ 📂 docs 9 souborů │                          │
│              │   ▸ 📁 navody       │                          │
│ ▾ ŠTÍTKY     │   ▾ 📁 reference    │                          │
│   #práce     │       📄 api.md     │                          │
│   #napady    │     📄 README.md    │                          │
│              │ [Otevřít soubor][…] │                          │
└──────────────┴─────────────────────┴──────────────────────────┘
  tvoje skupiny    navigace               dokument
```

**Skupiny** jsou tvoje: pojmenované seznamy souborů, které si sám propojíš,
odkudkoli z počítače. **Poznámky a soubory** sdílí jedno vyhledávací pole —
psaním se zároveň zužují poznámky podle textu a strom souborů podle názvu.
Každá sekce se dá sbalit a celý levý panel schovat přes `Cmd/Ctrl` `\`.

Tvůj trezor na disku:

```
Trezor/
├── Vítej v Reader_MJ.md         jeden soubor Markdown na poznámku
├── daily/
│   └── 2026-09-15.md            denní poznámky jsou obyčejné soubory
├── projekty/
│   └── Zahájení Acme.md
├── attachments/
│   └── 20260915123456-schema.png
└── .reader_mj/
    ├── index.sqlite             přestavitelný rejstřík — smazat je bezpečné
    └── settings.json
```

---

## Rychlý start

Jeden příkaz, z čerstvého klonu:

```bash
npm start
```

Zkontroluje nástroje, nainstaluje závislosti, vytvoří `.env` podle
`.env.example`, vygeneruje ikony a spustí Reader_MJ. První spuštění překládá
Rust a trvá pár minut; každé další jsou vteřiny.

**Co musíš mít:** [Node 20.10+](https://nodejs.org) a
[Rust 1.77+](https://rustup.rs). Na Linuxu k tomu
[systémové balíčky pro Tauri](https://tauri.app/start/prerequisites/).
`npm start` všechno zkontroluje a přesně ti řekne, co chybí.

Další příkazy:

| Příkaz | Co dělá |
| --- | --- |
| `npm start` | Všechno nastaví a spustí aplikaci |
| `npm run setup` | Jen nastaví, nespouští |
| `npm run dev` | Spustí aplikaci (předpokládá hotové nastavení) |
| `npm run dev:web` | Jen rozhraní v prohlížeči nad ukázkovým trezorem v paměti |
| `npm run build` | Sestaví release a instalátory ([cesty](#sestavení-release)) |
| `npm test` | Spustí všechny testy |
| `npm run icons` | Vygeneruje ikony znovu |

### Sestavení release

```bash
npm run build
```

Výsledky najdeš v `src-tauri/target/release/`:

| Systém | Výstup |
| --- | --- |
| Windows | `Reader_MJ.exe` (samostatný, ~4,7 MB) · `bundle/nsis/Reader_MJ_<verze>_x64-setup.exe` · `bundle/msi/Reader_MJ_<verze>_x64_cs-CZ.msi` |
| macOS | `bundle/macos/Reader_MJ.app` · `bundle/dmg/Reader_MJ_<verze>_<arch>.dmg` |
| Linux | `bundle/appimage/*.AppImage` · `bundle/deb/*.deb` |

`Reader_MJ.exe` je soběstačný — zkopíruj ho kamkoli a spusť. Používá běhové
prostředí WebView2, které je součástí Windows 10/11. Instalátory jsou jen kvůli
položce v nabídce Start a odinstalaci.

Přidej `--no-bundle` a sestaví se jen binárka bez instalátorů.

---

## Aktualizace

Reader_MJ se udržuje aktuální sám z [GitHub Releases](https://github.com/myspulin24/reader-mj/releases).

Jak to probíhá:

1. Po startu se aplikace podívá, jestli vyšla novější verze.
2. Když ano, **hned ji na pozadí stáhne** a ověří podpis.
3. Až je hotová, otevře okno s tím, co je nového, a jedním tlačítkem
   **Nainstalovat a restartovat** se aplikace přepne na novou verzi.
   Rozepsaná poznámka se předtím uloží.

Instalaci si odklikneš schválně: instalátor Reader_MJ zavře a spustí znovu,
a to není věc, která by se měla stát uprostřed věty. Stahování běží bez ptaní,
takže to kliknutí je opravdu jen jedno.

**Ruční kontrola** je ve stavovém řádku vpravo dole (tlačítko s číslem verze)
a v paletě příkazů pod `Zkontrolovat aktualizace`. Když je všechno aktuální,
řekne to a nic dalšího se neděje.

**Vypnout automatickou kontrolu:** `READER_MJ_AUTO_UPDATE=0` v `.env`. Ruční
kontrola funguje dál. Aktualizace jsou jediné síťové spojení, které Reader_MJ
navazuje — s vypnutou kontrolou neposílá vůbec nic.

### Podpis

Každý aktualizační balíček je podepsaný a aplikace ověřuje podpis veřejným
klíčem zapečeným v `src-tauri/tauri.conf.json`. Balíček, který nesedí, se
nenainstaluje — ani kdyby se někdo vloupal do releasu na GitHubu. Soukromý klíč
v repozitáři není a nikdy nebude; žije v `.env` (mimo git) a v secrets
repozitáře.

### Vydání nové verze

```bash
# 1. zvedni číslo verze na obou místech
#    package.json  ->  "version"
#    src-tauri/tauri.conf.json  ->  "version"
#    src-tauri/Cargo.toml  ->  [package] version

# 2. commit a tag
git commit -am "v0.2.0"
git tag v0.2.0
git push && git push --tags
```

Tag `v*` spustí workflow [`release.yml`](.github/workflows/release.yml): sestaví
instalátory pro Windows, macOS i Linux, podepíše je klíčem ze secrets a vydá je
jako release i s `latest.json`, na který se dívá updater. Nic dalšího dělat
nemusíš — běžícím instalacím se nová verze nabídne sama.

Repozitář potřebuje dva secrets (`Settings → Secrets and variables → Actions`):

| Secret | Co to je |
| --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | Obsah souboru se soukromým klíčem |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Heslo k němu |

---

## Skupiny

Levý panel je místo pro soubory, které k sobě patří, ale neleží vedle sebe.
Skupina je název a seznam odkazů — nic se nepřesouvá ani nekopíruje.

- **Klikni pravým na poznámku nebo soubor → Přidat do skupiny.** Vyber
  existující skupinu, nebo ji rovnou založ.
- Skupina může míchat zdroje bez omezení: poznámku z trezoru, `README`
  z projektové složky, specifikaci na jiném disku.
- Kliknutím na soubor ve skupině ho otevřeš. O to přesně jde: soubory zůstanou
  tam, kde jsou, a skupina je způsob, jak se k nim vrátit.
- Odebrání souboru ze skupiny se souboru nedotkne. Smazání skupiny se nedotkne
  ani jednoho souboru.

Skupiny se ukládají do `.reader_mj/collections.json` uvnitř trezoru, takže
přežijí restart a putují s ním. Propojení souboru si zároveň zapamatuje
oprávnění ho číst — jinak by propojený soubor byl při dalším spuštění
nečitelný, což by celou funkci zbavilo smyslu. Položky, jejichž soubor mezitím
zmizel, se při načtení odstraní.

**Štítky** sedí pod skupinami a popisují jen poznámky v trezoru: čtou se přímo
z Markdownu, takže nemůžou platit pro cizí soubory. V tom je ten rozdíl, jednou
větou — štítky pocházejí z textu, skupiny od tebe.

---

## Pravé tlačítko

| Klikneš pravým na | Co dostaneš |
| --- | --- |
| Poznámku | Otevřít · Přidat do skupiny · Připnout · Přejmenovat *(přepíše odkazy)* · Smazat |
| Soubor ve stromu | Otevřít · Přidat do skupiny · Ukázat ve správci souborů · Smazat z disku |
| Složku ve stromu | Rozbalit / Sbalit · Rozbalit vše · Sbalit vše |
| Skupinu | Přejmenovat · Přidat otevřený soubor · Smazat skupinu *(soubory zůstanou)* |
| Soubor ve skupině | Otevřít · Odebrat ze skupiny *(soubor zůstane)* · Smazat soubor |

Mazání se vždycky nejdřív ptá a natvrdo říká, jestli soubor opouští trezor,
nebo disk.

---

## Sekce Soubory

Pod poznámkami, ve stejném sloupci, sedí každá složka, kterou otevřeš. Čte
Markdown, který v trezoru **není**.

| | |
| --- | --- |
| **Otevřít soubor...** (`Cmd/Ctrl` `O`) | Vyber jeden soubor `.md` a čti ho. |
| **Otevřít složku...** (`Cmd/Ctrl` `Shift` `O`) | Vyber složku a procházej ji jako strom. |

Nebo **přetáhni soubory či složku z Průzkumníka/Finderu rovnou na okno**.
Puštěná složka se otevře jako strom, puštěný Markdown se otevře ke čtení.
Cokoli jiného se slušně odmítne.

Ze složky se stane strom podsložek a souborů Markdown. Kliknutím na složku ji
rozbalíš nebo sbalíš, kliknutím na soubor ho otevřeš. V hlavičce sekce je
⇲ rozbalit vše, ⇱ sbalit vše, ↻ načíst znovu a × zavřít. Vyhledávací pole
nahoře ve sloupci slouží zároveň jako filtr stromu a nechává v něm složky, které
k nálezům vedou.

Tři věci, které projití složky dělá záměrně:

- **Vypisuje jen Markdown** — `.md`, `.markdown`, `.mdown`, `.mkd`.
- **Složky, pod kterými žádný Markdown není, se schovají.** Namiř to na
  repozitář s kódem a dostaneš jeho dokumenty, ne jeho adresářovou strukturu.
- **`node_modules`, `target`, `.git` a spol. se přeskakují**, symbolické odkazy
  se nenásledují a procházení končí na 16 úrovních nebo 20 000 položkách — takže
  otevření velké složky nemůže aplikaci zaseknout. Když se na limit narazí,
  panel to napíše.

Takhle otevřené soubory si Reader_MJ **nepřivlastňuje**. Ukáže je přesně tak,
jak jsou, a úpravy zapíše bajt po bajtu zpátky: nikdy do souboru, který
nevytvořil, nepřidá frontmatter, id ani záznam do rejstříku. Jediné, co přidá,
je stejná pojistka jako u trezoru — když se soubor na disku změní, zatímco ho
máš otevřený, dostaneš pohled na konflikt místo přepsání.

`Cmd/Ctrl` `B` sekci Soubory složí, aniž by zavřel složku.

---

## Hlavní smyčka

**Piš.** Poznámky jsou Markdown. Štítkuj přes `#napad` nebo
`#prace/klienti/acme` — štítky se dají zanořovat a v bočním panelu se ukáže
strom. Odkazuj přes `[[Jiná poznámka]]`; napiš `[[` a otevře se výběr. Otevři
odkaz na poznámku, která ještě neexistuje, a Reader_MJ ji vytvoří.

**Hledej.** Hledání je okamžité, přes název, text i štítky:

| Dotaz | Význam |
| --- | --- |
| `čtvrtletní plán` | musí sedět všechna slova |
| `"přesná fráze"` | hledá se doslova |
| `štítek:práce` | se štítkem `práce` — i s jakýmkoli potomkem, třeba `práce/klienti/acme` |
| `-štítek:archiv` | štítek vyloučí |
| `je:připnuté` | jen připnuté poznámky |
| `má:úkoly` | poznámky s aspoň jedním zaškrtávátkem |

Anglické tvary (`tag:`, `is:pinned`, `has:tasks`) fungují pořád taky, stejně
jako zkratka `#stitek`.

**Synchronizuj.** Dej trezor do iCloud Drive (níž). Žádný proprietární
synchronizační server — záměrně.

**Exportuj.** `Exportovat trezor do složky...` zkopíruje každou poznámku
i přílohu do obyčejné složky. Není z čeho utíkat; je to pořád ten samý Markdown.

### Klávesnice

Ke všemu se dostaneš přes `Cmd`/`Ctrl` + `K`, kde jsou u příkazů i zkratky.

| Zkratka | Akce |
| --- | --- |
| `Cmd/Ctrl` `K` | Paleta příkazů (příkazy **i** poznámky) |
| `Cmd/Ctrl` `N` | Nová poznámka |
| `Cmd/Ctrl` `Shift` `N` | Nová poznámka ve složce |
| `Cmd/Ctrl` `D` | Dnešní denní poznámka |
| `Cmd/Ctrl` `F` | Kurzor do hledání |
| `Cmd/Ctrl` `L` nebo `[[` | Vložit odkaz na poznámku |
| `F2` | Přejmenovat poznámku *(přepíše všechny odkazy sem)* |
| `Cmd/Ctrl` `Shift` `M` | Přesunout poznámku do složky |
| `Cmd/Ctrl` `Shift` `P` | Připnout / odepnout |
| `Cmd/Ctrl` `S` | Uložit hned (ukládá se stejně samo) |
| `Cmd/Ctrl` `E` | Přepnout zobrazení: zdroj → obojí → náhled |
| `Cmd/Ctrl` `\` | Skrýt / zobrazit levý panel |
| `Cmd/Ctrl` `B` | Sbalit / rozbalit sekci Soubory |
| `Cmd/Ctrl` `O` | Otevřít soubor Markdown odkudkoli |
| `Cmd/Ctrl` `Shift` `O` | Otevřít složku |
| `Cmd/Ctrl` `Shift` `G` | Nová skupina |
| `Cmd/Ctrl` `Shift` `R` | Přestavět vyhledávací rejstřík |

Ve vyhledávacím poli `↓` `↑` projíždí výsledky a `Enter` skočí do editoru,
takže se dá jít od myšlenky k psaní bez sáhnutí na myš.

### Přepínač zobrazení

Vpravo nahoře nad dokumentem, tři polohy:

| | |
| --- | --- |
| **Zdroj** | zdrojový Markdown, nic víc |
| **Obojí** | zdroj a náhled vedle sebe |
| **Náhled** | vykreslený dokument, vycentrovaný na čtení |

Klikni na segment, přetáhni přes něj, nebo použij `←` / `→`, když je zaměřený;
`Cmd/Ctrl` `E` přepíná dokola. Jezdec mezi polohami animuje a respektuje
`prefers-reduced-motion`.

### Co z Markdownu umí

Nadpisy, tučné/kurzíva/přeškrtnuté/`==zvýrazněné==`, seznamy úkolů, zanořené
seznamy, tabulky se zarovnáním, bloky kódu, citace, odkazy, automatické odkazy
a místní obrázkové přílohy. Přetáhni obrázek na editor (nebo ho vlož ze
schránky) a zkopíruje se do `attachments/` a odkáže se relativní cestou.

---

## Architektura

```
┌──────────────────────── webview (React + TypeScript) ─────────────────────┐
│                                                                           │
│  src/core/        ČISTÉ. Žádné I/O, žádný React. Celá doména:             │
│                   frontmatter · štítky · odkazy [[...]] · renderer        │
│                   Markdownu · bezpečné názvy souborů · dotazy hledání     │
│                   · diff · SHA-256 · tvar stromu souborů · skupiny        │
│                   · trojpolohový režim zobrazení                          │
│                                                                           │
│  src/vault/       VaultApi — jedno rozhraní, dvě implementace:            │
│                   TauriVault (skutečná) · MemoryVault (prohlížeč + testy) │
│                                                                           │
│  src/state/       reducer + akce + registr příkazů                        │
│  src/ui/          komponenty; vykreslují jen to, co jim řekne stav        │
└───────────────────────────────── IPC ─────────────────────────────────────┘
┌──────────────────────────── Rust (Tauri 2) ───────────────────────────────┐
│  src-tauri/src/            příkazy · hlídač souborů · stav aplikace       │
│                                                                           │
│  src-tauri/crates/         reader-mj-core — BEZ závislosti na Tauri, takže│
│    reader-mj-core/         se celý crate otestuje za pár sekund:          │
│                                                                           │
│      paths.rs        každá cesta v trezoru se kontroluje dvakrát          │
│      vault.rs        atomické zápisy, detekce konfliktů, export/import    │
│      index.rs        SQLite + FTS5, kdykoli přestavitelný                 │
│      explorer.rs     projití složky, registr přístupů, puštěné cesty      │
│      collections.rs  tvoje skupiny a přístupy, které s sebou nesou        │
└───────────────────────────────────────────────────────────────────────────┘
```

Zbytek kódu vysvětlí čtyři rozhodnutí:

**1. Parsování Markdownu žije v TypeScriptu, ne v Rustu.** Frontend rozebere
poznámku a Rustu podá už hotový řádek rejstříku. Existuje přesně jedna definice
toho, „co je štítek“, místo dvou, které by se časem rozešly — a ta jedna se dá
triviálně pokrýt unit testy.

**2. Rejstřík SQLite je mezipaměť, nikdy zdroj pravdy.** Každý sloupec se
odvozuje ze souboru. `Přestavět vyhledávací rejstřík` ho zahodí a naplní znovu.
Smazáním `.reader_mj/index.sqlite` nepřijdeš o nic.

**3. `VaultApi` má dvě implementace.** Ta paměťová není atrapa — vynucuje
stejná pravidla konfliktů a sdílí `src/core` s tou skutečnou. Díky ní má smysl
`npm run dev:web`, na ní běží end-to-end testy a na ni aplikace spadne zpět
(s viditelnou hláškou), když běhové prostředí Tauri chybí.

**4. Reader_MJ smí číst jen to, co jsi otevřel.** Čtení mimo trezor vyžaduje
výslovné povolení a vydat ho umí jedině nativní dialog na výběr souboru
a přetažení myší — v obou případech ukazuje na cestu uživatel a výběr
i povolení proběhnou v jednom volání backendu, takže frontend si nemůže sám
podstrčit cestu, kterou uživatel nevybral. Povolení složky platí i na všechno
pod ní; povolení jednoho souboru platí na ten soubor a nic jiného, ani na jeho
sourozence. Povolení žijí v paměti a se zavřením aplikace zmizí. Je to hranice,
ne sandbox: webview spouští jen přibalený kód, takže hodnota je v tom, že
pravidlo je výslovné a otestované, ne jen předpokládané.

### Formát poznámky

```markdown
---
id: mfq2k1x8a7b3c9d0
title: Zahájení Acme
created: 2026-09-15T09:12:00.000Z
updated: 2026-09-15T11:40:22.114Z
pinned: false
tags: [prace/klienti/acme]
---

# Zahájení Acme

Poznámky z hovoru. #navazat

Dál: [[Čtvrtletní plán]]

- [x] poslat prezentaci
- [ ] domluvit další schůzku
```

Frontmatter se spravuje za tebe — nikdy ho nepíšeš. Klíče, kterým Reader_MJ
nerozumí (Obsidianovské `aliases`, `cssclass`, cokoli dalšího), se při každém
zápisu **zachovají doslova**, takže sdílení složky s jiným editorem nic
neztrácí. Soubor úplně bez frontmatteru se otevře taky: název se vezme z prvního
nadpisu nebo z názvu souboru.

### Změny zvenčí a konflikty

Zdrojem pravdy jsou soubory, takže je může změnit cokoli — iCloud Drive, textový
editor, `git checkout`. Reader_MJ trezor hlídá a:

- **tiše načte znovu**, když nemáš neuložené úpravy;
- **ignoruje** změny, které jsou jeho vlastní zápisy (porovnává se hash obsahu,
  ne časovač, takže se to nemůže rozjet);
- **ukáže pohled na konflikt**, když se změnily obě strany — řádkový rozdíl
  disku proti tvému textu, s *Použít verzi z disku*, *Nechat obě* a *Nechat moji
  verzi*. Dokud se nerozhodneš, nic se nezapíše.

Stejná kontrola hlídá každé uložení: zápis s sebou nese hash, se kterým editor
soubor načetl, a Rust ho odmítne, pokud soubor už nesedí. **Reader_MJ nikdy
tiše nepřepisuje.**

---

## Oprávnění

Reader_MJ si říká o tak málo, jak jen desktopová aplikace může:

| Oprávnění | Proč |
| --- | --- |
| Číst a zapisovat složku trezoru | Jsou to tvoje poznámky |
| Číst soubory, které otevřeš nebo pustíš na okno | Jen ty, a jen pro tohle spuštění |
| `dialog:allow-open` | Výběr souboru a složky |
| `opener:allow-reveal-item-in-dir` | „Ukázat trezor ve správci souborů“ |
| `protocol-asset` (omezené) | Aby webview mohlo zobrazit místní obrázky |
| `updater` + `process:allow-restart` | Stažení nové verze a restart do ní |

Neříká si o **žádný shell, žádná oznámení, žádnou schránku, žádné spouštění po
startu**. Viz `src-tauri/capabilities/default.json` — ten soubor je úplný seznam
a Tauri ho vynucuje za běhu.

Na síť sahá jedinou věcí: kontrolou aktualizací na `github.com`. Ta se navíc
neděje ve webview, ale v Rustu — politika obsahu (`src-tauri/tauri.conf.json`)
tak i nadále blokuje **jakékoli** vzdálené spojení ze stránky samotné.
`READER_MJ_AUTO_UPDATE=0` vypne i tu jednu kontrolu. Vykreslený Markdown se
escapuje už u zdroje a u každé URL se kontroluje schéma, takže poznámka
obsahující `<script>` nebo odkaz
`javascript:` je neškodná.

**macOS:** když poprvé otevřeš trezor v `~/Documents` nebo v iCloud Drive,
macOS si řekne o přístup ke složce. Povol ho jednou. Když ho odmítneš, Reader_MJ
ukáže obrazovku s vysvětlením, ne prázdné okno.

---

## Kde jsou tvoje data

Ve výchozím stavu:

| Systém | Trezor |
| --- | --- |
| macOS | `~/Documents/Reader_MJ` |
| Windows | `%USERPROFILE%\Documents\Reader_MJ` |
| Linux | `~/Documents/Reader_MJ` |

Změníš to nastavením `READER_MJ_VAULT_PATH` v `.env`. Nikde jinde se nic
neukládá — žádný adresář v podpoře aplikací, žádná skrytá databáze, žádný cloud.

### Synchronizace na zařízení Apple

Reader_MJ nemá synchronizační server záměrně. Nasměruj trezor do iCloud Drive
a složka se synchronizuje jako kterákoli jiná:

```bash
# .env
READER_MJ_VAULT_PATH=/Users/ty/Library/Mobile Documents/com~apple~CloudDocs/Reader_MJ
```

Poznámky se pak objeví v aplikaci **Soubory** na iPhonu a iPadu, upravíš je
v jakémkoli iOS editoru Markdownu a za chvíli jsou zpátky na Macu. Protože názvy
souborů jsou omezené na to, co přijme macOS, Windows i iCloud zároveň, trezor
napsaný na jednom stroji se vždycky otevře i na ostatních.

Když stejnou poznámku upraví dvě zařízení naráz, iCloud zachová obě a Reader_MJ
ti ukáže pohled na konflikt místo toho, aby vybral vítěze za tebe.

Dropbox, Syncthing, git nebo flashka fungují úplně stejně dobře. Je to složka.

### Zálohy

Trezor je složka textových souborů, takže si s ním poradí každý zálohovací
nástroj.

```bash
# Kopie s datem
cp -r ~/Documents/Reader_MJ ~/Zalohy/Reader_MJ-$(date +%F)

# Nebo přímo z aplikace:
#   Paleta příkazů -> „Exportovat trezor do složky...“
```

Historie verzí přes git funguje dobře, Markdown se diffuje čistě:

```bash
cd ~/Documents/Reader_MJ
git init && printf '.reader_mj/\n' > .gitignore
git add -A && git commit -m "poznamky"
```

Time Machine, Backblaze a spol. nepotřebují žádné nastavení. **Nezálohuj
`.reader_mj/index.sqlite`** — generuje se znovu a `Přestavět vyhledávací
rejstřík` ho postaví za milisekundy.

Obnova: zkopíruj složku zpátky. To je celý postup.

---

## Nastavení

Všechno nastavení žije v `.env` (mimo git; `.env.example` je v repozitáři):

| Proměnná | Výchozí | Význam |
| --- | --- | --- |
| `READER_MJ_VAULT_PATH` | složka Dokumenty podle systému | Kde jsou poznámky |
| `READER_MJ_DEV_PORT` | `5273` | Port vývojového serveru Vite |
| `READER_MJ_DAILY_FOLDER` | `daily` | Podsložka pro denní poznámky |
| `RUST_LOG` | `info` | Podrobnost logování |
| `READER_MJ_AUTO_UPDATE` | `1` | Kontrola aktualizací po startu |
| `TAURI_SIGNING_PRIVATE_KEY` | prázdné | Podpis aktualizací, jen při vydávání |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | prázdné | Heslo k tomu klíči |

**K tajemstvím:** Reader_MJ nemá účty, takže k jeho používání není potřeba
nastavit vůbec nic. Jediný přístupový údaj v projektu je soukromý klíč, kterým
se podepisují aktualizace, a ten potřebuješ jen když novou verzi vydáváš.
Bydlí v `.env` a v secrets repozitáře. `.env` je
v `.gitignore`; `.env.example` obsahuje jen zástupné klíče a **žádný přístupový
údaj se nikdy nekomituje**.

---

## Testy

```bash
npm test
```

Spustí čtyři fáze a vypíše souhrn. Pokračuje i po chybě, takže jeden příkaz
nahlásí všechno, co je rozbité:

1. **Typy TypeScriptu** — `tsc --noEmit`
2. **Vrstva trezoru v Rustu** — `cargo test -p reader-mj-core`: procházení
   cest, atomické zápisy, detekce konfliktů, export/import, rejstřík SQLite,
   řazení přes FTS5, zpětné odkazy, projití složky (prořezávání, pořadí,
   limity), registr přístupů, který rozhoduje, co se vůbec smí číst, a ukládání
   skupin
3. **Jádro** — `vitest run`: obousměrný převod frontmatteru, vytahování štítků
   a odkazů `[[...]]`, renderer Markdownu a jeho escapování, bezpečné názvy
   souborů, rozbor vyhledávacích dotazů, diff, SHA-256, zplošťování stromu
   souborů, rozbalování a sbalování, filtrování, operace nad skupinami,
   přechody mezi režimy zobrazení a celý český katalog textů včetně tvarů
   množného čísla
4. **End-to-end** — `vitest run --config vitest.e2e.config.ts`: průchod
   poznámkami, strom souborů, skupiny a aktualizace

Jednotlivé fáze: `npm test -- rust`, `npm test -- unit`, `npm test -- e2e`.

End-to-end sady řídí skutečnou `<App />` přes DOM — stejné komponenty, reducer
i obsluhu klávesnice, jaké běží v desktopové aplikaci — nad paměťovým trezorem.

`happy-path` projde poznámkovou část na jeden zátah: vytvoří poznámku, napíše
Markdown se štítkem a odkazem, ověří vykreslení, projde odkazem, přečte zpětný
odkaz, najde poznámku hledáním, přejmenuje ji a sleduje, jak ji příchozí odkazy
následují, narazí na konflikt a exportuje.

`explorer` projde čtečku: otevře složku, rozbalí a sbalí její složky, rozbalí
a sbalí všechno, filtruje sdíleným vyhledávacím polem, otevře soubor ze stromu,
ověří vykreslení a označení „externí soubor“, uloží ho zpátky a dokáže, že se
nepřidal frontmatter, narazí na konflikt v externím souboru a složí sekci přes
`Ctrl` `B`.

`groups` projde levý panel: vytvoří skupinu, propojí do ní poznámku z trezoru
a soubor z jiné složky, otevře jeden ze skupiny se zavřenou složkou, odebere
odkaz bez zásahu do souboru, smaže poznámku a soubor z kontextového menu,
projede přepínačem zobrazení všechny tři polohy myší, klávesnicí i zkratkou
a schová a zase zobrazí panel.

`updates` projde aktualizace: kontrola po startu najde novou verzi, stáhne ji
bez ptaní a nabídne restart; starší ani nečitelnou verzi nenainstaluje, ať
server tvrdí cokoli; bez sítě mlčí a aplikace jede dál; ruční kontrola hlásí
„máš nejnovější verzi“; rozepsaná poznámka se uloží dřív, než instalátor zavře
okno. Ověření podpisu dělá plugin Tauri a v testu ho zastoupit nejde — to je
místo, kde je jedinou pojistkou soukromý klíč mimo repozitář.

Souborový systém pod všemi čtyřmi pokrývá sada v Rustu.

Obě implementace SHA-256 (TypeScript pro editor, Rust pro souborovou vrstvu)
se testují proti stejným zveřejněným vektorům, protože detekce konfliktů
porovnává jednu proti druhé.

---

## Záměrně chybí

Ne „přijde později“ — vědomě zavrženo, protože každá z těch věcí by nahlodala
předpoklad, že tvoje poznámky jsou jen soubory na tvém disku:

- **Vlastní synchronizační server.** Synchronizace je práce tvého nástroje na
  synchronizaci souborů. Reader_MJ by tvoje poznámky musel hostovat, zabezpečit
  a nakonec i zpeněžit.
- **Dokumenty pro víc lidí v reálném čase.** Stav CRDT by se stal druhým
  zdrojem pravdy, který obyčejný soubor `.md` neumí vyjádřit.
- **Tržiště s pluginy.** Prostor pro oprávnění a riziko v dodavatelském řetězci
  u osobního poznámkovníku.
- **Hostované veřejné stránky a publikování.** To je práce generátoru statických
  webů; trezor už je jeho vstup.
- **Účty, placení, telemetrie, analytika, hostovaný řídicí panel.** Jediný
  síťový požadavek, který Reader_MJ udělá, je dotaz na GitHub, jestli vyšla
  novější verze. Neposílá při něm nic o tobě ani o tvých poznámkách a vypíná se
  jedním řádkem v `.env`.

---

## Licence

MIT — viz [LICENSE](LICENSE).
