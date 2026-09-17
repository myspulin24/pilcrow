/**
 * Všechny texty, které uživatel uvidí.
 *
 * Jedno místo místo rozsypaných řetězců po komponentách: překlad se dá přečíst
 * a zkontrolovat celý najednou, a logika zůstane oddělená od formulací.
 *
 * Čeština potřebuje tři tvary množného čísla, ne dva, takže počty se skládají
 * přes `plural()` — viz níže.
 */

/**
 * Český tvar podle počtu.
 *
 * 1 → jednotné číslo, 2–4 → množné "málo", 0 a 5+ → množné "hodně".
 * (Jazyky s jinými pravidly by tuhle funkci nahradily; tahle je záměrně malá
 * a otestovaná, ne obecná knihovna.)
 */
export function plural(count: number, one: string, few: string, many: string): string {
  const n = Math.abs(Math.trunc(count))
  if (n === 1) return one
  if (n >= 2 && n <= 4) return few
  return many
}

/** Počet a k němu správný tvar, například `3 poznámky`. */
export function withCount(count: number, one: string, few: string, many: string): string {
  return `${count} ${plural(count, one, few, many)}`
}

export const t = {
  app: {
    name: 'Reader_MJ',
    opening: 'Otevírám trezor',
    failedTitle: 'Trezor se nepodařilo otevřít',
    failedHint:
      'Zkontroluj, že READER_MJ_VAULT_PATH v souboru .env ukazuje na složku, do které se dá zapisovat, a zkus to znovu.',
    retry: 'Zkusit znovu',
    unknownError: 'Neznámá chyba.',
  },

  common: {
    cancel: 'Zrušit',
    ok: 'OK',
    create: 'Vytvořit',
    rename: 'Přejmenovat',
    delete: 'Smazat',
    open: 'Otevřít',
    close: 'Zavřít',
    dismiss: 'Zavřít',
    undo: 'Zpět',
    loading: 'Načítám',
    nameEmpty: 'Název nemůže být prázdný.',
  },

  rail: {
    label: 'Skupiny a štítky',
    hide: 'Skrýt boční panel',
    hideHint: 'Skrýt tento panel (Ctrl + \\)',
    show: 'Zobrazit boční panel',
    showHint: 'Zobrazit skupiny a štítky (Ctrl + \\)',
    allNotes: 'Všechny poznámky',
    pinned: 'Připnuté',
    today: 'Dnes',
    vault: 'Trezor',
    vaultOpening: 'Otevírám...',
    groups: 'Skupiny',
    newGroup: 'Nová skupina',
    groupsEmpty:
      'Vytvoř si skupinu a přidej do ní soubory odkudkoli z počítače. Přidáš je pravým tlačítkem na poznámku nebo soubor.',
    groupEmpty: 'Prázdná. Klikni pravým na poznámku nebo soubor a vyber „Přidat do skupiny“.',
    groupActions: (name: string) => `Akce pro skupinu ${name}`,
    tags: 'Štítky',
    tagsEmpty: 'Štítky se berou z tvých poznámek. Napiš v některé #napad.',
    collapseTag: (tag: string) => `Sbalit ${tag}`,
    expandTag: (tag: string) => `Rozbalit ${tag}`,
  },

  workspace: {
    label: 'Pracovní plocha',
    search: 'Hledat v poznámkách a souborech',
    newNote: 'Nová poznámka',
    filteredByTag: 'Filtrováno štítkem',
    clearFilter: 'Zrušit',
    notes: 'Poznámky',
    files: 'Soubory',
    openFile: 'Otevřít soubor...',
    openFolder: 'Otevřít složku...',
    openedFile: 'Otevřený soubor',
    reading: 'Čtu',
    dropHint: 'Pusť sem soubory .md nebo složku a otevřou se',
    scanning: 'Prohledávám složku',
    chooseAnother: 'Vybrat jinou složku',
    loneFileHint: 'Otevři místo toho složku, ať vidíš celý strom souborů.',
    noFileMatches: 'Žádný soubor neodpovídá hledání.',
    folderEmpty: 'V téhle složce nejsou žádné soubory .md.',
    expandAll: 'Rozbalit všechny složky',
    expandAllHint: 'Rozbalit všechny složky',
    collapseAll: 'Sbalit všechny složky',
    collapseAllHint: 'Sbalit všechny složky',
    refresh: 'Načíst složku znovu',
    refreshHint: 'Projít složku znovu',
    closeFolder: 'Zavřít složku',
    closeFolderHint: 'Zavřít tuhle složku',
    closeFileHint: 'Zavřít tenhle soubor',
    folderContents: 'Obsah složky',
    partialScan: 'neúplné',
    files_: (count: number) => withCount(count, 'soubor', 'soubory', 'souborů'),
  },

  notes: {
    list: 'Poznámky',
    searching: 'Hledám',
    noMatches: 'Žádná poznámka neodpovídá',
    noMatchesHint: 'V trezoru nic takového není.',
    empty: 'Zatím žádné poznámky',
    emptyHint: 'Trezor je prázdný. Začni první poznámkou.',
    createNamed: (name: string) => `Vytvořit „${name}“`,
    emptyNote: 'Prázdná poznámka',
    pinned: 'Připnuto',
    justNow: 'právě teď',
    minutesAgo: (n: number) => `před ${n} min`,
    hoursAgo: (n: number) => `před ${n} h`,
    daysAgo: (n: number) => `před ${withCount(n, 'dnem', 'dny', 'dny')}`,
  },

  note: {
    region: 'Poznámka',
    header: 'Hlavička poznámky',
    body: 'Text poznámky',
    preview: 'Náhled',
    nothingOpen: 'Nic není otevřené',
    nothingOpenHint: 'Vyber vlevo poznámku, nebo stiskni Ctrl + N a napiš novou.',
    externalBadge: 'externí soubor',
    words: (count: number) => withCount(count, 'slovo', 'slova', 'slov'),
    tasks: (done: number, total: number) =>
      `${done}/${total} ${plural(total, 'úkol', 'úkoly', 'úkolů')}`,
    saving: 'Ukládám...',
    unsaved: 'Neuložené změny',
    saved: 'Uloženo',
    upToDate: 'Aktuální',
    pin: 'Připnout',
    unpin: 'Odepnout',
    dropImage: 'Pusť sem obrázek a připojí se k poznámce',
  },

  view: {
    label: 'Zobrazení dokumentu',
    raw: 'Zdroj',
    rawHint: 'Jen zdrojový Markdown',
    both: 'Obojí',
    bothHint: 'Zdroj a náhled vedle sebe',
    preview: 'Náhled',
    previewHint: 'Jen vykreslený náhled',
  },

  backlinks: {
    label: 'Zpětné odkazy',
    count: (n: number) => withCount(n, 'zmínka', 'zmínky', 'zmínek'),
    empty: (title: string) => `Zatím sem nic neodkazuje. Napiš [[${title}]] v jiné poznámce.`,
    emptyFallback: 'téhle poznámky',
  },

  menu: {
    actions: 'Akce',
    open: 'Otevřít',
    addToGroup: 'Přidat do skupiny',
    newGroupDots: 'Nová skupina...',
    firstGroupDots: 'Vytvořit první skupinu...',
    renameDots: 'Přejmenovat...',
    renameHint: 'přepíše odkazy',
    renameGroupDots: 'Přejmenovat skupinu...',
    addOpenFile: 'Přidat otevřený soubor',
    deleteNote: 'Smazat poznámku',
    deleteFile: 'Smazat soubor',
    deleteFileHint: 'z disku',
    deleteGroup: 'Smazat skupinu',
    deleteGroupHint: 'soubory zůstanou',
    removeFromGroup: 'Odebrat ze skupiny',
    removeFromGroupHint: 'soubor zůstane',
    reveal: 'Ukázat ve správci souborů',
    expand: 'Rozbalit',
    collapse: 'Sbalit',
  },

  dialogs: {
    newNote: 'Nová poznámka',
    newNoteLabel: 'Název',
    newNotePlaceholder: 'Seznam ke čtení',
    newNoteInFolder: 'Nová poznámka ve složce',
    newNoteInFolderLabel: 'Složka / Název',
    newNoteInFolderPlaceholder: 'projekty/Zahájení Acme',
    renameNote: 'Přejmenovat poznámku',
    renameNoteLabel: 'Nový název',
    moveNote: 'Přesunout poznámku',
    moveNoteLabel: 'Složka (prázdné = kořen trezoru)',
    moveNotePlaceholder: 'projekty/2026',
    move: 'Přesunout',
    newGroup: 'Nová skupina',
    groupNameLabel: 'Název',
    groupNamePlaceholder: 'Bitdefender',
    createAndAdd: 'Vytvořit a přidat',
    renameGroup: 'Přejmenovat skupinu',
    deleteNoteTitle: 'Smazat poznámku',
    deleteNoteMessage: (title: string) =>
      `Smazat „${title}“? Soubor zmizí z trezoru. Po smazání se dá vrátit tlačítkem v hlášce.`,
    deleteNoteShort: (title: string) => `Smazat „${title}“? Soubor zmizí z trezoru.`,
    deleteFileTitle: 'Smazat soubor',
    deleteFileMessage: (path: string) =>
      `Smazat ${path}? Soubor zmizí z disku, ne jen z tohoto seznamu.`,
    deleteFileFromGroup: (path: string) => `Smazat ${path}? Soubor zmizí z disku.`,
    deleteGroupTitle: 'Smazat skupinu',
    deleteGroupMessage: (name: string) =>
      `Smazat skupinu „${name}“? Soubory samotné zůstanou přesně tam, kde jsou.`,
  },

  palette: {
    commands: 'Paleta příkazů',
    insertLink: 'Vložit odkaz',
    commandsPlaceholder: 'Napiš příkaz nebo název poznámky...',
    linkPlaceholder: 'Odkázat na poznámku...',
    commandsInputLabel: 'Příkaz nebo poznámka',
    linkInputLabel: 'Poznámka, na kterou odkázat',
    noMatches: 'Nic nenalezeno.',
    createNoteNamed: (term: string) => `Vytvořit poznámku „${term}“`,
    linkToNew: (term: string) => `Odkázat na novou poznámku „${term}“`,
    linkToNewHint: 'Poznámka vznikne, až odkaz poprvé otevřeš',
    groups: {
      note: 'Poznámka',
      navigate: 'Navigace',
      view: 'Zobrazení',
      vault: 'Trezor',
      explorer: 'Soubory',
      collections: 'Skupiny',
      notes: 'Poznámky',
      linkTo: 'Odkázat na',
      app: 'Aplikace',
    },
  },

  commands: {
    newNote: 'Nová poznámka',
    newNoteInFolder: 'Nová poznámka ve složce...',
    dailyNote: 'Otevřít dnešní poznámku',
    renameNote: 'Přejmenovat poznámku',
    renameNoteHint: 'Přepíše všechny odkazy [[...]] sem',
    moveNote: 'Přesunout poznámku do složky...',
    insertLink: 'Vložit odkaz na poznámku...',
    saveNow: 'Uložit hned',
    deleteNote: 'Smazat poznámku',
    openFile: 'Otevřít soubor .md...',
    openFileHint: 'Přečíst jakýkoli soubor .md v počítači',
    openFolder: 'Otevřít složku...',
    openFolderHint: 'Procházet složku s Markdownem jako strom',
    rescan: 'Načíst otevřenou složku znovu',
    expandAll: 'Rozbalit všechny složky',
    collapseAll: 'Sbalit všechny složky',
    closeFolder: 'Zavřít otevřenou složku',
    newGroup: 'Nová skupina...',
    newGroupHint: 'Propojit soubory odkudkoli do jednoho seznamu',
    search: 'Hledat v poznámkách',
    palette: 'Paleta příkazů',
    cycleView: 'Přepnout zobrazení: zdroj / obojí / náhled',
    cycleViewHint: (mode: string) => `Teď: ${mode}`,
    toggleFiles: (open: boolean) => (open ? 'Sbalit sekci Soubory' : 'Rozbalit sekci Soubory'),
    toggleNotes: (open: boolean) => (open ? 'Sbalit sekci Poznámky' : 'Rozbalit sekci Poznámky'),
    toggleRail: (visible: boolean) => (visible ? 'Skrýt boční panel' : 'Zobrazit boční panel'),
    rebuildIndex: 'Přestavět vyhledávací rejstřík',
    rebuildIndexHint: 'Přečte znovu každý soubor .md; dá se spustit kdykoli',
    exportVault: 'Exportovat trezor do složky...',
    exportVaultHint: 'Čistý Markdown a přílohy',
    importFolder: 'Importovat Markdown ze složky...',
    revealVault: 'Ukázat trezor ve správci souborů',
  },

  status: {
    noVault: 'Žádný trezor',
    substringSearch: 'jen podřetězce',
    substringSearchHint: 'SQLite je bez FTS5',
    inMemory: 'v paměti (neukládá se)',
    notes: (n: number) => withCount(n, 'poznámka', 'poznámky', 'poznámek'),
    rebuildIndex: 'Přestavět rejstřík',
    rebuildIndexHint: 'Přečíst znovu každý soubor .md a přestavět rejstřík SQLite',
    export: 'Export',
    commands: 'Příkazy',
  },

  conflict: {
    title: 'Tenhle soubor se změnil na disku',
    subtitle: (path: string) =>
      `Soubor ${path} někdo změnil mimo Reader_MJ, zatímco jsi měl neuložené úpravy. Nic se nepřepsalo.`,
    yours: 'tvoje',
    onDisk: 'na disku',
    unchanged: 'beze změny',
    differences: 'Rozdíly',
    caption: 'Řádky s minusem jsou na disku, řádky s plusem jsou tvoje neuložená verze.',
    identical: 'Obě verze jsou nakonec stejné. Vyber si kteroukoli.',
    skipped: (n: number) => `${withCount(n, 'nezměněný řádek', 'nezměněné řádky', 'nezměněných řádků')}`,
    useDisk: 'Použít verzi z disku',
    keepBoth: 'Nechat obě',
    keepMine: 'Nechat moji verzi',
  },

  toast: {
    created: (path: string) => `Vytvořeno: ${path}`,
    renamed: (title: string) => `Přejmenováno na „${title}“.`,
    renamedWithLinks: (title: string, count: number) =>
      `Přejmenováno na „${title}“ a ${plural(count, 'upravena', 'upraveny', 'upraveno')} ${withCount(
        count,
        'odkazující poznámka',
        'odkazující poznámky',
        'odkazujících poznámek',
      )}.`,
    moved: (folder: string) => `Přesunuto do ${folder}.`,
    movedToRoot: 'Přesunuto do kořene trezoru.',
    deleted: (name: string) => `Smazáno: ${name}`,
    restored: 'Obnoveno.',
    pinned: 'Připnuto.',
    unpinned: 'Odepnuto.',
    dailyCreated: 'Dnešní poznámka vytvořena.',
    loadedFromDisk: 'Načtena verze z disku.',
    keptBoth: (path: string) => `Obě verze zachovány. Tvoje je teď ${path}.`,
    keptMine: 'Tvoje verze zachována.',
    indexed: (notes: number, ms: number) =>
      `Rejstřík: ${withCount(notes, 'poznámka', 'poznámky', 'poznámek')} za ${ms} ms.`,
    indexedNoFts: (notes: number, ms: number) =>
      `Rejstřík: ${withCount(
        notes,
        'poznámka',
        'poznámky',
        'poznámek',
      )} za ${ms} ms (FTS5 chybí, hledá se podřetězcem).`,
    exported: (files: number, destination: string) =>
      `Exportováno ${withCount(files, 'soubor', 'soubory', 'souborů')} do ${destination}`,
    imported: (imported: number, skipped: number) =>
      `Naimportováno ${withCount(imported, 'soubor', 'soubory', 'souborů')}` +
      (skipped > 0 ? `, ${skipped} přeskočeno.` : '.'),
    attached: (path: string) => `Připojeno: ${path}`,
    groupCreated: (name: string) => `Skupina „${name}“ vytvořena.`,
    groupCreatedWithFile: (name: string) => `Skupina „${name}“ vytvořena a soubor přidán.`,
    groupDeleted: (name: string) => `Skupina „${name}“ smazána. Soubory zůstaly nedotčené.`,
    addedToGroup: (name: string) => `Přidáno do skupiny „${name}“.`,
    alreadyInGroup: (name: string) => `Už je ve skupině „${name}“.`,
    emptyFolder: 'V téhle složce nejsou žádné soubory .md.',
    truncatedScan: (files: number) =>
      `Zobrazeno ${withCount(files, 'soubor', 'soubory', 'souborů')}. Složka je moc velká na úplné projití.`,
    notMarkdown: 'To není soubor .md ani složka.',
    noneUsable: (n: number) =>
      `Ani ${withCount(n, 'jedna položka', 'jedny položky', 'jedna z položek')} není soubor .md ani složka.`,
    deletedOutside: (path: string) =>
      `Soubor ${path} byl smazán mimo Reader_MJ. Tvůj neuložený text tu pořád je.`,
    changedButUnreadable: (path: string) =>
      `Soubor ${path} se změnil na disku, ale nejde ho znovu načíst.`,
    attachmentsVaultOnly: 'Přílohy fungují jen u poznámek v trezoru.',
  },

  errors: {
    save: 'Poznámku se nepodařilo uložit.',
    saveFile: 'Soubor se nepodařilo uložit.',
    create: 'Poznámku se nepodařilo vytvořit.',
    rename: 'Poznámku se nepodařilo přejmenovat.',
    move: 'Poznámku se nepodařilo přesunout.',
    remove: 'Poznámku se nepodařilo smazat.',
    restore: 'Poznámku se nepodařilo obnovit.',
    pin: 'Připnutí se nepodařilo změnit.',
    open: (path: string) => `Nepodařilo se otevřít ${path}.`,
    openLink: 'Odkaz se nepodařilo otevřít.',
    openDaily: 'Dnešní poznámku se nepodařilo otevřít.',
    openFile: 'Soubor se nepodařilo otevřít.',
    openFolder: 'Složku se nepodařilo otevřít.',
    readFolder: (path: string) => `Složku ${path} se nepodařilo přečíst.`,
    folderTitle: 'Složku se nepodařilo přečíst',
    conflict: 'Konflikt se nepodařilo vyřešit.',
    rebuild: 'Rejstřík se nepodařilo přestavět.',
    export: 'Export se nepodařil.',
    import: 'Import se nepodařil.',
    attach: 'Soubor se nepodařilo připojit.',
    search: 'Hledání selhalo.',
    deleteFile: 'Soubor se nepodařilo smazat.',
    saveGroups: 'Skupiny se nepodařilo uložit.',
    drop: 'To, co jsi pustil, se nepodařilo otevřít.',
    generic: 'Trezor vrátil neočekávanou chybu.',
    openVault: 'Trezor se nepodařilo otevřít.',
    nameUnusable: 'Tenhle název nejde použít.',
  },

  names: {
    empty: 'Název nemůže být prázdný.',
    tooLong: (max: number) => `Název musí mít nejvýš ${max} znaků.`,
    noUsableChars: 'Název neobsahuje žádné použitelné znaky.',
    sanitised: (safe: string) =>
      `Uloží se jako „${safe}“ — některé znaky se v názvech souborů používat nedají.`,
    groupEmpty: 'Pojmenuj skupinu.',
    groupTooLong: (max: number) => `Nech to na ${max} znacích nebo méně.`,
    groupDuplicate: (name: string) => `Skupinu „${name}“ už máš.`,
  },

  markdown: {
    missingNote: (target: string) => `${target} (poznámka zatím neexistuje)`,
  },

  toolbar: {
    label: 'Formátování',
    show: 'Zobrazit lištu formátování',
    hide: 'Skrýt lištu formátování',
    preview: 'Takhle to bude vypadat',
    inserts: 'Vloží',
    groups: {
      text: 'Písmo',
      headings: 'Nadpisy',
      lists: 'Seznamy',
      blocks: 'Bloky',
      links: 'Odkazy',
      math: 'Vzorce',
    },
    bold: 'Tučně',
    italic: 'Kurzíva',
    strike: 'Přeškrtnuté',
    highlight: 'Zvýrazněné',
    code: 'Kód v řádku',
    h1: 'Nadpis 1',
    h2: 'Nadpis 2',
    h3: 'Nadpis 3',
    ul: 'Odrážky',
    ol: 'Číslovaný seznam',
    task: 'Úkol se zaškrtávátkem',
    quote: 'Citace',
    codeblock: 'Blok kódu',
    table: 'Tabulka',
    rule: 'Vodorovná čára',
    link: 'Odkaz na web',
    wikilink: 'Odkaz na poznámku',
    image: 'Obrázek',
    mathInline: 'Vzorec v řádku',
    mathBlock: 'Vzorec na samostatném řádku',
    mathEditor: 'Editor vzorců...',
  },

  math: {
    title: 'Vzorec',
    editorLabel: 'Zápis vzorce',
    placeholder: 'c_{right} = \\frac{3^k}{2^n}',
    preview: 'Náhled',
    previewEmpty: 'Napiš vzorec nebo klikni na značku níž.',
    palette: 'Značky',
    display: 'Na samostatném řádku',
    displayHint: 'Vzorec bude vycentrovaný na vlastním řádku, ne v textu',
    insert: 'Vložit vzorec',
    save: 'Uložit změny',
    help: 'Co nevíš, naklikej z palety. Paleta se mění podle zvoleného jazyka.',
    cheatsheet: 'Nápověda ke značkám',
    language: 'Jazyk',
    showLatex: 'Zobrazit jako LaTeX',
    hideLatex: 'Skrýt LaTeX',
    noPalette: 'Tenhle zápis se obvykle vkládá zkopírovaný odjinud, paletu proto nemá.',
    valid: 'Vzorec je v pořádku.',
  },

  update: {
    /** Popisek v paletě i ve stavovém řádku. */
    check: 'Zkontrolovat aktualizace',
    checkHint: 'Podívat se na GitHub, jestli vyšla novější verze',
    checking: 'Hledám aktualizace...',
    upToDate: (version: string) => `Máš nejnovější verzi (${version}).`,
    version: (version: string) => `verze ${version}`,
    dialogTitle: 'Je k dispozici nová verze',
    availableLine: (next: string, current: string) =>
      `Reader_MJ ${next} je venku. Ty máš ${current}.`,
    released: (date: string) => `Vydáno ${date}`,
    notesTitle: 'Co je nového',
    noNotes: 'K téhle verzi nejsou žádné poznámky.',
    downloading: 'Stahuji aktualizaci',
    downloadingShort: 'Stahuji aktualizaci...',
    installing: 'Instaluji...',
    installHint:
      'Instalace zavře Reader_MJ a hned ho spustí znovu. Rozepsané změny se předtím uloží.',
    installNow: 'Nainstalovat a restartovat',
    later: 'Později',
    readyTitle: 'Aktualizace je připravená',
    readyLine: (version: string) =>
      `Verze ${version} je stažená a ověřená. Zbývá restartovat.`,
    restart: 'Restartovat',
    downloadedToast: (version: string) =>
      `Verze ${version} je stažená. Nainstaluje se po restartu.`,
    failedTitle: 'Aktualizace se nepovedla',
    unavailable: 'Aktualizace fungují jen v desktopové aplikaci.',
    autoOff: 'Automatická kontrola je vypnutá (READER_MJ_AUTO_UPDATE=0).',
    errorCheck: 'Aktualizace se nepodařilo zkontrolovat.',
    errorInstall: 'Aktualizaci se nepodařilo nainstalovat.',
  },

  browser: {
    demoVault: 'Ukázkový trezor (náhled v prohlížeči)',
    warning:
      'Běží v prohlížeči bez desktopového běhového prostředí: poznámky jsou jen v paměti a po načtení stránky zmizí. Skutečnou aplikaci spustíš přes `npm start`.',
    memoryVault: 'Trezor v paměti (neukládá se na disk)',
    exportNeedsDesktop: '(paměťový režim: export potřebuje desktopovou aplikaci)',
    importNeedsDesktop: 'Import složky potřebuje desktopovou aplikaci.',
  },
} as const
