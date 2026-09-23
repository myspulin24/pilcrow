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
    'Vítej v Pilcrow',
    ['pilcrow'],
    true,
    [
      '# Vítej v Pilcrow',
      '',
      'Každá poznámka je obyčejný soubor Markdown ve složce tvého trezoru. Nic víc.',
      'Rejstřík SQLite jen zrychluje hledání — smaž ho a Pilcrow ho postaví znovu.',
      '',
      '## Zkus si',
      '',
      '- [ ] Stiskni `Ctrl` + `K` a otevře se paleta příkazů',
      '- [ ] Napiš kamkoli `#` a přidáš štítek, třeba #pilcrow/zaciname',
      '- [x] Odkaž na jinou poznámku přes [[Tahák na Markdown]]',
      '- [ ] Stiskni `Ctrl` + `Shift` + `O` a projdi si složku v průzkumníku',
      '- [ ] Klikni pravým na soubor v repozitáři a dej ho mezi poznámky',
      '',
      '> Zpětné odkazy se pod každou poznámkou objeví samy.',
    ].join('\n'),
  ),

  'tahak-na-markdown.md': note(
    'seed0002cheats',
    'Tahák na Markdown',
    ['pilcrow/zaciname'],
    false,
    [
      '# Tahák na Markdown',
      '',
      'Pilcrow vykresluje Markdown, který už znáš.',
      '',
      '| Co | Zápis |',
      '| --- | --- |',
      '| Tučně | `**tučně**` |',
      '| Úkol | `- [ ] udělat` |',
      '| Odkaz | `[[Vítej v Pilcrow]]` |',
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

  'skupiny.md': note(
    'seed0003groups',
    'Skupiny',
    ['pilcrow/zaciname'],
    false,
    [
      '# Skupiny',
      '',
      'Skupina je pojmenovaný seznam souborů, které si do ní přidáš sám. Můžou ležet',
      'kdekoli v počítači — jeden v trezoru, druhý ve složce projektu — a skupina je',
      'způsob, jak se k nim vrátit, aniž bys je hledal.',
      '',
      'Přidávají se pravým tlačítkem na poznámku nebo soubor.',
      '',
      'Viz taky [[Vítej v Pilcrow]].',
    ].join('\n'),
  ),
}
