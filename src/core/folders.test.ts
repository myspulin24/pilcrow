import { describe, expect, it } from 'vitest'

import {
  activeAfterClose,
  activeFolder,
  emptyFolder,
  folderLabel,
  folderOf,
  folderSectionKey,
  foldersToRemember,
  foldersToRestore,
  patchFolder,
  sameFolder,
  withFolder,
  withoutFolder,
} from './folders'

const folder = (rootPath: string) => emptyFolder(rootPath)

describe('sameFolder', () => {
  it('nevidí rozdíl mezi lomítky ani ve velikosti písmen na Windows', () => {
    expect(sameFolder('C:\\Users\\micha\\dev', 'c:/users/micha/dev')).toBe(true)
    expect(sameFolder('C:\\Users\\micha\\dev\\', 'C:\\Users\\micha\\dev')).toBe(true)
  })

  it('na unixové cestě na velikosti písmen záleží', () => {
    expect(sameFolder('/home/micha/dev', '/home/Micha/dev')).toBe(false)
    expect(sameFolder('/home/micha/dev/', '/home/micha/dev')).toBe(true)
  })

  it('různé složky zůstanou různé', () => {
    expect(sameFolder('C:\\dev\\a', 'C:\\dev\\b')).toBe(false)
    // Prefix není totéž co shoda.
    expect(sameFolder('C:\\dev\\ab', 'C:\\dev\\a')).toBe(false)
  })
})

describe('otevřené složky', () => {
  it('nová složka jde na konec seznamu', () => {
    const folders = withFolder([folder('C:\\a')], folder('C:\\b'))
    expect(folders.map((item) => item.rootPath)).toEqual(['C:\\a', 'C:\\b'])
  })

  it('otevřít tutéž složku podruhé ji nahradí, nepřidá', () => {
    const first = { ...folder('C:\\a'), fileCount: 3 }
    const again = { ...folder('c:/a'), fileCount: 9 }
    const folders = withFolder([first, folder('C:\\b')], again)

    expect(folders).toHaveLength(2)
    expect(folders[0]?.fileCount).toBe(9)
    // Pořadí zůstává: složka nepřeskočí na konec, jen se načte znovu.
    expect(folders.map((item) => item.rootPath)).toEqual(['c:/a', 'C:\\b'])
  })

  it('změna jedné složky nechá ostatní být', () => {
    const folders = patchFolder([folder('C:\\a'), folder('C:\\b')], 'C:\\b', { loading: true })
    expect(folders[0]?.loading).toBe(false)
    expect(folders[1]?.loading).toBe(true)
  })

  it('změna neznámé složky nic nerozbije', () => {
    const folders = [folder('C:\\a')]
    expect(patchFolder(folders, 'C:\\jinde', { loading: true })).toEqual(folders)
  })

  it('zavření vyhodí právě jednu', () => {
    const folders = withoutFolder([folder('C:\\a'), folder('C:\\b')], 'c:/a')
    expect(folders.map((item) => item.rootPath)).toEqual(['C:\\b'])
  })
})

describe('aktivní složka', () => {
  it('bez aktivní cesty není aktivní složka', () => {
    expect(activeFolder([folder('C:\\a')], null)).toBeNull()
  })

  it('aktivní cesta, která už otevřená není, nevrátí nic', () => {
    expect(activeFolder([folder('C:\\a')], 'C:\\b')).toBeNull()
  })

  it('po zavření aktivní složky přebírá soused', () => {
    const folders = [folder('C:\\a'), folder('C:\\b'), folder('C:\\c')]
    expect(activeAfterClose(folders, 'C:\\b', 'C:\\b')).toBe('C:\\c')
  })

  it('po zavření poslední aktivní složky přebírá ta před ní', () => {
    const folders = [folder('C:\\a'), folder('C:\\b')]
    expect(activeAfterClose(folders, 'C:\\b', 'C:\\b')).toBe('C:\\a')
  })

  it('zavření jiné než aktivní složky aktivní nemění', () => {
    const folders = [folder('C:\\a'), folder('C:\\b')]
    expect(activeAfterClose(folders, 'C:\\a', 'C:\\b')).toBe('C:\\b')
  })

  it('zavření poslední složky nechá sloupec bez aktivní', () => {
    expect(activeAfterClose([folder('C:\\a')], 'C:\\a', 'C:\\a')).toBeNull()
  })
})

describe('do které složky soubor patří', () => {
  const folders = [folder('C:\\dev\\repo'), folder('C:\\dev\\repo\\docs'), folder('C:\\jine')]

  it('vyhrává nejdelší shoda, ne pořadí otevření', () => {
    expect(folderOf(folders, 'C:\\dev\\repo\\docs\\a.md')?.rootPath).toBe('C:\\dev\\repo\\docs')
    expect(folderOf(folders, 'C:\\dev\\repo\\README.md')?.rootPath).toBe('C:\\dev\\repo')
  })

  it('soubor mimo všechny složky nepatří nikam', () => {
    expect(folderOf(folders, 'D:\\jinde\\a.md')).toBeNull()
  })

  it('složka se jménem, které je předponou jiné, nechytá cizí soubory', () => {
    const two = [folder('C:\\dev\\repo'), folder('C:\\dev\\repo-2')]
    expect(folderOf(two, 'C:\\dev\\repo-2\\a.md')?.rootPath).toBe('C:\\dev\\repo-2')
  })
})

describe('nastavení', () => {
  it('aktivní složka se pamatuje první', () => {
    const folders = [folder('C:\\a'), folder('C:\\b'), folder('C:\\c')]
    expect(foldersToRemember(folders, 'C:\\c')).toEqual(['C:\\c', 'C:\\a', 'C:\\b'])
  })

  it('bez aktivní složky se pořadí nemění', () => {
    expect(foldersToRemember([folder('C:\\a'), folder('C:\\b')], null)).toEqual(['C:\\a', 'C:\\b'])
  })

  it('obnovení zná i nastavení od starší verze', () => {
    expect(foldersToRestore({ lastFolder: 'C:\\a' })).toEqual(['C:\\a'])
    expect(foldersToRestore({ openFolders: ['C:\\a', 'C:\\b'], lastFolder: 'C:\\a' })).toEqual([
      'C:\\a',
      'C:\\b',
    ])
  })

  it('prázdné a duplicitní cesty se zahodí', () => {
    expect(foldersToRestore({ openFolders: ['C:\\a', '', 'c:/a', '   '], lastFolder: '' })).toEqual([
      'C:\\a',
    ])
  })

  it('bez nastavení se neotevře nic', () => {
    expect(foldersToRestore({})).toEqual([])
  })
})

describe('popisky', () => {
  it('jméno složky je poslední úsek cesty', () => {
    expect(folderLabel('C:\\Users\\micha\\dev\\pilcrow')).toBe('pilcrow')
    expect(folderLabel('/home/micha/dev/pilcrow/')).toBe('pilcrow')
  })

  it('klíč výšky nese cestu, takže se výšky složek nepletou', () => {
    expect(folderSectionKey('C:\\dev\\a')).toBe('files:C:/dev/a')
    // Tatáž složka zapsaná jinak má týž klíč -- jinak by se uložená výška
    // po restartu nenašla.
    expect(folderSectionKey('C:/dev/a/')).toBe(folderSectionKey('C:\\dev\\a'))
  })
})
