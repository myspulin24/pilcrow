/**
 * Úchyt na pravé hraně sloupce.
 *
 * Používají ho dva sloupce -- postranní panel se skupinami a štítky a sloupec
 * s poznámkami a soubory. Liší se jen tím, který prvek se roztahuje, do které
 * volby se šířka ukládá a v jakých mezích.
 *
 * Šířka se během tažení píše přímo do DOM, ne přes stav Reactu: myš posílá
 * desítky událostí za vteřinu a překreslovat kvůli každé z nich celý strom
 * by bylo cítit. Do nastavení se uloží jednou, až se tlačítko pustí.
 *
 * Funguje i z klávesnice -- šipkami po deseti bodech, což je jediný způsob,
 * jak sloupec přenastavit bez myši.
 */

import { useCallback, useEffect, useRef } from 'react'

import { clampSidebarWidth, clampWorkspaceWidth, t } from '@/core'
import { useActions, useAppState } from '@/state/store'

/** Volba, do které sloupec ukládá svou šířku. */
type WidthSetting = 'workspaceWidth' | 'sidebarWidth'

/** Co se o kterém sloupci ví. Jinak jsou oba úchyty stejné. */
const COLUMNS = {
  workspace: {
    selector: '.workspace',
    className: 'workspace__resize',
    setting: 'workspaceWidth' as const,
    clamp: clampWorkspaceWidth,
    label: () => t.workspace.resize,
    hint: () => t.workspace.resizeHint,
  },
  sidebar: {
    selector: '.sidebar',
    className: 'sidebar__resize',
    setting: 'sidebarWidth' as const,
    clamp: clampSidebarWidth,
    label: () => t.rail.resize,
    hint: () => t.rail.resizeHint,
  },
} satisfies Record<
  string,
  {
    selector: string
    className: string
    setting: WidthSetting
    clamp: (value: number) => number
    label: () => string
    hint: () => string
  }
>

export function ResizeHandle({ column = 'workspace' }: { column?: keyof typeof COLUMNS }) {
  const config = COLUMNS[column]
  const state = useAppState()
  const actions = useActions()
  const width = config.clamp(state.settings[config.setting])

  const handleRef = useRef<HTMLButtonElement>(null)
  /** Sloupec, jehož šířku měníme. Hledá se od úchytu, ne přes selektor. */
  const element = () => handleRef.current?.closest<HTMLElement>(config.selector) ?? null

  // Šířka z nastavení platí, dokud se netáhne; po uložení se sem vrátí
  // hodnota, kterou tažení nastavilo, takže se nic nezacuká.
  useEffect(() => {
    const node = element()
    if (node) node.style.width = `${width}px`
  }, [width])

  const persist = useCallback(
    (next: number) => {
      if (next === width) return
      const patch =
        config.setting === 'sidebarWidth' ? { sidebarWidth: next } : { workspaceWidth: next }
      void actions.updateSettings(patch).catch(() => undefined)
    },
    [actions, config.setting, width],
  )

  const onPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    const node = element()
    if (!node) return
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
      latest = config.clamp(startWidth + (moveEvent.clientX - startX))
      node.style.width = `${latest}px`
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
    persist(config.clamp(width + step))
  }

  return (
    <button
      ref={handleRef}
      type="button"
      className={config.className}
      aria-label={config.label()}
      title={config.hint()}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      // Dvojklik vrátí výchozí šířku -- rychlejší než trefovat ji tažením.
      onDoubleClick={() => persist(config.clamp(0))}
    />
  )
}
