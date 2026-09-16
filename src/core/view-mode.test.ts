import { describe, expect, it } from 'vitest'

import { cycleMode, showsEditor, showsPreview, stepMode, VIEW_MODES } from './view-mode'

describe('stepMode', () => {
  it('moves one position at a time', () => {
    expect(stepMode('editor', 1)).toBe('split')
    expect(stepMode('split', 1)).toBe('preview')
    expect(stepMode('preview', -1)).toBe('split')
    expect(stepMode('split', -1)).toBe('editor')
  })

  it('stops at the ends rather than wrapping', () => {
    expect(stepMode('editor', -1)).toBe('editor')
    expect(stepMode('preview', 1)).toBe('preview')
  })

  it('clamps a jump larger than the track', () => {
    expect(stepMode('editor', 9)).toBe('preview')
    expect(stepMode('preview', -9)).toBe('editor')
  })
})

describe('cycleMode', () => {
  it('wraps around, so one shortcut reaches every mode', () => {
    expect(cycleMode('editor')).toBe('split')
    expect(cycleMode('split')).toBe('preview')
    expect(cycleMode('preview')).toBe('editor')
  })

  it('visits every mode in three presses', () => {
    const seen = new Set<string>()
    let mode: (typeof VIEW_MODES)[number] = 'editor'
    for (let i = 0; i < 3; i++) {
      seen.add(mode)
      mode = cycleMode(mode)
    }
    expect(seen.size).toBe(3)
    expect(mode).toBe('editor')
  })
})

describe('what each mode shows', () => {
  it('always shows at least one pane', () => {
    for (const mode of VIEW_MODES) {
      expect(showsEditor(mode) || showsPreview(mode)).toBe(true)
    }
  })

  it('splits shows both, the others show one', () => {
    expect([showsEditor('split'), showsPreview('split')]).toEqual([true, true])
    expect([showsEditor('editor'), showsPreview('editor')]).toEqual([true, false])
    expect([showsEditor('preview'), showsPreview('preview')]).toEqual([false, true])
  })
})
