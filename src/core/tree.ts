/**
 * File-tree shaping for the explorer.
 *
 * The tree itself is built in Rust (it needs the file system); everything here
 * is the pure part: which rows are visible given what is expanded, which
 * folders exist, and how a filter narrows the tree. Keeping it separate is what
 * makes expand/collapse and filtering testable without a file system.
 *
 * Paths are whatever the platform uses -- `C:\notes\a.md` on Windows,
 * `/home/me/notes/a.md` elsewhere. They are treated as opaque identifiers;
 * only `relativePath` and `parentPath` look inside them.
 */

export interface TreeNode {
  name: string
  /** Absolute path, in the platform's own form. */
  path: string
  kind: 'dir' | 'file'
  /** Populated for directories; always empty for files. */
  children: TreeNode[]
}

export interface FolderTree {
  root: TreeNode
  fileCount: number
  folderCount: number
  /** True when a depth or size limit stopped the scan early. */
  truncated: boolean
}

/** One rendered line of the tree. */
export interface TreeRow {
  node: TreeNode
  /** Indentation level; the root's children are at 0. */
  depth: number
  expanded: boolean
  hasChildren: boolean
}

const SEPARATOR = /[\\/]/

/**
 * The visible rows, in display order.
 *
 * The root itself is not a row -- it is the header of the panel -- so its
 * children start at depth 0. A collapsed folder contributes one row and hides
 * its subtree.
 */
export function flattenTree(root: TreeNode | null, expanded: ReadonlySet<string>): TreeRow[] {
  if (!root) return []
  const rows: TreeRow[] = []

  const walk = (nodes: TreeNode[], depth: number) => {
    for (const node of nodes) {
      const hasChildren = node.kind === 'dir' && node.children.length > 0
      const isExpanded = hasChildren && expanded.has(node.path)
      rows.push({ node, depth, expanded: isExpanded, hasChildren })
      if (isExpanded) walk(node.children, depth + 1)
    }
  }

  walk(root.children, 0)
  return rows
}

/** Every directory path in the tree, including the root. */
export function collectDirPaths(root: TreeNode | null): string[] {
  if (!root) return []
  const out: string[] = []
  const walk = (node: TreeNode) => {
    if (node.kind !== 'dir') return
    out.push(node.path)
    for (const child of node.children) walk(child)
  }
  walk(root)
  return out
}

/** Every file path in the tree, in display order. */
export function collectFilePaths(root: TreeNode | null): string[] {
  if (!root) return []
  const out: string[] = []
  const walk = (node: TreeNode) => {
    if (node.kind === 'file') {
      out.push(node.path)
      return
    }
    for (const child of node.children) walk(child)
  }
  walk(root)
  return out
}

export function findNode(root: TreeNode | null, path: string): TreeNode | null {
  if (!root) return null
  if (root.path === path) return root
  for (const child of root.children) {
    const found = findNode(child, path)
    if (found) return found
  }
  return null
}

/** The first file in display order -- what "open the folder" selects. */
export function firstFile(root: TreeNode | null): TreeNode | null {
  if (!root) return null
  if (root.kind === 'file') return root
  for (const child of root.children) {
    const found = firstFile(child)
    if (found) return found
  }
  return null
}

/**
 * Every ancestor directory of `path` within the tree.
 * Used to reveal a file: expanding these makes it visible.
 */
export function ancestorsOf(root: TreeNode | null, path: string): string[] {
  if (!root) return []
  const trail: string[] = []

  const walk = (node: TreeNode, stack: string[]): boolean => {
    if (node.path === path) {
      trail.push(...stack)
      return true
    }
    if (node.kind !== 'dir') return false
    const next = [...stack, node.path]
    return node.children.some((child) => walk(child, next))
  }

  walk(root, [])
  return trail
}

/**
 * Narrow the tree to nodes whose name matches `query`.
 *
 * A folder survives when it matches itself or when anything beneath it does,
 * so the path to a hit stays visible. An empty query returns the tree as-is.
 */
export function filterTree(root: TreeNode | null, query: string): TreeNode | null {
  if (!root) return null
  const needle = query.trim().toLowerCase()
  if (!needle) return root

  const prune = (node: TreeNode): TreeNode | null => {
    const selfMatches = node.name.toLowerCase().includes(needle)
    if (node.kind === 'file') return selfMatches ? node : null

    const children = node.children
      .map(prune)
      .filter((child): child is TreeNode => child !== null)

    // A matching folder keeps its whole subtree; otherwise keep only the hits.
    if (selfMatches) return node
    if (children.length === 0) return null
    return { ...node, children }
  }

  const children = root.children
    .map(prune)
    .filter((child): child is TreeNode => child !== null)
  return { ...root, children }
}

/**
 * Build a tree from a flat list of file paths.
 *
 * The desktop app gets its tree from Rust, which walks the real file system.
 * This is the same shaping applied to a list of paths, which is what lets the
 * in-memory adapter -- browser preview and tests -- produce a tree with the
 * same ordering rules instead of a hand-written fixture that could drift.
 */
export function buildTreeFromPaths(rootPath: string, filePaths: string[]): FolderTree {
  const root: TreeNode = { name: baseName(rootPath) || rootPath, path: rootPath, kind: 'dir', children: [] }
  const separator = rootPath.includes('\\') ? '\\' : '/'
  let fileCount = 0
  let folderCount = 1

  for (const full of filePaths) {
    const relative = relativePath(rootPath, full)
    const segments = relative.split('/').filter(Boolean)
    if (segments.length === 0) continue

    let parent = root
    let prefix = rootPath.replace(/[\\/]+$/, '')

    for (let i = 0; i < segments.length - 1; i++) {
      const name = segments[i]!
      prefix = `${prefix}${separator}${name}`
      let next = parent.children.find((child) => child.kind === 'dir' && child.path === prefix)
      if (!next) {
        next = { name, path: prefix, kind: 'dir', children: [] }
        parent.children.push(next)
        folderCount += 1
      }
      parent = next
    }

    const name = segments[segments.length - 1]!
    parent.children.push({ name, path: full, kind: 'file', children: [] })
    fileCount += 1
  }

  // Folders before files, each case-insensitively alphabetical -- the same
  // order the Rust scanner produces.
  const sort = (node: TreeNode) => {
    node.children.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
      return a.name.toLowerCase().localeCompare(b.name.toLowerCase())
    })
    for (const child of node.children) sort(child)
  }
  sort(root)

  return { root, fileCount, folderCount, truncated: false }
}

/** Path of `path` relative to `rootPath`, using forward slashes for display. */
export function relativePath(rootPath: string, path: string): string {
  if (!rootPath || !path) return path
  const normalisedRoot = rootPath.replace(/[\\/]+$/, '')
  if (path.length > normalisedRoot.length && path.startsWith(normalisedRoot)) {
    const rest = path.slice(normalisedRoot.length)
    return rest.replace(/^[\\/]+/, '').replace(/\\/g, '/')
  }
  return path.replace(/\\/g, '/')
}

/** The containing folder of a path, or `''` when there is none. */
export function parentPath(path: string): string {
  const index = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return index <= 0 ? '' : path.slice(0, index)
}

/** The final segment of a path. */
export function baseName(path: string): string {
  const parts = path.split(SEPARATOR).filter(Boolean)
  return parts[parts.length - 1] ?? path
}

/** Drop the extension from a file name, for display and link matching. */
export function stemOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? name : name.slice(0, dot)
}

/**
 * Move the selection up or down the visible rows, skipping folders.
 * Returns the path to open, or `null` when there is nowhere to go.
 */
export function stepFile(rows: TreeRow[], currentPath: string | null, delta: number): string | null {
  const files = rows.filter((row) => row.node.kind === 'file')
  if (files.length === 0) return null

  const index = files.findIndex((row) => row.node.path === currentPath)
  if (index === -1) return files[delta > 0 ? 0 : files.length - 1]?.node.path ?? null

  const next = index + delta
  if (next < 0 || next >= files.length) return null
  return files[next]?.node.path ?? null
}
