# Změny

Co v které verzi přibylo nebo se opravilo.

Tenhle soubor není jen kronika: **sekce k dané verzi se stane textem vydání
a zobrazí se v okně „Co je nového“**, když aplikace nabídne aktualizaci.
Vydání bez záznamu tady se nesestaví — hlídá to workflow, aby se nestalo, že
uživateli vyskočí okno s prázdnou kolonkou.

Píše se pro toho, kdo aplikaci používá, ne pro toho, kdo ji píše: co se změní
na obrazovce, ne které soubory se upravily. Nejnovější verze je nahoře.

## 0.7.0 — nevydáno

### Přidáno

- **Sekce Git** v levém sloupci, u složky, která leží v repozitáři. Ukáže
  změněné soubory .md, předvybere ty, které jsi upravil v Pilcrow, a
  tlačítkem **Odeslat do gitu…** je pošle v novém commitu na novou větev.
  Do hlavní větve se nesahá — PR založíš na GitHubu tlačítkem **Otevřít PR**.
- **Průběh běhu Actions** hned po pushi: úlohy a jejich kroky se jmény
  a stavem, jak přibývají. Sleduje se běh pro *tvůj* commit, ne poslední
  v repu, a než se objeví, sekce poctivě říká, že čeká.
- **Přihlášení k GitHubu** přímo v sekci přes GitHub CLI: ukáže se
  jednorázový kód, zbytek proběhne v prohlížeči. Pilcrow žádný token nevidí
  ani neukládá.

### Co se nemění

- Z GitHubu se jen čte. Běhy se nespouštějí a workflow se nemění.
- Do commitu jde jen to, co máš zaškrtnuté. Cizí rozdělaná práce v repu se
  ukáže, ale sama se nevybere.
- Vyžaduje `git`; pro běhy a PR i GitHub CLI (`gh`). Bez `gh` funguje commit
  a push a sekce řekne, co chybí.

## 0.6.3 — 2026-09-19

### Přidáno

- **Přesunout do poznámek** v pravém tlačítku na soubor ve stromu. Soubor se
  přesune do trezoru a stane se z něj běžná poznámka — na původním místě už
  nezůstane. Když se jméno v poznámkách už používá, přidá se číslo; nic se
  nepřepíše. Chceš-li soubor nechat, kde je, a jen se na něj odkázat, je na to
  pořád „Přidat do skupiny“.

### Změněno

- **Otevřená složka i soubor zůstanou otevřené i po zavření aplikace.** Panel
  Soubory dosud po každém startu začínal prázdný. Cesta, která mezitím zmizela
  nebo na tomhle počítači nikdy nebyla, se tiše přeskočí.

## 0.6.2 — 2026-09-19

### Přidáno

- Okno aktualizace ukazuje, co je v nové verzi nového. Dosud tam stálo
  „K téhle verzi nejsou žádné poznámky“, protože se text vydání do aplikace
  vůbec nedostal.

### Změněno

- Datum vydání v okně aktualizace je česky a v místním čase
  (`19. 9. 2026 v 9:45`) místo strojového `2026-09-19T07:45:16.633Z`.

## 0.6.1

### Opraveno

- **macOS:** aplikace se při každém spuštění znovu ptala na přístup ke složce
  Dokumenty a odpověď „Povolit“ si nepamatovala. Balíček nebyl podepsaný,
  takže si systém nedokázal udržet její identitu a udělené oprávnění pokaždé
  zahodil. Projeví se to až po aktualizaci na tuhle verzi.

## 0.6.0

### Přidáno

- **Nastavení** ve stavovém řádku nebo pod `Ctrl` `,`: motiv, velikost písma
  v editoru, výchozí zobrazení po otevření poznámky, levý panel, lišta
  formátování, složka denních poznámek a kontrola aktualizací.
- **O aplikaci** na konci nastavení — verze všeho, na čem aplikace stojí,
  od Reactu po WebView2, a tlačítko, které to zkopíruje jako text k hlášení
  chyby.
- **Tlačítko na zkopírování** u každého bloku kódu v náhledu i v odpovědích
  Clauda. Do schránky jde jen kód, bez popisku jazyka.

### Opraveno

- **Motiv se konečně řídí nastavením.** Volba se ukládala, ale nikdy se
  nepoužila, takže se vzhled řídil systémem bez ohledu na ni.
- **Zaškrtávátko v náhledu** přepíše zdroj poznámky a uloží ji. Dosud kliknutí
  neudělalo nic.
- **„Neuložené změny“** v záhlaví už nezůstávají svítit po uložení. Ukládalo se
  správně, jen o tom hláška lhala.

## 0.5.0

### Změněno

- **Reader_MJ se jmenuje Pilcrow** — podle ¶, typografické značky odstavce,
  která je i v novém logu. Přejmenovala se aplikace, složka s poznámkami
  (`Dokumenty\Pilcrow`) i její vnitřní složka.
- Aktualizace odstraní předchozí instalaci pod starým názvem, takže na
  počítači nezůstanou dvě aplikace vedle sebe.

## 0.4.1

### Přidáno

- Instalátory i aplikace jsou podepsané jménem **Michal Jašek** a nesou
  copyright. Certifikát je vlastnoručně podepsaný, takže varování
  „Neznámý vydavatel“ při instalaci zůstává.

### Změněno

- Předvyplněné texty v dialozích říkají, co se má napsat („Název skupiny“),
  místo ukázkové hodnoty, která vypadala jako předvyplněný obsah.

## 0.4.0

### Přidáno

- **Asistent Claude**: panel, ve kterém se dá zeptat na otevřenou poznámku.
  Je vypnutý, dokud ho vědomě nezapneš, protože text poznámky odchází
  z počítače. Mluví přes Claude Code, takže Pilcrow nevidí žádné přihlašovací
  údaje.

## 0.3.1

### Opraveno

- Náhled vyplní okno stejně jako zbylé dva režimy zobrazení.

## 0.3.0

### Přidáno

- **Třináct zápisů matematiky** — TeX, LaTeX, AMS-LaTeX, ConTeXt, MathML,
  AsciiMath, UnicodeMath, OMML, Typst, eqn, Wolfram, MathJSON a texvc —
  s výběrem jazyka a živým náhledem v editoru vzorců.

## 0.2.2

### Opraveno

- Escapované složené závorky ve vzorci (`\{`, `\}`) dojdou až k sázeči místo
  toho, aby se cestou ztratily.

## 0.2.1

### Opraveno

- Kurzor se po kliknutí v liště formátování vrací na správné místo. Dřív to
  byl závod s překreslením a na rychlejším stroji dopadal jinak než na
  pomalejším.

## 0.2.0

### Přidáno

- **Lišta formátování** nad editorem s náhledem u každého tlačítka, takže
  Markdown se nemusí umět.
- **Editor matematických vzorců** s paletou značek a živým náhledem.

## 0.1.1

### Opraveno

- Aktualizace na Windows se instaluje přes NSIS, ne přes MSI, takže přepíše
  stávající instalaci místo aby postavila druhou vedle ní.

## 0.1.0

První vydání. Čtečka Markdownu a poznámkovník nad obyčejnými soubory `.md`:
štítky, odkazy `[[...]]`, zpětné odkazy, fulltextové hledání, denní poznámky,
průzkumník souborů, skupiny a paleta příkazů. Celé česky, celé u tebe
v počítači.
