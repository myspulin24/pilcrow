/**
 * Nastavení asistenta: zjistit stav, doinstalovat, přihlásit.
 *
 * Ukazuje vždycky jen jeden krok. Chybí Claude Code? Tlačítko na instalaci
 * a nic jiného. Je, ale nepřihlášený? Přihlášení. Hotovo? Jedna řádka s tím,
 * kdo je přihlášený. Tři kroky naráz by vypadaly jako formulář, a tohle není
 * formulář -- je to cesta, kterou uživatel projde jednou a pak na ni zapomene.
 */

import { useEffect, useId, useState } from 'react'

import { t } from '@/core'
import { useAssistant } from '@/state/assistant-store'

/** Výstup instalace nebo přihlašování. Ne dekorace: tady se pozná, co selhalo. */
function Transcript({ text }: { text: string }) {
  if (!text.trim()) return null
  return (
    <details className="assistant-setup__output">
      <summary>{t.assistant.output}</summary>
      <pre>{text}</pre>
    </details>
  )
}

function InstallStep() {
  const { view, actions, api } = useAssistant()
  const [command, setCommand] = useState('')
  const busy = view.busy === 'install'

  // Příkaz zná Rust, protože se liší podle systému. Načte se, až když je
  // krok vidět -- dřív by to bylo volání navíc za nic.
  useEffect(() => {
    let cancelled = false
    void api
      .installCommand()
      .then((value) => {
        if (!cancelled) setCommand(value)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [api])

  return (
    <div className="assistant-setup__step">
      <h4>{t.assistant.stepInstall}</h4>
      <p>{t.assistant.stepInstallBody}</p>

      {command ? (
        <>
          <p className="assistant-setup__label">{t.assistant.stepInstallCommand}</p>
          <pre className="assistant-setup__command">{command}</pre>
        </>
      ) : null}
      <p className="assistant-setup__warning">{t.assistant.stepInstallWarning}</p>

      <div className="assistant-setup__actions">
        <button
          type="button"
          className="button button--primary"
          onClick={() => void actions.install()}
          disabled={busy}
        >
          {busy ? t.assistant.installing : t.assistant.install}
        </button>
      </div>
      <Transcript text={view.transcript} />
    </div>
  )
}

function LoginStep() {
  const { view, actions } = useAssistant()
  const [code, setCode] = useState('')
  const codeId = useId()
  const busy = view.busy === 'login'

  return (
    <div className="assistant-setup__step">
      <h4>{t.assistant.stepLogin}</h4>
      <p>{t.assistant.stepLoginBody}</p>

      {busy ? (
        <>
          {view.loginUrl ? (
            <>
              <p className="assistant-setup__label">{t.assistant.loginUrlHint}</p>
              {/* Adresa je vidět celá schválně: podepsat se dá jen tomu, co je vidět. */}
              <a
                className="assistant-setup__url"
                href={view.loginUrl}
                target="_blank"
                rel="noreferrer noopener"
              >
                {view.loginUrl}
              </a>
            </>
          ) : (
            <p className="assistant-setup__muted">{t.assistant.loggingIn}</p>
          )}

          <form
            className="assistant-setup__code"
            onSubmit={(event) => {
              event.preventDefault()
              void actions.sendCode(code)
              setCode('')
            }}
          >
            <label htmlFor={codeId}>{t.assistant.loginCodeLabel}</label>
            <div className="assistant-setup__code-row">
              <input
                id={codeId}
                className="assistant-setup__input"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                placeholder={t.assistant.loginCodePlaceholder}
                autoComplete="off"
                spellCheck={false}
              />
              <button type="submit" className="button button--primary" disabled={!code.trim()}>
                {t.assistant.loginCodeSend}
              </button>
            </div>
          </form>

          <div className="assistant-setup__actions">
            <button type="button" className="button" onClick={() => void actions.cancelLogin()}>
              {t.assistant.loginCancel}
            </button>
          </div>
        </>
      ) : (
        <div className="assistant-setup__actions">
          <button
            type="button"
            className="button button--primary"
            onClick={() => void actions.login()}
          >
            {t.assistant.login}
          </button>
        </div>
      )}

      <Transcript text={view.transcript} />
    </div>
  )
}

function ReadyStep() {
  const { view, actions } = useAssistant()
  const account = view.account

  return (
    <div className="assistant-setup__step">
      <p className="assistant-setup__ready">
        <span className="assistant-setup__dot" aria-hidden="true" />
        {account?.email ? t.assistant.account(account.email) : t.assistant.accountAnonymous}
        {account?.plan ? ` · ${t.assistant.plan(account.plan)}` : ''}
      </p>
      {/* Fakturace přes Console není chyba, ale je to jiná peněženka než
          předplatné -- a to má být vidět dřív než na výpisu. */}
      {account?.method === 'console' ? (
        <p className="assistant-setup__warning">{t.assistant.console}</p>
      ) : null}
      {view.probe?.version ? (
        <p className="assistant-setup__muted">{t.assistant.installed(view.probe.version)}</p>
      ) : null}

      <div className="assistant-setup__actions">
        <button type="button" className="button" onClick={() => void actions.refresh()}>
          {t.assistant.recheck}
        </button>
        <button type="button" className="button" onClick={() => void actions.logout()}>
          {t.assistant.logout}
        </button>
      </div>
    </div>
  )
}

export function AssistantSetup() {
  const { view } = useAssistant()

  if (view.step === 'unsupported') {
    return (
      <section className="assistant-setup" aria-label={t.assistant.setupTitle}>
        <div className="assistant-setup__step">
          <h4>{t.assistant.unavailable}</h4>
          <p>{t.assistant.unavailableHint}</p>
        </div>
      </section>
    )
  }

  return (
    <section className="assistant-setup" aria-label={t.assistant.setupTitle}>
      {view.busy === 'probe' ? <p className="assistant-setup__muted">{t.assistant.checking}</p> : null}
      {view.step === 'install' ? <InstallStep /> : null}
      {view.step === 'login' ? <LoginStep /> : null}
      {view.step === 'ready' ? <ReadyStep /> : null}
      {view.error ? (
        <p className="assistant-setup__error" role="alert">
          {view.error}
        </p>
      ) : null}
    </section>
  )
}
