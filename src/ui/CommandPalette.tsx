/**
 * Command palette.
 *
 * Two modes share one widget:
 *   - `commands` (Cmd/Ctrl + K): fuzzy over commands *and* note titles.
 *   - `link`     (Cmd/Ctrl + L, or typing `[[`): note titles only, and picking
 *     one inserts a wiki link at the caret.
 */

import { useEffect, useMemo, useRef, useState } from 'react'

import { fuzzyScore, t } from '@/core'
import { formatShortcut } from '@/lib/shortcuts'
import type { Command, ConfirmRequest, PromptRequest } from '@/state/commands'
import { buildCommands } from '@/state/commands'
import { useAssistant } from '@/state/assistant-store'
import { useActions, useAppState } from '@/state/store'
import { useInsertWikiLink } from './NotePane'

interface Row {
  key: string
  label: string
  detail?: string
  shortcut?: string
  group: string
  run: () => void
}

export function CommandPalette({
  prompt,
  confirm,
}: {
  prompt: (request: PromptRequest) => void
  confirm: (request: ConfirmRequest) => void
}) {
  const state = useAppState()
  const actions = useActions()
  const assistant = useAssistant()
  const insertWikiLink = useInsertWikiLink()
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const linkMode = state.paletteMode === 'link'

  useEffect(() => {
    setQuery('')
    setSelected(0)
    const id = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [state.paletteMode, state.paletteOpen])

  const commands: Command[] = useMemo(
    () =>
      linkMode
        ? []
        : buildCommands({ state, actions, prompt, confirm, toggleAssistant: assistant.actions.toggle }),
    [linkMode, state, actions, assistant, prompt, confirm],
  )

  const rows = useMemo<Row[]>(() => {
    const noteRows: Row[] = state.notes.map((note) => ({
      key: `note:${note.path}`,
      label: note.title,
      detail: note.path,
      group: linkMode ? t.palette.groups.linkTo : t.palette.groups.notes,
      run: () => {
        if (linkMode) insertWikiLink(note.title)
        else void actions.open(note.path)
      },
    }))

    const commandRows: Row[] = commands.map((command) => ({
      key: `command:${command.id}`,
      label: command.title,
      ...(command.hint ? { detail: command.hint } : {}),
      ...(command.shortcut ? { shortcut: formatShortcut(command.shortcut) } : {}),
      group: command.group,
      run: () => void command.run(),
    }))

    const all = linkMode ? noteRows : [...commandRows, ...noteRows]
    const term = query.trim()
    if (!term) return all.slice(0, 60)

    const scored = all
      .map((row) => {
        const score = Math.max(
          fuzzyScore(term, row.label) ?? Number.NEGATIVE_INFINITY,
          (fuzzyScore(term, row.detail ?? '') ?? Number.NEGATIVE_INFINITY) - 5,
        )
        return { row, score }
      })
      .filter((entry) => entry.score > Number.NEGATIVE_INFINITY)
      .sort((a, b) => b.score - a.score)
      .slice(0, 60)
      .map((entry) => entry.row)

    // Always offer to create what was typed, so the palette is never a dead end.
    if (!linkMode) {
      scored.push({
        key: 'create-new',
        label: t.palette.createNoteNamed(term),
        group: t.palette.groups.note,
        run: () => void actions.create({ title: term }),
      })
    } else if (!state.notes.some((note) => note.title.toLowerCase() === term.toLowerCase())) {
      scored.push({
        key: 'create-link',
        label: t.palette.linkToNew(term),
        detail: t.palette.linkToNewHint,
        group: t.palette.groups.linkTo,
        run: () => insertWikiLink(term),
      })
    }
    return scored
  }, [actions, commands, insertWikiLink, linkMode, query, state.notes])

  useEffect(() => {
    setSelected((value) => Math.min(value, Math.max(0, rows.length - 1)))
  }, [rows.length])

  useEffect(() => {
    const element = listRef.current?.children[selected]
    if (element instanceof HTMLElement) element.scrollIntoView({ block: 'nearest' })
  }, [selected])

  if (!state.paletteOpen) return null

  const close = () => actions.setPalette(false)

  const commit = (index: number) => {
    const row = rows[index]
    if (!row) return
    close()
    row.run()
  }

  let lastGroup = ''

  return (
    <div
      className="palette-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close()
      }}
    >
      <div className="palette" role="dialog" aria-modal="true" aria-label={linkMode ? t.palette.insertLink : t.palette.commands}>
        <input
          ref={inputRef}
          className="palette__input"
          value={query}
          placeholder={linkMode ? t.palette.linkPlaceholder : t.palette.commandsPlaceholder}
          aria-label={linkMode ? t.palette.linkInputLabel : t.palette.commandsInputLabel}
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          aria-activedescendant={rows[selected] ? `palette-row-${selected}` : undefined}
          onChange={(event) => {
            setQuery(event.target.value)
            setSelected(0)
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setSelected((value) => Math.min(rows.length - 1, value + 1))
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              setSelected((value) => Math.max(0, value - 1))
            } else if (event.key === 'Enter') {
              event.preventDefault()
              commit(selected)
            } else if (event.key === 'Escape') {
              event.preventDefault()
              close()
            }
          }}
        />
        {rows.length === 0 ? (
          <p className="palette__empty">{t.palette.noMatches}</p>
        ) : (
          <ul className="palette__list" id="palette-list" role="listbox" ref={listRef}>
            {rows.map((row, index) => {
              const showGroup = row.group !== lastGroup
              lastGroup = row.group
              return (
                <li
                  key={row.key}
                  id={`palette-row-${index}`}
                  role="option"
                  aria-selected={index === selected}
                  className={`palette__row ${index === selected ? 'is-selected' : ''}`}
                  onMouseEnter={() => setSelected(index)}
                  onMouseDown={(event) => {
                    event.preventDefault()
                    commit(index)
                  }}
                >
                  {showGroup ? <span className="palette__group">{row.group}</span> : null}
                  <span className="palette__label">{row.label}</span>
                  {row.detail ? <span className="palette__detail">{row.detail}</span> : null}
                  {row.shortcut ? <kbd className="palette__shortcut">{row.shortcut}</kbd> : null}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
