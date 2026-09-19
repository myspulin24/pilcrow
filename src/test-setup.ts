import '@testing-library/jest-dom/vitest'

// jsdom does not implement these, and the editor uses both.
if (!window.requestAnimationFrame) {
  window.requestAnimationFrame = ((callback: FrameRequestCallback) =>
    setTimeout(() => callback(Date.now()), 0) as unknown as number) as typeof window.requestAnimationFrame
  window.cancelAnimationFrame = ((handle: number) => clearTimeout(handle)) as typeof window.cancelAnimationFrame
}

if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

if (!HTMLElement.prototype.scrollIntoView) {
  HTMLElement.prototype.scrollIntoView = () => {}
}

// jsdom nezná `PointerEvent`. Bez něj by se v testech ztratilo `clientX`
// a z tažení by vyšlo `NaN` -- což vypadá jako chyba v komponentě, ale je to
// chybějící schopnost prostředí. `MouseEvent` nese všechno, co je potřeba.
if (typeof window.PointerEvent === 'undefined') {
  class PointerEventPolyfill extends MouseEvent {
    readonly pointerId: number
    readonly pointerType: string
    readonly isPrimary: boolean

    constructor(type: string, params: PointerEventInit = {}) {
      super(type, params)
      this.pointerId = params.pointerId ?? 1
      this.pointerType = params.pointerType ?? 'mouse'
      this.isPrimary = params.isPrimary ?? true
    }
  }
  window.PointerEvent = PointerEventPolyfill as unknown as typeof PointerEvent
}

// Zachytávání ukazatele jsdom taky nemá; při tažení se na něj nespoléháme,
// ale React ho volá, a bez téhle dvojice by to spadlo.
if (!HTMLElement.prototype.setPointerCapture) {
  HTMLElement.prototype.setPointerCapture = () => {}
  HTMLElement.prototype.releasePointerCapture = () => {}
  HTMLElement.prototype.hasPointerCapture = () => false
}
