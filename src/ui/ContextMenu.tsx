/**
 * Right-click menu.
 *
 * One menu for the whole app, positioned at the cursor and kept inside the
 * window. Items are plain data so each call site describes what it offers
 * rather than rendering its own menu.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export interface MenuItem {
  label: string
  /** Shown in grey on the right, e.g. a shortcut or a hint. */
  hint?: string
  /** Renders in the danger colour and sits below a divider. */
  destructive?: boolean
  disabled?: boolean
  /** A submenu, for things like "Add to group". */
  children?: MenuItem[]
  onSelect?: () => void
}

export interface MenuRequest {
  x: number
  y: number
  /** Shown at the top so you can see what you right-clicked. */
  title?: string
  items: MenuItem[]
}

/**
 * One row.
 *
 * Which submenu is open is owned by the menu, not by the row: a row that
 * closed its own submenu on `mouseleave` would slam shut the moment you moved
 * the pointer toward it, which is the classic reason nested menus feel broken.
 * Here a submenu stays open until you hover a different row or the menu closes.
 */
function Item({
  item,
  open,
  onOpen,
  onClose,
}: {
  item: MenuItem
  open: boolean
  onOpen: () => void
  onClose: () => void
}) {
  const hasChildren = !!item.children && item.children.length > 0

  return (
    <li className="menu__item-wrap" onMouseEnter={onOpen}>
      <button
        type="button"
        role="menuitem"
        className={`menu__item ${item.destructive ? 'menu__item--danger' : ''}`}
        disabled={item.disabled}
        aria-haspopup={hasChildren ? 'menu' : undefined}
        aria-expanded={hasChildren ? open : undefined}
        onClick={() => {
          if (hasChildren) {
            onOpen()
            return
          }
          item.onSelect?.()
          onClose()
        }}
      >
        <span className="menu__label">{item.label}</span>
        {item.hint ? <span className="menu__hint">{item.hint}</span> : null}
        {hasChildren ? (
          <span className="menu__hint" aria-hidden="true">
            {'▸'}
          </span>
        ) : null}
      </button>

      {hasChildren && open ? (
        <ul className="menu menu--sub" role="menu">
          {item.children!.map((child, index) => (
            <li className="menu__item-wrap" key={`${child.label}-${index}`}>
              <button
                type="button"
                role="menuitem"
                className={`menu__item ${child.destructive ? 'menu__item--danger' : ''}`}
                disabled={child.disabled}
                onClick={() => {
                  child.onSelect?.()
                  onClose()
                }}
              >
                <span className="menu__label">{child.label}</span>
                {child.hint ? <span className="menu__hint">{child.hint}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  )
}

export function ContextMenu({ request, onClose }: { request: MenuRequest; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: request.x, top: request.y })
  /** Index of the row whose submenu is showing, if any. */
  const [openIndex, setOpenIndex] = useState<number | null>(null)

  // Nudge the menu back inside the window if it would hang off an edge.
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const { width, height } = element.getBoundingClientRect()
    setPosition({
      left: Math.max(4, Math.min(request.x, window.innerWidth - width - 4)),
      top: Math.max(4, Math.min(request.y, window.innerHeight - height - 4)),
    })
  }, [request.x, request.y])

  useEffect(() => {
    const dismiss = (event: Event) => {
      if (event instanceof KeyboardEvent && event.key !== 'Escape') return
      // A press inside the menu is the user choosing something. This listener
      // runs in the capture phase, so without this check it would close the
      // menu before the item's own click ever fired.
      if (event.target instanceof Node && ref.current?.contains(event.target)) return
      onClose()
    }
    window.addEventListener('keydown', dismiss, true)
    window.addEventListener('mousedown', dismiss, true)
    window.addEventListener('resize', dismiss)
    window.addEventListener('blur', dismiss)
    return () => {
      window.removeEventListener('keydown', dismiss, true)
      window.removeEventListener('mousedown', dismiss, true)
      window.removeEventListener('resize', dismiss)
      window.removeEventListener('blur', dismiss)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      className="menu-root"
      style={{ left: position.left, top: position.top }}
      // Stop the dismiss listener from firing for clicks inside the menu.
      onMouseDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      <ul className="menu" role="menu" aria-label={request.title ?? 'Actions'}>
        {request.title ? <li className="menu__title">{request.title}</li> : null}
        {request.items.map((item, index) => (
          <Item
            key={`${item.label}-${index}`}
            item={item}
            open={openIndex === index}
            onOpen={() => setOpenIndex(item.children?.length ? index : null)}
            onClose={onClose}
          />
        ))}
      </ul>
    </div>
  )
}
