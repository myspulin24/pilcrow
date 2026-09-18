# Bezpečnost

## Jak nahlásit chybu

**Nezakládej veřejný issue.** U bezpečnostní chyby by to znamenalo zveřejnit ji
dřív, než je co nainstalovat.

Použij [soukromé hlášení zranitelnosti](https://github.com/myspulin24/pilcrow/security/advisories/new).
Je to zabudované v GitHubu, vidí to jen správce repozitáře a nemusíš k tomu
nikam psát e-mail.

Pomůže, když přiložíš:

- verzi z **Nastavení → O aplikaci** (tlačítko *Kopírovat jako text* vypíše
  i verze Tauri, Rustu a WebView2),
- co se má stát a co se stane,
- pokud jde o zpracování souboru, tak i ten soubor — stačí zmenšený.

## Co čekat

Pilcrow dělá jeden člověk ve volném čase. Žádné lhůty na odpověď tu proto
slibovat nebudu; místo toho platí, co se dodržet dá:

- Opravuje se **jen poslední vydaná verze.** Starší se nezáplatují, aktualizace
  na novou je v aplikaci na jedno kliknutí.
- Oprava vyjde jako běžné vydání a v poznámkách k němu bude napsané, čeho se
  týká.
- Kdo chybu nahlásí, bude u toho uvedený, pokud si to nebude přát jinak.

## Kde se dá něco najít

Pilcrow běží celý na tvém počítači, takže tu není server, na který by šlo
zaútočit. Zajímavá místa jsou tahle:

| Kde | Proč to stojí za pozornost |
| --- | --- |
| **Ověřování aktualizací** | Balíček se ověřuje podpisem minisign proti klíči zapečenému v `tauri.conf.json`. Kdyby se dal obejít, dala by se podstrčit „aktualizace“ |
| **Vykreslování Markdownu** | `src/core/markdown.ts` escapuje text a kontroluje schéma každé adresy. Poznámka je cizí vstup — obzvlášť ta, kterou ti někdo poslal |
| **Cesty v trezoru** | `src-tauri/crates/pilcrow-core/src/paths.rs` hlídá, aby se nedalo vylézt ze složky trezoru |
| **Asistent** | `src-tauri/src/assistant.rs` spouští `claude` s pevně danými argumenty. Kdyby šlo do těch argumentů něco propašovat, je to nález |
| **Instalátor** | `src-tauri/nsis/upgrade.nsh` ukončuje proces a spouští odinstalátor předchozí verze |

## Co chybou není

Tyhle věci jsou známé, zamýšlené a popsané v [README](README.md) — hlásit je
nemusíš:

- **„Neznámý vydavatel“ při instalaci.** Podpisový certifikát je vlastnoručně
  podepsaný; cizím Windows nedokáže nic a varování zůstává. Viz
  [Podpis kódu](README.md#podpis-kódu).
- **Asistent posílá text poznámky Anthropicu.** Přesně to dělá, když si ho
  zapneš, a stojí to nad ním dřív, než se dá zapnout. Vypnutý je z počítače
  neodesílá.
- **Kontrola aktualizací sahá na GitHub.** Jediné spojení, které Pilcrow
  navazuje sám; vypíná se v nastavení nebo `PILCROW_AUTO_UPDATE=0`.
- **Aplikace čte a zapisuje soubory, které jí otevřeš.** To je její práce.
  Čte jen to, co jsi vybral v systémovém dialogu nebo pustil na okno.
