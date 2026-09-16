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
