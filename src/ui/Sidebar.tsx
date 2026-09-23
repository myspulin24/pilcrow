/**
 * Levý panel: trezor. Poznámky nahoře, skupiny pod nimi.
 *
 * Dvě věci, obě tvoje -- co jsi napsal a co sis dal dohromady. Všechno kolem
 * repozitáře (strom souborů, git) bydlí ve vedlejším panelu, takže je na
 * první pohled poznat, kde jsi doma a kde v cizím kódu.
 *
 * A **group** is a named list of files you linked yourself. They can live
 * anywhere on the machine -- one in the vault, one in a project folder, one on
 * another drive -- and the group is how you get back to them without going
 * hunting. Right-click any note or file to add it to one.
 *
 * Do 0.10.1 tu byla ještě tlačítka „Všechny poznámky / Připnuté / Dnes“
 * a strom štítků. Filtry šly nahradit hledáním (`is:pinned`, `tag:neco`),
 * „Dnes“ bylo tlačítko mezi filtry, které místo filtrování zakládalo soubor,
 * a strom štítků byl přehled, který se nevyplatil za sloupec, který zabíral.
 */

import { useState } from 'react'

import { collectionsContaining, SECTION_NOTES, t, type CollectionItem } from '@/core'
import { useActions, useAppState } from '@/state/store'
import { FileIcon } from './FileTree'
import { NoteList } from './NoteList'
import { ResizeHandle } from './ResizeHandle'
import { SearchBox, TagFilterNotice } from './SearchBox'
import { Section } from './Section'

export function Sidebar() {
  const state = useAppState()
  const actions = useActions()
  const [openGroups, setOpenGroups] = useState<string[]>([])

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
      <div className="sidebar__brand">
        <span className="sidebar__brand-name">Pilcrow</span>
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


      <SearchBox />
      <TagFilterNotice />

      <div className="sidebar__scroll">
        <Section
          id="ws-notes"
          title={t.workspace.notes}
          meta={`${state.notes.length}`}
          open={state.notesSectionOpen}
          onToggle={() => actions.toggleNotesSection()}
          resize={{ key: SECTION_NOTES, label: t.workspace.notes }}
        >
          <NoteList />
        </Section>

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
          <ul className="groups" aria-label={t.rail.groups}>
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

        </div>
      </div>

      <ResizeHandle column="sidebar" />
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
