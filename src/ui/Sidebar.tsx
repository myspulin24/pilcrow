/**
 * The left rail: your groups first, tags second.
 *
 * A **group** is a named list of files you linked yourself. They can live
 * anywhere on the machine -- one in the vault, one in a project folder, one on
 * another drive -- and the group is how you get back to them without going
 * hunting. Right-click any note or file to add it to one.
 *
 * Tags come below, and only describe vault notes: they are read out of the
 * Markdown itself, so they cannot apply to somebody else's files.
 */

import { useMemo, useState } from 'react'

import { buildTagTree, collectionsContaining, t, type CollectionItem, type TagNode } from '@/core'
import { useActions, useAppState } from '@/state/store'
import { FileIcon } from './FileTree'

function TagBranch({
  node,
  activeTag,
  onSelect,
  depth,
}: {
  node: TagNode
  activeTag: string | null
  onSelect: (tag: string) => void
  depth: number
}) {
  const [expanded, setExpanded] = useState(depth < 1)
  const isActive = activeTag === node.path
  const hasChildren = node.children.length > 0

  return (
    <li className="tag-tree__item">
      <div className={`tag-tree__row ${isActive ? 'is-active' : ''}`} style={{ paddingLeft: `${depth * 12 + 8}px` }}>
        {hasChildren ? (
          <button
            type="button"
            className="tag-tree__twisty"
            aria-label={expanded ? t.rail.collapseTag(node.path) : t.rail.expandTag(node.path)}
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? '▾' : '▸'}
          </button>
        ) : (
          <span className="tag-tree__twisty tag-tree__twisty--empty" aria-hidden="true" />
        )}
        <button
          type="button"
          className="tag-tree__label"
          onClick={() => onSelect(node.path)}
          aria-current={isActive ? 'true' : undefined}
        >
          <span className="tag-tree__name">#{node.name}</span>
          <span className="tag-tree__count">{node.count}</span>
        </button>
      </div>
      {hasChildren && expanded ? (
        <ul className="tag-tree">
          {node.children.map((child) => (
            <TagBranch key={child.path} node={child} activeTag={activeTag} onSelect={onSelect} depth={depth + 1} />
          ))}
        </ul>
      ) : null}
    </li>
  )
}

export function Sidebar() {
  const state = useAppState()
  const actions = useActions()
  const [openGroups, setOpenGroups] = useState<string[]>([])
  const [tagsOpen, setTagsOpen] = useState(true)

  const tags = useMemo(() => buildTagTree(state.notes.map((note) => note.tags)), [state.notes])
  const pinnedCount = state.notes.filter((note) => note.pinned).length

  const toggleGroup = (id: string) =>
    setOpenGroups((open) => (open.includes(id) ? open.filter((entry) => entry !== id) : [...open, id]))

  const newGroup = () =>
    actions.promptFor({
      title: t.dialogs.newGroup,
      label: t.dialogs.groupNameLabel,
      placeholder: t.dialogs.groupNamePlaceholder,
      confirmLabel: t.common.create,
      onSubmit: (value) => void actions.createCollection(value),
    })

  const groupMenu = (event: React.MouseEvent, id: string, name: string) => {
    event.preventDefault()
    actions.openMenu({
      x: event.clientX,
      y: event.clientY,
      title: name,
      items: [
        {
          label: t.menu.renameGroupDots,
          onSelect: () =>
            actions.promptFor({
              title: t.dialogs.renameGroup,
              label: t.dialogs.groupNameLabel,
              initialValue: name,
              confirmLabel: t.common.rename,
              onSubmit: (value) => void actions.renameCollection(id, value),
            }),
        },
        {
          label: t.menu.addOpenFile,
          disabled: !state.activePath,
          onSelect: () => {
            if (!state.activePath) return
            void actions.addPathToCollection(
              id,
              state.activePath,
              state.editor?.external ?? false,
              state.parsed?.frontmatter.title,
            )
          },
        },
        {
          label: t.menu.deleteGroup,
          hint: t.menu.deleteGroupHint,
          destructive: true,
          onSelect: () =>
            actions.confirmFor({
              title: t.dialogs.deleteGroupTitle,
              message: t.dialogs.deleteGroupMessage(name),
              confirmLabel: t.menu.deleteGroup,
              destructive: true,
              onConfirm: () => void actions.removeCollection(id),
            }),
        },
      ],
    })
  }

  const itemMenu = (event: React.MouseEvent, id: string, item: CollectionItem) => {
    event.preventDefault()
    actions.openMenu({
      x: event.clientX,
      y: event.clientY,
      title: item.label,
      items: [
        { label: t.menu.open, onSelect: () => void actions.openCollectionItem(item) },
        {
          label: t.menu.removeFromGroup,
          hint: t.menu.removeFromGroupHint,
          onSelect: () => void actions.removePathFromCollection(id, item.path),
        },
        {
          label: t.menu.deleteFile,
          destructive: true,
          onSelect: () =>
            actions.confirmFor({
              title: t.dialogs.deleteFileTitle,
              message: t.dialogs.deleteFileFromGroup(item.path),
              confirmLabel: t.common.delete,
              destructive: true,
              onConfirm: () => void actions.deleteFile(item.path, item.external),
            }),
        },
      ],
    })
  }

  return (
    <nav className="sidebar" aria-label={t.rail.label}>
      <div className="sidebar__section sidebar__section--top">
        <div className="sidebar__brand">
          <span className="sidebar__brand-name">Reader_MJ</span>
          <button
            type="button"
            className="sidebar__collapse"
            title={t.rail.hideHint}
            aria-label={t.rail.hide}
            onClick={() => actions.toggleSidebar()}
          >
            {'«'}
          </button>
        </div>
        <button
          type="button"
          className={`sidebar__filter ${state.activeTag === null && !state.query ? 'is-active' : ''}`}
          onClick={() => {
            actions.setActiveTag(null)
            actions.setQuery('')
          }}
        >
          <span>{t.rail.allNotes}</span>
          <span className="sidebar__count">{state.notes.length}</span>
        </button>
        <button
          type="button"
          className={`sidebar__filter ${state.query === 'is:pinned' ? 'is-active' : ''}`}
          onClick={() => actions.setQuery(state.query === 'is:pinned' ? '' : 'is:pinned')}
        >
          <span>{t.rail.pinned}</span>
          <span className="sidebar__count">{pinnedCount}</span>
        </button>
        <button type="button" className="sidebar__filter" onClick={() => void actions.openDaily()}>
          <span>{t.rail.today}</span>
          <span className="sidebar__count" aria-hidden="true">
            ↩
          </span>
        </button>
      </div>

      <div className="sidebar__section sidebar__section--grow">
        <div className="sidebar__heading-row">
          <h2 className="sidebar__heading">{t.rail.groups}</h2>
          <button
            type="button"
            className="sidebar__add"
            title={t.rail.newGroup}
            aria-label={t.rail.newGroup}
            onClick={newGroup}
          >
            +
          </button>
        </div>

        {state.collections.length === 0 ? (
          <p className="sidebar__hint">{t.rail.groupsEmpty}</p>
        ) : (
          <ul className="groups">
            {state.collections.map((collection) => {
              const open = openGroups.includes(collection.id)
              return (
                <li key={collection.id} className="groups__item">
                  <div className="groups__row">
                    <button
                      type="button"
                      className="groups__toggle"
                      aria-label={collection.name}
                      aria-expanded={open}
                      onClick={() => toggleGroup(collection.id)}
                      onContextMenu={(event) => groupMenu(event, collection.id, collection.name)}
                    >
                      <span className="groups__twisty" aria-hidden="true">
                        {open ? '▾' : '▸'}
                      </span>
                      <span className="groups__name">{collection.name}</span>
                      <span className="sidebar__count">{collection.items.length}</span>
                    </button>
                    <button
                      type="button"
                      className="groups__more"
                      aria-label={t.rail.groupActions(collection.name)}
                      onClick={(event) => groupMenu(event, collection.id, collection.name)}
                    >
                      ⋯
                    </button>
                  </div>

                  {open ? (
                    collection.items.length === 0 ? (
                      <p className="groups__empty">{t.rail.groupEmpty}</p>
                    ) : (
                      <ul className="groups__files">
                        {collection.items.map((item) => (
                          <li key={item.path}>
                            <button
                              type="button"
                              className={`groups__file ${state.activePath === item.path ? 'is-active' : ''}`}
                              title={item.path}
                              onClick={() => void actions.openCollectionItem(item)}
                              onContextMenu={(event) => itemMenu(event, collection.id, item)}
                            >
                              <FileIcon />
                              <span className="groups__file-name">{item.label}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}

        <div className="sidebar__heading-row sidebar__heading-row--spaced">
          <button
            type="button"
            className="sidebar__heading sidebar__heading--button"
            aria-expanded={tagsOpen}
            onClick={() => setTagsOpen((value) => !value)}
          >
            <span aria-hidden="true">{tagsOpen ? '▾' : '▸'}</span> {t.rail.tags}
          </button>
        </div>

        {tagsOpen ? (
          tags.length === 0 ? (
            <p className="sidebar__hint">{t.rail.tagsEmpty}</p>
          ) : (
            <ul className="tag-tree tag-tree--root">
              {tags.map((node) => (
                <TagBranch
                  key={node.path}
                  node={node}
                  activeTag={state.activeTag}
                  onSelect={(tag) => actions.setActiveTag(state.activeTag === tag ? null : tag)}
                  depth={0}
                />
              ))}
            </ul>
          )
        ) : null}
      </div>

      <div className="sidebar__footer">
        <button
          type="button"
          className="sidebar__vault"
          onClick={() => void actions.reveal()}
          title={state.status?.vaultPath ?? ''}
        >
          <span className="sidebar__vault-label">{t.rail.vault}</span>
          <span className="sidebar__vault-path">{state.status?.vaultPath ?? t.rail.vaultOpening}</span>
        </button>
      </div>
    </nav>
  )
}

/** Menu entries for putting `path` into a group. Shared by every call site. */
export function addToGroupMenu(
  collections: ReturnType<typeof useAppState>['collections'],
  actions: ReturnType<typeof useActions>,
  path: string,
  external: boolean,
  /** What to show in the group: a note passes its title, a file its name. */
  label?: string,
) {
  const already = collectionsContaining(collections, path).map((collection) => collection.id)

  return {
    label: t.menu.addToGroup,
    children: [
      ...collections.map((collection) => ({
        label: collection.name,
        hint: already.includes(collection.id) ? '✓' : undefined,
        onSelect: () => void actions.addPathToCollection(collection.id, path, external, label),
      })),
      {
        label: collections.length > 0 ? t.menu.newGroupDots : t.menu.firstGroupDots,
        onSelect: () =>
          actions.promptFor({
            title: t.dialogs.newGroup,
            label: t.dialogs.groupNameLabel,
            placeholder: t.dialogs.groupNamePlaceholder,
            confirmLabel: t.dialogs.createAndAdd,
            onSubmit: (value) => void actions.createCollectionWith(value, path, external, label),
          }),
      },
    ],
  }
}
