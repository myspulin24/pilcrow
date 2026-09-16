/**
 * Backlinks panel.
 *
 * Backlinks come from the SQLite index (`links` table) in the desktop app and
 * from a live scan in the in-memory adapter; either way they are derived from
 * the Markdown, never stored in it.
 */

import { useState } from 'react'

import { t } from '@/core'
import { useActions, useAppState } from '@/state/store'

export function Backlinks() {
  const state = useAppState()
  const actions = useActions()
  const [collapsed, setCollapsed] = useState(false)

  const count = state.backlinks.length

  return (
    <section className="backlinks" aria-label={t.backlinks.label}>
      <button
        type="button"
        className="backlinks__toggle"
        aria-expanded={!collapsed}
        onClick={() => setCollapsed((value) => !value)}
      >
        <span>{collapsed ? '▸' : '▾'}</span>
        <span>{t.backlinks.count(count)}</span>
      </button>
      {collapsed ? null : count === 0 ? (
        <p className="backlinks__empty">
          {t.backlinks.empty(state.parsed?.frontmatter.title ?? t.backlinks.emptyFallback)}
        </p>
      ) : (
        <ul className="backlinks__list">
          {state.backlinks.map((link, index) => (
            <li key={`${link.path}-${index}`}>
              <button type="button" className="backlinks__item" onClick={() => void actions.open(link.path)}>
                <span className="backlinks__title">{link.title}</span>
                <span className="backlinks__context">{link.context}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
