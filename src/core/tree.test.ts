import { describe, expect, it } from 'vitest'

import {
  ancestorsOf,
  buildTreeFromPaths,
  baseName,
  collectDirPaths,
  collectFilePaths,
  filterTree,
  findNode,
  firstFile,
  flattenTree,
  parentPath,
  relativePath,
  stemOf,
  stepFile,
  type TreeNode,
} from './tree'

const dir = (path: string, name: string, children: TreeNode[]): TreeNode => ({
  name,
  path,
  kind: 'dir',
  children,
})
const file = (path: string, name: string): TreeNode => ({ name, path, kind: 'file', children: [] })

/**
 *  /vault
 *    guides/
 *      deep/
 *        advanced.md
 *      intro.md
 *    empty/            (a folder with no files, kept to test collapse)
 *    README.md
 */
const TREE = dir('/vault', 'vault', [
  dir('/vault/guides', 'guides', [
    dir('/vault/guides/deep', 'deep', [file('/vault/guides/deep/advanced.md', 'advanced.md')]),
    file('/vault/guides/intro.md', 'intro.md'),
  ]),
  dir('/vault/empty', 'empty', []),
  file('/vault/README.md', 'README.md'),
])

const paths = (rows: ReturnType<typeof flattenTree>) => rows.map((row) => row.node.path)

describe('flattenTree', () => {
  it('shows only top-level rows when nothing is expanded', () => {
    expect(paths(flattenTree(TREE, new Set()))).toEqual([
      '/vault/guides',
      '/vault/empty',
      '/vault/README.md',
    ])
  })

  it('reveals a folder"s children when it is expanded', () => {
    const rows = flattenTree(TREE, new Set(['/vault/guides']))
    expect(paths(rows)).toEqual([
      '/vault/guides',
      '/vault/guides/deep',
      '/vault/guides/intro.md',
      '/vault/empty',
      '/vault/README.md',
    ])
  })

  it('nests further as deeper folders are expanded', () => {
    const rows = flattenTree(TREE, new Set(['/vault/guides', '/vault/guides/deep']))
    expect(paths(rows)).toContain('/vault/guides/deep/advanced.md')
  })

  it('reports depth so rows can be indented', () => {
    const rows = flattenTree(TREE, new Set(['/vault/guides', '/vault/guides/deep']))
    const byPath = new Map(rows.map((row) => [row.node.path, row.depth]))
    expect(byPath.get('/vault/guides')).toBe(0)
    expect(byPath.get('/vault/guides/deep')).toBe(1)
    expect(byPath.get('/vault/guides/deep/advanced.md')).toBe(2)
  })

  it('never shows the root itself -- that is the panel header', () => {
    expect(paths(flattenTree(TREE, new Set(collectDirPaths(TREE))))).not.toContain('/vault')
  })

  it('marks which rows can be expanded', () => {
    const rows = flattenTree(TREE, new Set())
    const byPath = new Map(rows.map((row) => [row.node.path, row]))
    expect(byPath.get('/vault/guides')?.hasChildren).toBe(true)
    // An empty folder has no twisty.
    expect(byPath.get('/vault/empty')?.hasChildren).toBe(false)
    expect(byPath.get('/vault/README.md')?.hasChildren).toBe(false)
  })

  it('ignores an expanded path that is not a folder', () => {
    const rows = flattenTree(TREE, new Set(['/vault/README.md']))
    expect(rows.find((row) => row.node.path === '/vault/README.md')?.expanded).toBe(false)
  })

  it('returns nothing for a missing tree', () => {
    expect(flattenTree(null, new Set())).toEqual([])
  })
})

describe('collectDirPaths / collectFilePaths', () => {
  it('lists every folder including the root', () => {
    expect(collectDirPaths(TREE)).toEqual([
      '/vault',
      '/vault/guides',
      '/vault/guides/deep',
      '/vault/empty',
    ])
  })

  it('lists every file in display order', () => {
    expect(collectFilePaths(TREE)).toEqual([
      '/vault/guides/deep/advanced.md',
      '/vault/guides/intro.md',
      '/vault/README.md',
    ])
  })

  it('handles a null tree', () => {
    expect(collectDirPaths(null)).toEqual([])
    expect(collectFilePaths(null)).toEqual([])
  })
})

describe('findNode / firstFile / ancestorsOf', () => {
  it('finds a node by path at any depth', () => {
    expect(findNode(TREE, '/vault/guides/deep/advanced.md')?.name).toBe('advanced.md')
    expect(findNode(TREE, '/vault')?.name).toBe('vault')
    expect(findNode(TREE, '/nope')).toBeNull()
  })

  it('finds the first file in display order', () => {
    expect(firstFile(TREE)?.path).toBe('/vault/guides/deep/advanced.md')
    expect(firstFile(dir('/x', 'x', []))).toBeNull()
  })

  it('lists the folders that must be expanded to reveal a file', () => {
    expect(ancestorsOf(TREE, '/vault/guides/deep/advanced.md')).toEqual([
      '/vault',
      '/vault/guides',
      '/vault/guides/deep',
    ])
    expect(ancestorsOf(TREE, '/vault/README.md')).toEqual(['/vault'])
    expect(ancestorsOf(TREE, '/missing')).toEqual([])
  })
})

describe('filterTree', () => {
  it('returns the tree unchanged for an empty query', () => {
    expect(filterTree(TREE, '   ')).toBe(TREE)
  })

  it('keeps only matching files, and the folders leading to them', () => {
    const filtered = filterTree(TREE, 'advanced')
    expect(collectFilePaths(filtered)).toEqual(['/vault/guides/deep/advanced.md'])
    expect(collectDirPaths(filtered)).toEqual(['/vault', '/vault/guides', '/vault/guides/deep'])
  })

  it('keeps a whole subtree when the folder name itself matches', () => {
    const filtered = filterTree(TREE, 'guides')
    expect(collectFilePaths(filtered)).toEqual([
      '/vault/guides/deep/advanced.md',
      '/vault/guides/intro.md',
    ])
  })

  it('is case-insensitive', () => {
    expect(collectFilePaths(filterTree(TREE, 'README'))).toEqual(['/vault/README.md'])
    expect(collectFilePaths(filterTree(TREE, 'readme'))).toEqual(['/vault/README.md'])
  })

  it('yields an empty tree when nothing matches', () => {
    const filtered = filterTree(TREE, 'zzzz')
    expect(filtered?.children).toEqual([])
  })

  it('does not mutate the original tree', () => {
    const before = JSON.stringify(TREE)
    filterTree(TREE, 'intro')
    expect(JSON.stringify(TREE)).toBe(before)
  })
})

describe('path helpers', () => {
  it('makes a path relative to the root, with forward slashes', () => {
    expect(relativePath('/vault', '/vault/guides/intro.md')).toBe('guides/intro.md')
    expect(relativePath('C:\\notes', 'C:\\notes\\sub\\a.md')).toBe('sub/a.md')
    expect(relativePath('/vault/', '/vault/a.md')).toBe('a.md')
  })

  it('leaves a path outside the root alone', () => {
    expect(relativePath('/vault', '/elsewhere/a.md')).toBe('/elsewhere/a.md')
  })

  it('finds a parent folder', () => {
    expect(parentPath('/vault/guides/intro.md')).toBe('/vault/guides')
    expect(parentPath('C:\\notes\\a.md')).toBe('C:\\notes')
    expect(parentPath('a.md')).toBe('')
  })

  it('finds a base name and a stem', () => {
    expect(baseName('/vault/guides/intro.md')).toBe('intro.md')
    expect(baseName('C:\\notes\\a.md')).toBe('a.md')
    expect(stemOf('intro.md')).toBe('intro')
    expect(stemOf('.hidden')).toBe('.hidden')
    expect(stemOf('no-extension')).toBe('no-extension')
  })
})

describe('buildTreeFromPaths', () => {
  it('nests files under the folders their paths imply', () => {
    const { root, fileCount, folderCount } = buildTreeFromPaths('/vault', [
      '/vault/README.md',
      '/vault/guides/intro.md',
      '/vault/guides/deep/advanced.md',
    ])

    expect(collectFilePaths(root)).toEqual([
      '/vault/guides/deep/advanced.md',
      '/vault/guides/intro.md',
      '/vault/README.md',
    ])
    expect(collectDirPaths(root)).toEqual(['/vault', '/vault/guides', '/vault/guides/deep'])
    expect(fileCount).toBe(3)
    expect(folderCount).toBe(3)
  })

  it('orders folders before files, case-insensitively', () => {
    const { root } = buildTreeFromPaths('/v', ['/v/zebra.md', '/v/Alpha.md', '/v/beta/x.md'])
    expect(root.children.map((child) => child.name)).toEqual(['beta', 'Alpha.md', 'zebra.md'])
  })

  it('reuses a folder shared by several files', () => {
    const { root, folderCount } = buildTreeFromPaths('/v', ['/v/a/one.md', '/v/a/two.md'])
    expect(root.children).toHaveLength(1)
    expect(root.children[0]!.children).toHaveLength(2)
    expect(folderCount).toBe(2)
  })

  it('handles Windows-style paths', () => {
    const { root } = buildTreeFromPaths('C:\\notes', ['C:\\notes\\sub\\a.md'])
    expect(root.children[0]!.path).toBe('C:\\notes\\sub')
    expect(collectFilePaths(root)).toEqual(['C:\\notes\\sub\\a.md'])
  })

  it('produces an empty tree for no files', () => {
    const { root, fileCount } = buildTreeFromPaths('/v', [])
    expect(root.children).toEqual([])
    expect(fileCount).toBe(0)
  })
})

describe('stepFile', () => {
  const rows = flattenTree(TREE, new Set(['/vault/guides', '/vault/guides/deep']))

  it('moves to the next and previous file, skipping folders', () => {
    expect(stepFile(rows, '/vault/guides/deep/advanced.md', 1)).toBe('/vault/guides/intro.md')
    expect(stepFile(rows, '/vault/guides/intro.md', 1)).toBe('/vault/README.md')
    expect(stepFile(rows, '/vault/README.md', -1)).toBe('/vault/guides/intro.md')
  })

  it('stops at the ends rather than wrapping', () => {
    expect(stepFile(rows, '/vault/README.md', 1)).toBeNull()
    expect(stepFile(rows, '/vault/guides/deep/advanced.md', -1)).toBeNull()
  })

  it('starts from an end when nothing is selected', () => {
    expect(stepFile(rows, null, 1)).toBe('/vault/guides/deep/advanced.md')
    expect(stepFile(rows, null, -1)).toBe('/vault/README.md')
  })

  it('returns null when there are no files on screen', () => {
    expect(stepFile([], null, 1)).toBeNull()
  })
})
