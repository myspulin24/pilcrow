/**
 * Úchyt na pravé hraně levého sloupce.
 *
 * Šířka se během tažení píše přímo do DOM, ne přes stav Reactu: myš posílá
 * desítky událostí za vteřinu a překreslovat kvůli každé z nich celý strom
 * by bylo cítit. Do nastavení se uloží jednou, až se tlačítko pustí.
 *
 * Funguje i z klávesnice -- šipkami po deseti bodech, což je jediný způsob,
 * jak sloupec přenastavit bez myši.
 */

import { useCallback, useEffect, useRef } from 'react'

import { clampWorkspaceWidth, t } from '@/core'
import { useActions, useAppState } from '@/state/store'

export function ResizeHandle() {
  const state = useAppState()
  const actions = useActions()
  const width = clampWorkspaceWidth(state.settings.workspaceWidth)

  const handleRef = useRef<HTMLButtonElement>(null)
  /** Sloupec, jehož šířku měníme. Hledá se od úchytu, ne přes selektor. */
  const column = () => handleRef.current?.closest<HTMLElement>('.workspace') ?? null

  // Šířka z nastavení platí, dokud se netáhne; po uložení se sem vrátí
  // hodnota, kterou tažení nastavilo, takže se nic nezacuká.
  useEffect(() => {
    const element = column()
    if (element) element.style.width = `${width}px`
  }, [width])

  const persist = useCallback(
    (next: number) => {
      if (next === width) return
      void actions.updateSettings({ workspaceWidth: next }).catch(() => undefined)
    },
    [actions, width],
  )

  const onPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    const element = column()
    if (!element) return
    event.preventDefault()

    const startX = event.clientX
    // Výchozí bod je hodnota z nastavení, ne `getBoundingClientRect`: ta dvě
    // se můžou lišit (během předchozího tažení se šířka píše rovnou do DOM)
    // a nastavení je zdroj pravdy.
    const startWidth = width
    let latest = startWidth

    handleRef.current?.classList.add('is-dragging')
    document.body.classList.add('is-resizing')

    const move = (moveEvent: PointerEvent) => {
      latest = clampWorkspaceWidth(startWidth + (moveEvent.clientX - startX))
      element.style.width = `${latest}px`
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      handleRef.current?.classList.remove('is-dragging')
      document.body.classList.remove('is-resizing')
      persist(latest)
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    const step = event.key === 'ArrowLeft' ? -10 : event.key === 'ArrowRight' ? 10 : 0
    if (step === 0) return
    event.preventDefault()
    persist(clampWorkspaceWidth(width + step))
  }

  return (
    <button
      ref={handleRef}
      type="button"
      className="workspace__resize"
      aria-label={t.workspace.resize}
      title={t.workspace.resizeHint}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      // Dvojklik vrátí výchozí šířku -- rychlejší než trefovat ji tažením.
      onDoubleClick={() => persist(clampWorkspaceWidth(0))}
    />
  )
}
