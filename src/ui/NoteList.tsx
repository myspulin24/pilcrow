/**
 * The vault note rows.
 *
 * Just the rows: the search box that drives them lives in the workspace column
 * above, because the same box also filters the folder tree below.
 */

import { useEffect, useRef } from 'react'

import { t } from '@/core'
import { useActions, useAppState } from '@/state/store'
import { EmptyState, Spinner } from './Feedback'
import { addToGroupMenu } from './Sidebar'

function relativeTime(iso: string): string {
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return ''
  const seconds = Math.round((Date.now() - then) / 1000)
  if (seconds < 60) return t.notes.justNow
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return t.notes.minutesAgo(minutes)
  const hours = Math.round(minutes / 60)
  if (hours < 24) return t.notes.hoursAgo(hours)
  const days = Math.round(hours / 24)
  if (days < 30) return t.notes.daysAgo(days)
  return new Date(then).toLocaleDateString('cs-CZ')
}

export function NoteList() {
  const state = useAppState()
  const actions = useActions()
  const listRef = useRef<HTMLUListElement>(null)

  useEffect(() => {
    const element = listRef.current?.querySelector('[aria-current="true"]')
    if (element instanceof HTMLElement) element.scrollIntoView({ block: 'nearest' })
  }, [state.activePath])

  // Only show a spinner when there is genuinely nothing to show. Replacing a
  // populated list with a spinner on every keystroke makes the column flicker
  // and throws away the user's place in it.
  if (state.notesLoading && state.notes.length === 0) return <Spinner label={t.notes.searching} />

  if (state.notes.length === 0) {
    return (
      <EmptyState
        icon="∅"
        title={state.query || state.activeTag ? t.notes.noMatches : t.notes.empty}
        description={
          state.query || state.activeTag ? t.notes.noMatchesHint : t.notes.emptyHint
        }
        action={{
          label: state.query ? t.notes.createNamed(state.query) : t.workspace.newNote,
          onClick: () => void actions.create({ title: state.query.trim() || 'Untitled' }),
        }}
      />
    )
  }

  /** Right-click a note: open it, group it, rename it, delete it. */
  const menuFor = (event: React.MouseEvent, path: string, title: string, pinned: boolean) => {
    event.preventDefault()
    actions.openMenu({
      x: event.clientX,
      y: event.clientY,
      title,
      items: [
        { label: t.menu.open, onSelect: () => void actions.open(path) },
        addToGroupMenu(state.collections, actions, path, false, title),
        {
          label: pinned ? t.note.unpin : t.note.pin,
          onSelect: () => void actions.togglePin(path),
        },
        {
          label: t.menu.renameDots,
          hint: t.menu.renameHint,
          onSelect: () =>
            actions.promptFor({
              title: t.dialogs.renameNote,
              label: t.dialogs.renameNoteLabel,
              initialValue: title,
              confirmLabel: t.common.rename,
              validate: (value) => (value.trim() ? null : t.common.nameEmpty),
              onSubmit: (value) => void actions.rename(path, value),
            }),
        },
        {
          label: t.menu.deleteNote,
          destructive: true,
          onSelect: () =>
            actions.confirmFor({
              title: t.dialogs.deleteNoteTitle,
              message: t.dialogs.deleteNoteShort(title),
              confirmLabel: t.common.delete,
              destructive: true,
              onConfirm: () => void actions.deleteFile(path, false),
            }),
        },
      ],
    })
  }

  return (
    <ul
      className={`note-list__items ${state.notesLoading ? "is-stale" : ""}`}
      ref={listRef}
      aria-label={t.notes.list}
    >
      {state.notes.map((note) => {
        const isActive = note.path === state.activePath
        return (
          <li key={note.path}>
            <button
              type="button"
              className={`note-row ${isActive ? 'is-active' : ''}`}
              aria-current={isActive ? 'true' : undefined}
              onClick={() => void actions.open(note.path)}
              onContextMenu={(event) => menuFor(event, note.path, note.title, note.pinned)}
            >
              <span className="note-row__head">
                {note.pinned ? (
                  <span className="note-row__pin" title={t.notes.pinned} aria-label={t.notes.pinned}>
                    ★
                  </span>
                ) : null}
                <span className="note-row__title">{note.title}</span>
                <span className="note-row__time">{relativeTime(note.updated)}</span>
              </span>
              {note.snippet ? (
                <span
                  className="note-row__excerpt"
                  // Snippets are built by `buildSnippet`, which escapes its
                  // input and only ever adds <mark>.
                  dangerouslySetInnerHTML={{ __html: note.snippet }}
                />
              ) : (
                <span className="note-row__excerpt">{note.excerpt || t.notes.emptyNote}</span>
              )}
              {note.tags.length > 0 ? (
                <span className="note-row__tags">
                  {note.tags.slice(0, 4).map((tag) => (
                    <span key={tag} className="note-row__tag">
                      #{tag}
                    </span>
                  ))}
                  {note.tags.length > 4 ? <span className="note-row__tag">+{note.tags.length - 4}</span> : null}
                </span>
              ) : null}
            </button>
          </li>
        )
      })}
    </ul>
  )
}
