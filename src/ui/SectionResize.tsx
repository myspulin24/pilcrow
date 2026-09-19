/**
 * Úchyt na spodní hraně jednoho bloku v levém sloupci.
 *
 * Stejný princip jako u šířky sloupce: během tažení se výška píše rovnou do
 * DOM, do nastavení až po puštění. Rozdíl je v tom, co znamená nula --
 * u bloku je to plnohodnotná hodnota „řiď se obsahem“, ne chybějící údaj.
 * Proto dvojklik výšku ruší, místo aby vracel nějakou výchozí.
 */

import { useCallback, useEffect, useRef } from 'react'

import { clampSectionHeight, sectionHeight, t, withSectionHeight } from '@/core'
import { useActions, useAppState } from '@/state/store'

export function SectionResize({ sectionKey, label }: { sectionKey: string; label: string }) {
  const state = useAppState()
  const actions = useActions()
  const height = sectionHeight(state.settings.sectionHeights, sectionKey)

  const handleRef = useRef<HTMLButtonElement>(null)
  /** Blok nad úchytem -- ten, jehož výšku měníme. */
  const body = () => handleRef.current?.previousElementSibling as HTMLElement | null

  // Uložená výška platí, dokud se netáhne. Nula znamená „podle obsahu“,
  // takže se `height` z prvku odebere úplně, ne nastaví na nulu.
  useEffect(() => {
    const element = body()
    if (!element) return
    if (height === 0) {
      element.style.removeProperty('height')
      element.classList.remove('is-sized')
    } else {
      element.style.height = `${height}px`
      element.classList.add('is-sized')
    }
  }, [height])

  const persist = useCallback(
    (next: number) => {
      if (next === height) return
      void actions
        .updateSettings({
          sectionHeights: withSectionHeight(state.settings.sectionHeights, sectionKey, next),
        })
        .catch(() => undefined)
    },
    [actions, height, sectionKey, state.settings.sectionHeights],
  )

  const onPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    const element = body()
    if (!element) return
    event.preventDefault()

    const startY = event.clientY
    // Bez uložené výšky se vychází z té, kterou má blok právě teď na
    // obrazovce -- jinak by první zatáhnutí skočilo na minimum.
    const startHeight = height || Math.round(element.getBoundingClientRect().height) || 200
    let latest = startHeight

    element.classList.add('is-sized')
    handleRef.current?.classList.add('is-dragging')
    document.body.classList.add('is-resizing-v')

    const move = (moveEvent: PointerEvent) => {
      latest = clampSectionHeight(startHeight + (moveEvent.clientY - startY))
      if (latest > 0) element.style.height = `${latest}px`
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      handleRef.current?.classList.remove('is-dragging')
      document.body.classList.remove('is-resizing-v')
      persist(latest)
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    const step = event.key === 'ArrowUp' ? -20 : event.key === 'ArrowDown' ? 20 : 0
    if (step === 0) return
    event.preventDefault()
    const element = body()
    const current = height || Math.round(element?.getBoundingClientRect().height ?? 200)
    persist(clampSectionHeight(current + step))
  }

  return (
    <button
      ref={handleRef}
      type="button"
      className="ws-section__resize"
      aria-label={t.workspace.resizeSection(label)}
      title={t.workspace.resizeSectionHint}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      // Dvojklik výšku zruší -- blok se zase řídí obsahem.
      onDoubleClick={() => persist(0)}
    />
  )
}
