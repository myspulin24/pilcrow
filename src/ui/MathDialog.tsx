/**
 * Editor vzorců.
 *
 * Pilcrow umí třináct zápisů matematiky a tohle okno je místo, kde se mezi
 * nimi vybírá. Uvnitř je vždycky stejný postup: zvolený jazyk se převede na
 * LaTeX (a vysází KaTeX) nebo rovnou na MathML (a vykreslí ho samo okno).
 *
 * Čtyři věci, bez kterých by přepínač jazyka byl jen ozdoba:
 *
 *   1. **Paleta se mění podle jazyka.** Odmocnina je v LaTeXu `\sqrt{}`,
 *      v AsciiMath `sqrt()`, v UnicodeMath `√()`. Naklikat vzorec musí jít
 *      v každém z nich, ne jen v tom prvním.
 *   2. **Živý náhled** bez ohledu na jazyk.
 *   3. **„Zobrazit jako LaTeX"** ukáže, co z převodu vzešlo. U jazyků, kde je
 *      převod jen nejlepší možný, je to rozdíl mezi „nefunguje to" a „vidím proč".
 *   4. **Varování se neschovávají.** Co se nepodařilo přeložit, je vidět.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import {
  applySnippet,
  CONCEPTS,
  mathLanguage,
  mathLanguageGroups,
  renderMath,
  renderMathIn,
  t,
  type Concept,
  type MathLanguageId,
} from '@/core'

import { Backdrop, useEscape } from './Modal'

/** Jedno tlačítko palety i s vysázeným náhledem toho, co vloží. */
function PaletteButton({
  concept,
  insert,
  onPick,
}: {
  concept: Concept
  insert: string
  onPick: (insert: string) => void
}) {
  // Náhled je vždy v LaTeXu -- ukazuje výsledek, ne zápis.
  const preview = useMemo(() => renderMath(concept.preview, false), [concept.preview])

  return (
    <button
      type="button"
      className="math-palette__button"
      title={`${concept.title} — vloží ${insert.replace(/\$[12]/g, '…')}`}
      aria-label={concept.title}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => onPick(insert)}
    >
      {preview.html ? (
        // KaTeX vrací hotové HTML; `trust: false` z něj nedovolí udělat odkaz
        // ani nic spustitelného.
        <span dangerouslySetInnerHTML={{ __html: preview.html }} />
      ) : (
        <span>{concept.label}</span>
      )}
    </button>
  )
}

const FIDELITY_LABEL: Record<string, string> = {
  exact: 'sází se přesně',
  mapped: 'spolehlivý převod',
  partial: 'nejlepší možný převod',
}

export function MathDialog({
  initialTex = '',
  initialLanguage = 'latex',
  initialDisplay = true,
  editing = false,
  onSubmit,
  onClose,
}: {
  initialTex?: string
  initialLanguage?: MathLanguageId
  initialDisplay?: boolean
  /** Upravujeme existující vzorec, nebo vkládáme nový? Mění jen popisek. */
  editing?: boolean
  onSubmit: (tex: string, display: boolean, language: MathLanguageId) => void
  onClose: () => void
}) {
  const [tex, setTex] = useState(initialTex)
  const [languageId, setLanguageId] = useState<MathLanguageId>(initialLanguage)
  const [display, setDisplay] = useState(initialDisplay)
  const [showLatex, setShowLatex] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  /** Kam postavit kurzor po vložení značky z palety. */
  const pendingCaret = useRef<{ start: number; end: number } | null>(null)
  useEscape(onClose)

  useEffect(() => {
    const field = inputRef.current
    if (!field) return
    field.focus()
    field.setSelectionRange(field.value.length, field.value.length)
  }, [])

  const language = mathLanguage(languageId)
  const rendered = useMemo(() => renderMathIn(tex, languageId, display), [tex, languageId, display])
  const trimmed = tex.trim()

  const pick = (insert: string) => {
    const field = inputRef.current
    const start = field?.selectionStart ?? tex.length
    const end = field?.selectionEnd ?? tex.length
    const next = applySnippet(tex, start, end, insert)
    setTex(next.tex)
    // Kurzor se nastaví až v layout efektu níž: pole je řízené, takže jeho
    // hodnotu zapisuje React při překreslení a dřív by kurzor skončil na konci.
    pendingCaret.current = { start: next.selectionStart, end: next.selectionEnd }
  }

  useLayoutEffect(() => {
    const pending = pendingCaret.current
    const field = inputRef.current
    if (!pending || !field) return
    pendingCaret.current = null
    field.focus()
    field.setSelectionRange(pending.start, pending.end)
  })

  const submit = () => {
    if (!trimmed) return
    onSubmit(trimmed, display, languageId)
  }

  /** Pojmy, které zvolený jazyk umí zapsat. */
  const palette = CONCEPTS.map((concept) => ({ concept, insert: language.snippets[concept.id] }))
    .filter((entry): entry is { concept: Concept; insert: string } => Boolean(entry.insert))

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

        {trimmed && !rendered.error && rendered.warnings.length > 0 ? (
          <p className="math-preview__warning" role="status">
            {rendered.warnings.join(' ')}
          </p>
        ) : null}

        <div className="math-language">
          <label className="modal__label" htmlFor="math-language">
            {t.math.language}
          </label>
          <select
            id="math-language"
            className="math-language__select"
            aria-label={t.math.language}
            value={languageId}
            onChange={(event) => setLanguageId(event.target.value as MathLanguageId)}
          >
            {mathLanguageGroups().map((group) => (
              <optgroup key={group.name} label={group.name}>
                {group.languages.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <span className={`math-language__fidelity is-${language.fidelity}`}>
            {FIDELITY_LABEL[language.fidelity]}
          </span>
        </div>
        <p className="math-language__hint">{language.hint}</p>

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
          placeholder={language.sample}
          value={tex}
          onChange={(event) => setTex(event.target.value)}
        />

        {/* U jazyků, které se překládají, je vidět výsledek překladu. Bez toho
            se nedá poznat, jestli je chyba v zápisu, nebo v převodu. */}
        {rendered.latex && languageId !== 'latex' && languageId !== 'amslatex' ? (
          <div className="math-latex">
            <button
              type="button"
              className="math-latex__toggle"
              aria-expanded={showLatex}
              onClick={() => setShowLatex((value) => !value)}
            >
              {showLatex ? t.math.hideLatex : t.math.showLatex}
            </button>
            {showLatex ? <pre className="math-latex__code">{rendered.latex}</pre> : null}
          </div>
        ) : null}

        <label className="math-display-toggle">
          <input
            type="checkbox"
            checked={display}
            onChange={(event) => setDisplay(event.target.checked)}
          />
          <span>{t.math.display}</span>
          <span className="math-display-toggle__hint">{t.math.displayHint}</span>
        </label>

        {palette.length > 0 ? (
          <div className="math-palette" aria-label={t.math.palette}>
            <div className="math-palette__row">
              {palette.map(({ concept, insert }) => (
                <PaletteButton
                  key={concept.id}
                  concept={concept}
                  insert={insert}
                  onPick={pick}
                />
              ))}
            </div>
          </div>
        ) : (
          <p className="math-help">{t.math.noPalette}</p>
        )}

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
