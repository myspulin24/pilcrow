/**
 * Ukázkový obsah pro paměťový trezor.
 *
 * Desktopová aplikace naplní skutečný trezor z Rustu při prvním spuštění;
 * tohle je to, co uvidíš v `npm run dev:web` a z čeho vychází end-to-end test.
 */

const CREATED = '2026-09-14T09:00:00.000Z'

function note(id: string, title: string, tags: string[], pinned: boolean, body: string): string {
  return [
    '---',
    `id: ${id}`,
    `title: ${title}`,
    `created: ${CREATED}`,
    `updated: ${CREATED}`,
    `pinned: ${pinned}`,
    `tags: [${tags.join(', ')}]`,
    '---',
    '',
    body,
    '',
  ].join('\n')
}

export const SEED_NOTES: Record<string, string> = {
  'vitej.md': note(
    'seed0001welcome',
    'Vítej v Reader_MJ',
    ['reader_mj'],
    true,
    [
      '# Vítej v Reader_MJ',
      '',
      'Každá poznámka je obyčejný soubor Markdown ve složce tvého trezoru. Nic víc.',
      'Rejstřík SQLite jen zrychluje hledání — smaž ho a Reader_MJ ho postaví znovu.',
      '',
      '## Zkus si',
      '',
      '- [ ] Stiskni `Ctrl` + `K` a otevře se paleta příkazů',
      '- [ ] Napiš kamkoli `#` a přidáš štítek, třeba #reader_mj/zaciname',
      '- [x] Odkaž na jinou poznámku přes [[Tahák na Markdown]]',
      '- [ ] Otevři [[Denní poznámky]] a uvidíš, jak fungují',
      '- [ ] Stiskni `Ctrl` + `Shift` + `O` a projdi si složku v průzkumníku',
      '',
      '> Zpětné odkazy se pod každou poznámkou objeví samy.',
    ].join('\n'),
  ),

  'tahak-na-markdown.md': note(
    'seed0002cheats',
    'Tahák na Markdown',
    ['reader_mj/zaciname'],
    false,
    [
      '# Tahák na Markdown',
      '',
      'Reader_MJ vykresluje Markdown, který už znáš.',
      '',
      '| Co | Zápis |',
      '| --- | --- |',
      '| Tučně | `**tučně**` |',
      '| Úkol | `- [ ] udělat` |',
      '| Odkaz | `[[Vítej v Reader_MJ]]` |',
      '| Vzorec | `$E = mc^2$` |',
      '',
      'Nic z toho se ale učit nemusíš — nad editorem je lišta a u každého',
      'tlačítka je vidět, co vloží.',
      '',
      '## Vzorce',
      '',
      'Stiskni `Ctrl` + `M` a naklikej si vzorec z palety:',
      '',
      '$$',
      String.raw`c_{right} = \frac{3^k}{2^n}\left(c_{min} + B_{přímý}\right)`,
      '$$',
      '',
      '```ts',
      'const odpoved: number = 42',
      'console.log(`ahoj ${odpoved}`)',
      '```',
      '',
      'Obrázky žijí ve složce `attachments/` a odkazuje se na ně běžnou relativní cestou.',
    ].join('\n'),
  ),

  'denni-poznamky.md': note(
    'seed0003dailies',
    'Denní poznámky',
    ['reader_mj/zaciname'],
    false,
    [
      '# Denní poznámky',
      '',
      'Stiskni `Ctrl` + `D` a Reader_MJ otevře dnešní poznámku. Když ještě není, vytvoří ji.',
      'Denní poznámky jsou obyčejné soubory ve složce `daily/` s názvem `RRRR-MM-DD.md`.',
      '',
      'Viz taky [[Vítej v Reader_MJ]].',
    ].join('\n'),
  ),
}
