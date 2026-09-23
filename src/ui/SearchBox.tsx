/**
 * Políčko hledání a tlačítko nové poznámky.
 *
 * Jedno hledání na celou aplikaci: zužuje seznam poznámek i strom souborů
 * ve vedlejším panelu. Bydlí v panelu s poznámkami, ale když je ten schovaný
 * (Ctrl + \), vykreslí se v panelu se složkami -- jinak by se schováním
 * poznámek ztratil i jediný způsob, jak prořezat strom souborů.
 *
 * Proto je to vlastní komponenta: `data-search-input` musí v dokumentu zůstat
 * jedno jediné, protože podle něj kurzor hledá Ctrl + F.
 */

import { t } from '@/core'
import { useActions, useAppState } from '@/state/store'

export function SearchBox() {
  const state = useAppState()
  const actions = useActions()

  /** Šipky dolů a nahoru z hledání procházejí seznam poznámek. */
  const stepNote = (delta: number) => {
    if (state.notes.length === 0) return
    const current = state.notes.findIndex((note) => note.path === state.activePath)
    const next = Math.min(state.notes.length - 1, Math.max(0, (current === -1 ? -1 : current) + delta))
    const note = state.notes[next]
    if (note) void actions.open(note.path)
  }

  return (
    <div className="workspace__search">
      <input
        type="search"
        data-search-input
        className="workspace__input"
        placeholder={t.workspace.searchShort}
        aria-label={t.workspace.search}
        title={t.workspace.search}
        value={state.query}
        onChange={(event) => actions.setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            stepNote(1)
          } else if (event.key === 'ArrowUp') {
            event.preventDefault()
            stepNote(-1)
          } else if (event.key === 'Enter') {
            event.preventDefault()
            document.querySelector<HTMLTextAreaElement>('[data-editor-textarea]')?.focus()
          } else if (event.key === 'Escape') {
            actions.setQuery('')
          }
        }}
      />
      <button
        type="button"
        className="workspace__new"
        title={t.workspace.newNote}
        aria-label={t.workspace.newNote}
        onClick={() => void actions.create({ title: state.query.trim() || 'Untitled' })}
      >
        +
      </button>
    </div>
  )
}

/**
 * Řádek „Filtrováno štítkem #neco“ s tlačítkem, které filtr zruší.
 *
 * Štítek se nastaví kliknutím na `#štítek` v náhledu poznámky. Bez tohohle
 * řádku by nebylo poznat, proč je seznam poznámek najednou kratší.
 */
export function TagFilterNotice() {
  const state = useAppState()
  const actions = useActions()
  if (!state.activeTag) return null

  return (
    <div className="workspace__filter">
      <span>
        {t.workspace.filteredByTag} <strong>#{state.activeTag}</strong>
      </span>
      <button type="button" onClick={() => actions.setActiveTag(null)}>
        {t.workspace.clearFilter}
      </button>
    </div>
  )
}
