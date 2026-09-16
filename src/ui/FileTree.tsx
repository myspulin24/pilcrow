/**
 * The folder tree rows.
 *
 * Rendered inside the workspace column, underneath the note list, so all
 * navigation lives in one place. The tree itself is built in Rust; this only
 * decides what is on screen given what is expanded.
 */

import { useMemo } from 'react'

import { filterTree, flattenTree, stepFile, t, type TreeNode, type TreeRow } from '@/core'
import { useActions, useAppState } from '@/state/store'
import { addToGroupMenu } from './Sidebar'

export function FolderIcon({ open }: { open: boolean }) {
  return (
    <span className="tree__icon" aria-hidden="true">
      {open ? '\u{1F4C2}' : '\u{1F4C1}'}
    </span>
  )
}

export function FileIcon() {
  return (
    <span className="tree__icon" aria-hidden="true">
      {'\u{1F4C4}'}
    </span>
  )
}

function Row({
  row,
  activePath,
  onToggle,
  onOpen,
  onMenu,
}: {
  row: TreeRow
  activePath: string | null
  onToggle: (path: string) => void
  onOpen: (path: string) => void
  onMenu: (event: React.MouseEvent, row: TreeRow) => void
}) {
  const { node, depth, expanded, hasChildren } = row
  const isDir = node.kind === 'dir'
  const isActive = !isDir && node.path === activePath

  return (
    <li
      role="treeitem"
      aria-level={depth + 1}
      aria-expanded={isDir && hasChildren ? expanded : undefined}
      aria-selected={isActive}
      className={`tree__row ${isActive ? 'is-active' : ''}`}
      style={{ paddingLeft: `${depth * 14 + 10}px` }}
    >
      <button
        type="button"
        className="tree__button"
        title={node.path}
        onClick={() => (isDir ? onToggle(node.path) : onOpen(node.path))}
        onContextMenu={(event) => onMenu(event, row)}
        {...(isDir ? {} : { 'data-tree-file': node.path })}
      >
        <span className={`tree__twisty ${hasChildren ? '' : 'tree__twisty--empty'}`} aria-hidden="true">
          {hasChildren ? (expanded ? '▾' : '▸') : ''}
        </span>
        {isDir ? <FolderIcon open={expanded} /> : <FileIcon />}
        <span className="tree__name">{node.name}</span>
      </button>
    </li>
  )
}

/**
 * The visible rows of the open folder.
 *
 * The workspace search box doubles as the tree filter, so typing narrows the
 * notes above and the files below at the same time. While a filter is active
 * everything is expanded -- you asked to see the matches, not to go hunting
 * for them.
 */
export function FileTree({ tree, filter }: { tree: TreeNode; filter: string }) {
  const state = useAppState()
  const actions = useActions()

  const visible = useMemo(() => filterTree(tree, filter), [tree, filter])

  const expandedSet = useMemo(() => {
    if (!filter.trim()) return new Set(state.explorer.expanded)
    const all = new Set<string>()
    const walk = (node: TreeNode | null) => {
      if (!node || node.kind !== 'dir') return
      all.add(node.path)
      for (const child of node.children) walk(child)
    }
    walk(visible)
    return all
  }, [filter, state.explorer.expanded, visible])

  const rows = useMemo(() => flattenTree(visible, expandedSet), [visible, expandedSet])

  /** Right-click a file in the tree: open it, group it, reveal it, delete it. */
  const onMenu = (event: React.MouseEvent, row: TreeRow) => {
    event.preventDefault()
    const { node } = row
    if (node.kind === 'dir') {
      actions.openMenu({
        x: event.clientX,
        y: event.clientY,
        title: node.name,
        items: [
          {
            label: row.expanded ? t.menu.collapse : t.menu.expand,
            onSelect: () => actions.toggleTreeFolder(node.path),
          },
          { label: t.workspace.expandAll, onSelect: () => actions.expandAllFolders() },
          { label: t.workspace.collapseAll, onSelect: () => actions.collapseAllFolders() },
        ],
      })
      return
    }

    actions.openMenu({
      x: event.clientX,
      y: event.clientY,
      title: node.name,
      items: [
        { label: t.menu.open, onSelect: () => void actions.openFromTree(node.path) },
        addToGroupMenu(state.collections, actions, node.path, true),
        { label: t.menu.reveal, onSelect: () => void actions.revealPath(node.path) },
        {
          label: t.menu.deleteFile,
          hint: t.menu.deleteFileHint,
          destructive: true,
          onSelect: () =>
            actions.confirmFor({
              title: t.dialogs.deleteFileTitle,
              message: t.dialogs.deleteFileMessage(node.path),
              confirmLabel: t.common.delete,
              destructive: true,
              onConfirm: () => void actions.deleteFile(node.path, true),
            }),
        },
      ],
    })
  }

  if (rows.length === 0) {
    return (
      <p className="workspace__note">
        {filter.trim() ? t.workspace.noFileMatches : t.workspace.folderEmpty}
      </p>
    )
  }

  return (
    <ul
      className="tree"
      role="tree"
      aria-label={t.workspace.folderContents}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
        event.preventDefault()
        const next = stepFile(rows, state.activePath, event.key === 'ArrowDown' ? 1 : -1)
        if (next) void actions.openFromTree(next)
      }}
    >
      {rows.map((row) => (
        <Row
          key={row.node.path}
          row={row}
          activePath={state.activePath}
          onToggle={actions.toggleTreeFolder}
          onOpen={(path) => void actions.openFromTree(path)}
          onMenu={onMenu}
        />
      ))}
    </ul>
  )
}
