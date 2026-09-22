/**
 * Skládací oddíl v levém sloupci: Poznámky, otevřená složka, Git.
 *
 * Vlastní soubor, aby ho mohl použít Workspace i sekce, které v něm bydlí,
 * bez kruhového importu.
 */

import type { ReactNode } from 'react'

import { SectionResize } from './SectionResize'

export function Section({
  id,
  title,
  meta,
  open,
  onToggle,
  actions,
  resize,
  active,
  activeLabel,
  titleHint,
  children,
}: {
  id: string
  title: ReactNode
  meta?: ReactNode
  open: boolean
  onToggle: () => void
  actions?: ReactNode
  /** Klíč a popis bloku, kterému jde nastavit výška. Bez toho roste obsahem. */
  resize?: { key: string; label: string }
  /**
   * Vybraný blok mezi několika stejnými -- dnes aktivní složka.
   *
   * `undefined` znamená „tady se nevybírá“: takový blok se nijak neoznačí
   * a čtečka obrazovky o žádném výběru nemluví.
   */
  active?: boolean
  /** Čím se označení vysloví. Povinné tam, kde `active` něco znamená. */
  activeLabel?: string
  /** Popisek hlavičky pod myší. */
  titleHint?: string
  children: ReactNode
}) {
  return (
    // No aria-label here: the toggle button below already names the section,
    // and a second identical name would make queries ambiguous.
    <section id={id} className={`ws-section ${active ? 'is-active' : ''}`}>
      <div className="ws-section__header">
        <button
          type="button"
          className="ws-section__toggle"
          aria-expanded={open}
          aria-controls={`${id}-body`}
          aria-current={active === undefined ? undefined : active}
          title={titleHint}
          onClick={onToggle}
        >
          <span className="ws-section__twisty" aria-hidden="true">
            {open ? '▾' : '▸'}
          </span>
          <span className="ws-section__title">{title}</span>
          {meta ? <span className="ws-section__meta">{meta}</span> : null}
          {active && activeLabel ? (
            <span className="ws-section__active" title={activeLabel}>
              <span className="ws-section__sr">{activeLabel}</span>
              <span aria-hidden="true">●</span>
            </span>
          ) : null}
        </button>
        {actions ? <span className="ws-section__actions">{actions}</span> : null}
      </div>
      {open ? (
        <>
          <div className="ws-section__body" id={`${id}-body`}>
            {children}
          </div>
          {resize ? <SectionResize sectionKey={resize.key} label={resize.label} /> : null}
        </>
      ) : null}
    </section>
  )
}
