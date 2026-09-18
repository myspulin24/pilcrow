/**
 * Panel s Claudem.
 *
 * Tři vrstvy nad sebou, a záleží na jejich pořadí:
 *
 *   1. **Souhlas.** Dokud ho uživatel nedá, panel neudělá vůbec nic --
 *      ani nezjišťuje, jestli je `claude` nainstalovaný. Pilcrow stojí
 *      na tom, že z počítače neodchází nic; tohle je jediná výjimka a musí
 *      se o ni říct.
 *   2. **Nastavení.** Doinstalovat a přihlásit, jeden krok po druhém.
 *   3. **Rozhovor.** Teprve když je hotovo.
 */

import { useEffect, useRef, useState } from 'react'

import {
  ASSISTANT_MODELS,
  LEGACY_ASSISTANT_MODELS,
  assistantModelLabel,
  renderMarkdown,
  t,
  type AssistantMessage,
} from '@/core'
import { useAssistant } from '@/state/assistant-store'
import { useAppState } from '@/state/store'

import { AssistantSetup } from './AssistantSetup'

function Bubble({ message }: { message: AssistantMessage }) {
  const mine = message.role === 'user'
  const [copied, setCopied] = useState(false)

  // Systémový pokyn Claudovi říká, ať návrhy píše tak, aby se daly zkopírovat.
  // Bylo by divné to slíbit a pak nechat uživatele označovat text myší.
  const copy = () => {
    void navigator.clipboard?.writeText(message.text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div className={`assistant-msg assistant-msg--${mine ? 'user' : 'claude'}`}>
      <span className="assistant-msg__who">
        {mine ? t.assistant.you : t.assistant.claude}
        {!mine && message.text && !message.streaming ? (
          <button type="button" className="assistant-msg__copy" onClick={copy}>
            {copied ? t.assistant.copied : t.assistant.copy}
          </button>
        ) : null}
      </span>
      {mine ? (
        <p className="assistant-msg__text">{message.text}</p>
      ) : (
        // Claude odpovídá Markdownem, včetně bloků kódu s návrhem úpravy.
        // `renderMarkdown` je ten samý, který kreslí náhled poznámky: escapuje
        // text a kontroluje schéma každé adresy.
        <div
          className="assistant-msg__text preview"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: renderMarkdown(message.text) }}
        />
      )}
      {message.streaming ? <span className="assistant-msg__caret" aria-hidden="true" /> : null}
      {message.error ? (
        <p className="assistant-msg__error" role="alert">
          {message.error}
        </p>
      ) : null}
    </div>
  )
}

function Conversation() {
  const { view, actions } = useAssistant()
  const { editor, parsed } = useAppState()
  const [question, setQuestion] = useState('')
  const endRef = useRef<HTMLDivElement | null>(null)
  const busy = view.busy === 'ask'

  // Odpověď přitéká po kouscích, takže posouvat se musí při každé změně,
  // ne jen při nové zprávě.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [view.messages])

  const send = () => {
    if (!question.trim() || busy) return
    void actions.ask(question)
    setQuestion('')
  }

  return (
    <>
      <div className="assistant__context">
        {editor
          ? t.assistant.contextLine(parsed?.frontmatter.title || editor.path)
          : t.assistant.emptyNoNote}
        {view.truncated ? <span className="assistant__truncated">{t.assistant.truncated}</span> : null}
      </div>

      <div className="assistant__thread">
        {view.messages.length === 0 ? (
          <p className="assistant__empty">{editor ? t.assistant.empty : t.assistant.emptyNoNote}</p>
        ) : (
          view.messages.map((message, index) => <Bubble key={index} message={message} />)
        )}
        <div ref={endRef} />
      </div>

      <form
        className="assistant__composer"
        onSubmit={(event) => {
          event.preventDefault()
          send()
        }}
      >
        <textarea
          className="assistant__input"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder={t.assistant.placeholder}
          rows={3}
          disabled={!editor}
          // Enter odešle, Shift+Enter dělá nový řádek -- jako všude jinde,
          // kde se píše do chatu.
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              send()
            }
          }}
        />
        <div className="assistant__composer-row">
          <button type="button" className="button button--ghost" onClick={actions.reset}>
            {t.assistant.clear}
          </button>
          {busy ? (
            <button type="button" className="button" onClick={() => void actions.stop()}>
              {t.assistant.stop}
            </button>
          ) : (
            <button
              type="submit"
              className="button button--primary"
              disabled={!question.trim() || !editor}
            >
              {t.assistant.send}
            </button>
          )}
        </div>
      </form>
    </>
  )
}

/** Souhlas. Jediná obrazovka, dokud ho uživatel nedá. */
function Consent() {
  const { actions } = useAssistant()

  return (
    <div className="assistant__consent">
      <h4>{t.assistant.consentTitle}</h4>
      <p>{t.assistant.consentBody}</p>
      <p>{t.assistant.consentAccount}</p>
      <button
        type="button"
        className="button button--primary"
        onClick={() => void actions.setEnabled(true)}
      >
        {t.assistant.consentEnable}
      </button>
    </div>
  )
}

export function AssistantPanel() {
  const { view, actions } = useAssistant()

  // Uložený model, který v nabídce není. Viz poznámka u `select` níž.
  const unlisted =
    view.model && ![...ASSISTANT_MODELS, ...LEGACY_ASSISTANT_MODELS].some((m) => m.id === view.model)
      ? view.model
      : ''

  if (!view.open) return null

  return (
    <aside className="assistant" aria-label={t.assistant.title}>
      <header className="assistant__head">
        <h3 className="assistant__title">{t.assistant.title}</h3>

        {view.enabled ? (
          <>
            <label className="assistant__model">
              <span className="assistant__sr">{t.assistant.model}</span>
              <select
                className="assistant__select"
                value={view.model}
                onChange={(event) => void actions.setModel(event.target.value)}
                title={t.assistant.modelHint}
              >
                {/* Výchozí je první a nemá jméno modelu schválně: nechá
                    rozhodnout Claude Code, takže funguje i s modelem, o kterém
                    tenhle seznam ještě neví. */}
                <option value="">{t.assistant.modelDefault}</option>
                <optgroup label={t.assistant.modelCurrent}>
                  {ASSISTANT_MODELS.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.label}
                    </option>
                  ))}
                </optgroup>
                <optgroup label={t.assistant.modelLegacy}>
                  {LEGACY_ASSISTANT_MODELS.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.label}
                    </option>
                  ))}
                </optgroup>
                {/* Uložený model, který v seznamu není (starší volba, jiná
                    verze Claude Code). Bez téhle položky by `select` tiše
                    přeskočil na první možnost a změnil volbu za uživatele. */}
                {unlisted ? <option value={unlisted}>{assistantModelLabel(unlisted)}</option> : null}
              </select>
            </label>
            <button
              type="button"
              className="button button--ghost"
              aria-expanded={view.setupOpen}
              onClick={() => actions.setSetupOpen(!view.setupOpen)}
            >
              {t.assistant.setupShort}
            </button>
          </>
        ) : null}

        <button
          type="button"
          className="button button--ghost"
          onClick={actions.close}
          aria-label={t.assistant.close}
        >
          ×
        </button>
      </header>

      {/* Souhlas dává smysl jen tam, kde je s čím souhlasit. V prohlížeči se
          `claude` spustit nedá, takže se místo přepínače rovnou řekne proč. */}
      {view.step === 'unsupported' ? (
        <AssistantSetup />
      ) : !view.enabled ? (
        <Consent />
      ) : (
        <>
          {view.setupOpen ? <AssistantSetup /> : null}
          {view.step === 'ready' ? (
            <Conversation />
          ) : view.setupOpen ? null : (
            <p className="assistant__empty">{t.assistant.checking}</p>
          )}
          <footer className="assistant__foot">
            <button
              type="button"
              className="button button--ghost"
              onClick={() => void actions.setEnabled(false)}
              title={t.assistant.consentOffHint}
            >
              {t.assistant.consentOff}
            </button>
          </footer>
        </>
      )}
    </aside>
  )
}
