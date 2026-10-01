/**
 * Okno feedbacku a ukazování na prvek.
 *
 * Shora dolů: kde uživatel v aplikaci je (zachycené samo), označený prvek,
 * příloha, druh, zpráva, kdo píše -- a pod tím „Co přesně odejde“, výpis
 * všeho, co Rust pošle. Nic dalšího neodchází.
 *
 * Ukazování na prvek okno schová a zachytí první klik v aplikaci dřív, než
 * k němu dojde: tlačítko, na které uživatel ukáže, se nezmáčkne.
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react'

import { draftProblem, FEEDBACK_ACCEPT, FEEDBACK_KINDS, formatFileSize, t, type FeedbackElement } from '@/core'
import { describeElement, meaningfulTarget } from '@/lib/element-target'
import { useFeedback } from '@/state/feedback-store'
import { Backdrop, useEscape } from './Modal'

/** Události, které se během ukazování k aplikaci nedostanou. */
const SWALLOWED = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'dblclick', 'contextmenu', 'auxclick'] as const

function ElementPicker({ onPick }: { onPick: (element: FeedbackElement | null) => void }) {
  const [box, setBox] = useState<{ top: number; left: number; width: number; height: number } | null>(null)

  useEffect(() => {
    const own = (target: EventTarget | null) => target instanceof Element && target.closest('[data-feedback-picker]') !== null
    const swallow = (event: Event) => {
      if (own(event.target)) return
      event.preventDefault()
      event.stopPropagation()
    }
    const hover = (event: MouseEvent) => {
      if (own(event.target) || !(event.target instanceof Element)) return
      const rect = meaningfulTarget(event.target).getBoundingClientRect()
      setBox({ top: rect.top, left: rect.left, width: rect.width, height: rect.height })
    }
    const click = (event: MouseEvent) => {
      if (own(event.target)) return
      event.preventDefault()
      event.stopPropagation()
      if (event.target instanceof Element) onPick(describeElement(event.target))
    }
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      onPick(null)
    }

    for (const type of SWALLOWED) document.addEventListener(type, swallow, true)
    document.addEventListener('mousemove', hover, true)
    document.addEventListener('click', click, true)
    window.addEventListener('keydown', key, true)
    return () => {
      for (const type of SWALLOWED) document.removeEventListener(type, swallow, true)
      document.removeEventListener('mousemove', hover, true)
      document.removeEventListener('click', click, true)
      window.removeEventListener('keydown', key, true)
    }
  }, [onPick])

  return (
    <>
      <div className="feedback-picker__banner" data-feedback-picker role="status">
        <span>{t.feedback.picking}</span>
        <button type="button" className="button" onClick={() => onPick(null)}>
          {t.feedback.pickCancel}
        </button>
      </div>
      {box ? (
        <div
          className="feedback-picker__box"
          aria-hidden="true"
          style={{ top: box.top, left: box.left, width: box.width, height: box.height }}
        />
      ) : null}
    </>
  )
}

function Preview() {
  const { view } = useFeedback()
  const { draft, status, location } = view
  const rows: Array<[string, string]> = [
    [t.feedback.previewKind, draft.kind ? (t.feedback.kinds[draft.kind] ?? draft.kind) : t.feedback.previewNone],
    [t.feedback.previewMessage, t.feedback.previewChars(draft.message.trim().length)],
    [t.feedback.previewWhere, location || t.feedback.previewNone],
    [t.feedback.previewElement, draft.element?.label ?? t.feedback.previewNone],
    [t.feedback.previewVersion, status?.version || t.feedback.previewNone],
    [t.feedback.previewOs, status?.os || t.feedback.previewNone],
    [
      t.feedback.previewFrom,
      draft.anonymous || (!draft.name.trim() && !draft.email.trim())
        ? t.feedback.previewAnonymous
        : [draft.name.trim(), draft.email.trim() && `<${draft.email.trim()}>`].filter(Boolean).join(' '),
    ],
    [
      t.feedback.previewAttachment,
      draft.file ? `${draft.file.name} (${formatFileSize(draft.file.size)})` : t.feedback.previewNone,
    ],
  ]
  return (
    <details className="feedback__preview">
      <summary>{t.feedback.preview}</summary>
      <dl className="settings__facts">
        {rows.map(([label, value]) => (
          <div className="settings__fact" key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <p className="settings__hint">{t.feedback.previewNoContent}</p>
      {status?.host ? <p className="settings__hint">{t.feedback.previewTo(status.host)}</p> : null}
    </details>
  )
}

function Form() {
  const { view, actions } = useFeedback()
  const { draft } = view
  const labelId = useId()
  const fileRef = useRef<HTMLInputElement>(null)
  const messageRef = useRef<HTMLTextAreaElement>(null)
  const [editingAuthor, setEditingAuthor] = useState(false)
  const available = view.status?.available ?? false
  const problem = draftProblem(draft)

  useEffect(() => {
    messageRef.current?.focus()
  }, [])

  return (
    <>
      <div className="feedback__context">
        <span className="feedback__context-label">📍 {t.feedback.where}</span>
        <span>{view.location}</span>
        {view.status?.version ? (
          <span className="feedback__context-meta">
            Pilcrow {view.status.version} · {view.status.os}
          </span>
        ) : null}
      </div>

      {draft.element ? (
        <div className="feedback__element" aria-label={t.feedback.element}>
          <span>🎯 {draft.element.label}</span>
          <button
            type="button"
            className="ws-icon-button"
            aria-label={t.feedback.elementRemove}
            onClick={() => actions.edit({ element: null })}
          >
            ×
          </button>
        </div>
      ) : null}
      <div>
        <button type="button" className="button" title={t.feedback.pickHint} onClick={actions.startPicking}>
          🎯 {t.feedback.pick}
        </button>
      </div>

      {draft.file ? (
        <div className="feedback__file">
          <span>
            📎 {draft.file.name} <span className="git__muted">({formatFileSize(draft.file.size)})</span>
          </span>
          <button
            type="button"
            className="ws-icon-button"
            aria-label={t.feedback.attachRemove(draft.file.name)}
            onClick={actions.removeAttachment}
          >
            ×
          </button>
        </div>
      ) : (
        <button type="button" className="feedback__drop" onClick={() => fileRef.current?.click()}>
          <span className="feedback__drop-title">
            📎 {t.feedback.attach} <span className="git__muted">({t.feedback.attachTypes})</span>
          </span>
          <span className="feedback__drop-hint">{t.feedback.attachHow}</span>
          <span className="feedback__drop-hint">{t.feedback.attachScreenshot}</span>
        </button>
      )}
      <input
        ref={fileRef}
        type="file"
        className="feedback__file-input"
        accept={FEEDBACK_ACCEPT}
        aria-label={t.feedback.attach}
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) void actions.attach(file)
        }}
      />
      <p className="feedback__privacy">⚠ {t.feedback.privacy}</p>

      <div className="feedback__kinds" role="radiogroup" aria-label={t.feedback.kind}>
        {FEEDBACK_KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            role="radio"
            aria-checked={draft.kind === kind}
            className={`feedback__kind ${draft.kind === kind ? 'is-selected' : ''}`}
            onClick={() => actions.edit({ kind })}
          >
            {kind === 'bug' ? '🐛' : kind === 'change' ? '🔧' : '✨'} {t.feedback.kinds[kind]}
          </button>
        ))}
      </div>

      <textarea
        ref={messageRef}
        id={`${labelId}-message`}
        className="modal__input feedback__message"
        aria-label={t.feedback.message}
        rows={5}
        placeholder={t.feedback.placeholder}
        value={draft.message}
        onChange={(event) => actions.edit({ message: event.target.value })}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault()
            void actions.send()
          }
        }}
      />

      <label className="git__method">
        <input
          type="checkbox"
          checked={draft.anonymous}
          onChange={(event) => actions.edit({ anonymous: event.target.checked })}
        />
        <span>{t.feedback.anonymous}</span>
      </label>
      {!draft.anonymous ? (
        editingAuthor ? (
          <div className="feedback__author-edit">
            <input
              className="modal__input"
              aria-label={t.feedback.name}
              placeholder={t.feedback.name}
              value={draft.name}
              onChange={(event) => actions.edit({ name: event.target.value })}
            />
            <input
              className="modal__input"
              type="email"
              aria-label={t.feedback.email}
              placeholder={t.feedback.email}
              value={draft.email}
              onChange={(event) => actions.edit({ email: event.target.value })}
            />
          </div>
        ) : (
          <p className="feedback__author">
            <span>
              {t.feedback.author}: <strong>{draft.name.trim() || t.feedback.nobody}</strong>
              {draft.email.trim() ? <span className="git__muted"> &lt;{draft.email.trim()}&gt;</span> : null}
            </span>
            <button type="button" className="workspace__link" onClick={() => setEditingAuthor(true)}>
              {t.feedback.change}
            </button>
          </p>
        )
      ) : null}

      <Preview />

      {!available && view.status ? (
        <p className="git__muted" role="note">
          {view.status.error || t.feedback.unavailable}
        </p>
      ) : null}
      {view.error ? (
        <p className="modal__error" role="alert">
          {view.error}
        </p>
      ) : null}

      <div className="modal__actions">
        <button
          type="button"
          className="button button--primary"
          disabled={!available || view.sending || problem === 'kind' || problem === 'message'}
          onClick={() => void actions.send()}
        >
          {view.sending ? t.feedback.sending : t.feedback.send}
        </button>
      </div>
    </>
  )
}

function Thanks() {
  const { view, actions } = useFeedback()
  return (
    <>
      <p className="compare__ok" role="status">
        {t.feedback.thanks}
      </p>
      {view.sentId ? <p className="git__muted">{t.feedback.thanksId(view.sentId)}</p> : null}
      <div className="modal__actions">
        <button type="button" className="button" onClick={actions.another}>
          {t.feedback.another}
        </button>
        <button type="button" className="button button--primary" onClick={actions.close}>
          {t.feedback.close}
        </button>
      </div>
    </>
  )
}

export function FeedbackDialog() {
  const { view, actions } = useFeedback()
  const finishPicking = actions.finishPicking
  const onPick = useCallback((element: FeedbackElement | null) => finishPicking(element), [finishPicking])

  if (!view.open) return null
  if (view.picking) return <ElementPicker onPick={onPick} />
  return <OpenDialog />
}

/**
 * Otevřené okno. Zvlášť kvůli `useEscape`: ten zachytí Escape pro celé okno
 * aplikace, a smí to dělat jen tehdy, když je feedback opravdu otevřený.
 */
function OpenDialog() {
  const { view, actions } = useFeedback()
  const labelId = useId()
  useEscape(actions.close)

  return (
    <Backdrop onClose={actions.close}>
      <div
        className="modal feedback"
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelId}
        onPaste={(event) => {
          // Snímek ze schránky (Win+Shift+S, pak Ctrl+V) rovnou jako příloha.
          // Text se vkládá dál normálně do zprávy.
          const file = event.clipboardData.files[0]
          if (!file || view.sentId) return
          event.preventDefault()
          void actions.attach(file)
        }}
      >
        <header className="feedback__head">
          <h2 className="modal__title" id={labelId}>
            {t.feedback.title}
          </h2>
          <button type="button" className="ws-icon-button" aria-label={t.feedback.close} onClick={actions.close}>
            ×
          </button>
        </header>
        {view.sentId ? <Thanks /> : <Form />}
      </div>
    </Backdrop>
  )
}
