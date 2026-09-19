/**
 * Skládací oddíl v levém sloupci: Poznámky, otevřená složka, Git.
 *
 * Vlastní soubor, aby ho mohl použít Workspace i sekce, které v něm bydlí,
 * bez kruhového importu.
 */

import type { ReactNode } from 'react'

export function Section({
  id,
  title,
  meta,
  open,
  onToggle,
  actions,
  children,
}: {
  id: string
  title: ReactNode
  meta?: ReactNode
  open: boolean
  onToggle: () => void
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    // No aria-label here: the toggle button below already names the section,
    // and a second identical name would make queries ambiguous.
    <section className="ws-section">
      <div className="ws-section__header">
        <button
          type="button"
          className="ws-section__toggle"
          aria-expanded={open}
          aria-controls={`${id}-body`}
          onClick={onToggle}
        >
          <span className="ws-section__twisty" aria-hidden="true">
            {open ? '▾' : '▸'}
          </span>
          <span className="ws-section__title">{title}</span>
          {meta ? <span className="ws-section__meta">{meta}</span> : null}
        </button>
        {actions ? <span className="ws-section__actions">{actions}</span> : null}
      </div>
      {open ? (
        <div className="ws-section__body" id={`${id}-body`}>
          {children}
        </div>
      ) : null}
    </section>
  )
}
