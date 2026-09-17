/**
 * Editor vzorců.
 *
 * Píše se do něj v LaTeXu, ale umět LaTeX není podmínka: paleta dole vkládá
 * hotové kousky a náhled nahoře se překresluje při každém znaku, takže je
 * pořád vidět, co z toho leze. Chyba se ukáže pod náhledem česky a ve chvíli,
 * kdy vznikla -- ne až po vložení do poznámky.
 *
 * Když je něco ve vzorci označené, značka z palety to pohltí: označíš `x`,
 * klikneš na odmocninu a máš `\sqrt{x}`.
 */

import { useEffect, useMemo, useRef, useState } from 'react'

import { applySnippet, MATH_GROUPS, renderMath, t, type MathSnippet } from '@/core'

import { Backdrop, useEscape } from './Modal'

/** Jedno tlačítko palety i s vysázeným náhledem toho, co vloží. */
function PaletteButton({
  snippet,
  onPick,
}: {
  snippet: MathSnippet
  onPick: (snippet: MathSnippet) => void
}) {
  const preview = useMemo(() => renderMath(snippet.preview, false), [snippet.preview])

  return (
    <button
      type="button"
      className="math-palette__button"
      title={`${snippet.title} — ${snippet.insert.replace(/\$[12]/g, '…')}`}
      aria-label={snippet.title}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => onPick(snippet)}
    >
      {preview.html ? (
        // KaTeX vrací hotové HTML; `trust: false` z něj nedovolí udělat odkaz
        // ani nic spustitelného.
        <span dangerouslySetInnerHTML={{ __html: preview.html }} />
      ) : (
        <span>{snippet.label}</span>
      )}
    </button>
  )
}

export function MathDialog({
  initialTex = '',
  initialDisplay = true,
  editing = false,
  onSubmit,
  onClose,
}: {
  initialTex?: string
  initialDisplay?: boolean
  /** Upravujeme existující vzorec, nebo vkládáme nový? Mění jen popisek. */
  editing?: boolean
  onSubmit: (tex: string, display: boolean) => void
  onClose: () => void
}) {
  const [tex, setTex] = useState(initialTex)
  const [display, setDisplay] = useState(initialDisplay)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  useEscape(onClose)

  useEffect(() => {
    const field = inputRef.current
    if (!field) return
    field.focus()
    field.setSelectionRange(field.value.length, field.value.length)
  }, [])

  const rendered = useMemo(() => renderMath(tex, display), [tex, display])
  const trimmed = tex.trim()

  const pick = (snippet: MathSnippet) => {
    const field = inputRef.current
    const start = field?.selectionStart ?? tex.length
    const end = field?.selectionEnd ?? tex.length
    const next = applySnippet(tex, start, end, snippet.insert)
    setTex(next.tex)
    // Kurzor musí skočit až po překreslení, jinak ho React přepíše zpátky.
    requestAnimationFrame(() => {
      const target = inputRef.current
      if (!target) return
      target.focus()
      target.setSelectionRange(next.selectionStart, next.selectionEnd)
    })
  }

  const submit = () => {
    if (!trimmed) return
    onSubmit(trimmed, display)
  }

  return (
    <Backdrop onClose={onClose}>
      <div
        className="modal modal--math"
        role="dialog"
        aria-modal="true"
        aria-label={t.math.title}
        onKeyDown={(event) => {
          // Enter v textovém poli dělá nový řádek, takže vkládáme až s Ctrl.
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault()
            submit()
          }
        }}
      >
        <h2 className="modal__title">{t.math.title}</h2>

        <div className="math-preview" aria-label={t.math.preview} aria-live="polite">
          {trimmed ? (
            <div
              className={rendered.error ? 'math-preview__body is-error' : 'math-preview__body'}
              dangerouslySetInnerHTML={{ __html: rendered.html }}
            />
          ) : (
            <p className="math-preview__empty">{t.math.previewEmpty}</p>
          )}
        </div>

        {trimmed && rendered.error ? (
          <p className="math-preview__error" role="status">
            {rendered.error}
          </p>
        ) : null}

        <label className="modal__label" htmlFor="math-source">
          {t.math.editorLabel}
        </label>
        <textarea
          id="math-source"
          ref={inputRef}
          className="modal__input math-source"
          aria-label={t.math.editorLabel}
          rows={3}
          spellCheck={false}
          placeholder={t.math.placeholder}
          value={tex}
          onChange={(event) => setTex(event.target.value)}
        />

        <label className="math-display-toggle">
          <input
            type="checkbox"
            checked={display}
            onChange={(event) => setDisplay(event.target.checked)}
          />
          <span>{t.math.display}</span>
          <span className="math-display-toggle__hint">{t.math.displayHint}</span>
        </label>

        <div className="math-palette" aria-label={t.math.palette}>
          {MATH_GROUPS.map((group) => (
            <section className="math-palette__group" key={group.name}>
              <h3 className="math-palette__title">{group.name}</h3>
              <div className="math-palette__row">
                {group.snippets.map((snippet) => (
                  <PaletteButton key={snippet.label} snippet={snippet} onPick={pick} />
                ))}
              </div>
            </section>
          ))}
        </div>

        <p className="math-help">{t.math.help}</p>

        <div className="modal__actions">
          <button type="button" className="button" onClick={onClose}>
            {t.common.cancel}
          </button>
          <button
            type="button"
            className="button button--primary"
            disabled={!trimmed}
            onClick={submit}
          >
            {editing ? t.math.save : t.math.insert}
          </button>
        </div>
      </div>
    </Backdrop>
  )
}
