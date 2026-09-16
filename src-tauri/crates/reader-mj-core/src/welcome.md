---
id: 00000000welcome
title: Vítej v Reader_MJ
created: 2026-01-01T00:00:00.000Z
updated: 2026-01-01T00:00:00.000Z
pinned: true
tags: [reader_mj]
---

# Vítej v Reader_MJ

Tenhle soubor je obyčejný Markdown ve složce tvého trezoru. Stejně tak každá
další poznámka. Žádná databáze, žádný účet, nic neodchází z tohohle počítače.
Soubor `.reader_mj/index.sqlite` vedle poznámek jen zrychluje hledání a můžeš
ho kdykoli smazat — Reader_MJ ho znovu postaví ze souborů.

## Co stojí za to znát

- [ ] `Ctrl` + `K` otevře paletu příkazů. Všechno je v ní.
- [ ] Napsáním `#` kamkoli přidáš štítek. Štítky se dají zanořovat: #reader_mj/zaciname
- [ ] Napsáním `[[` odkážeš na jinou poznámku. Když odkaz otevřeš a poznámka
      neexistuje, vytvoří se.
- [ ] `Ctrl` + `D` otevře dnešní poznámku ve složce `daily/`.
- [ ] `Ctrl` + `E` přepíná zobrazení: zdroj → obojí → náhled.

## Skupiny

Vlevo si vytvoř **skupinu** a propoj do ní soubory odkudkoli z počítače —
poznámku z trezoru, `README` z projektu, specifikaci z jiného disku. Nic se
nekopíruje ani nepřesouvá, skupina je jen seznam odkazů.

Přidáš je pravým tlačítkem na poznámku nebo soubor → **Přidat do skupiny**.

## Průzkumník souborů

Prostřední sloupec pod hledáním umí číst Markdown, který v trezoru není:

- [ ] `Ctrl` + `O` otevře jeden soubor `.md`.
- [ ] `Ctrl` + `Shift` + `O` otevře celou složku jako strom.

Můžeš taky prostě přetáhnout soubory nebo složku z Průzkumníka na okno.

Soubory otevřené takhle si Reader_MJ **nepřivlastňuje**. Ukáže je přesně tak,
jak jsou, a když je upravíš, uloží je bajt po bajtu zpátky — nikdy do cizího
souboru nepřidá frontmatter, id ani záznam do rejstříku.

## Zpětné odkazy

Co na tuhle poznámku odkazuje, se objeví dole v okně i s větou, ve které to
bylo zmíněné. Když poznámku přejmenuješ, každý odkaz `[[...]]` se přepíše sám.

## Synchronizace na zařízení Apple

Reader_MJ záměrně nemá žádný synchronizační server. Dej trezor do iCloud Drive
a složka se synchronizuje jako kterákoli jiná:

```
~/Library/Mobile Documents/com~apple~CloudDocs/Reader_MJ
```

Nastav `READER_MJ_VAULT_PATH` v souboru `.env` na tuhle cestu a poznámky uvidíš
v aplikaci Soubory na iPhonu i iPadu, upravíš je v jakémkoli iOS editoru
Markdownu a za chvíli jsou zpátky na Macu. Když stejnou poznámku upraví dvě
zařízení naráz, Reader_MJ ti ukáže obě verze vedle sebe a nikdy nerozhodne za
tebe.

## Jak poznámky dostat ven

`Exportovat trezor do složky...` v paletě příkazů zkopíruje každou poznámku
i přílohu do obyčejné složky. Není z čeho utíkat — je to pořád ten samý
Markdown, který píšeš celou dobu.
