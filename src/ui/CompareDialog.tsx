/**
 * Porovnání s výchozí větví: čím se otevřená složka liší od main na GitHubu,
 * a co se s tím dá dělat.
 *
 * Otevře se samo po „soubory mám jinde“ -- to je přesně ta chvíle, kdy
 * uživatel neví, v jakém stavu jeho soubory proti repozitáři jsou -- a kdykoli
 * na požádání ze sekce Git.
 *
 * Kroky dole nabízí `compareSteps`. Žádný se nestane sám: odeslání vede do
 * obvyklého dialogu, kde se vybírá kam; stažení do okna, kde se vybírá
 * odkud; a vrácení souborů se potvrzuje tady, se seznamem toho, co se
 * přepíše.
 */

import { useEffect, useId, useState } from 'react'

import { compareSteps, isCommittable, parseCompare, restorable, t, type Compare } from '@/core'
import { gitMessage } from '@/git'
import { useGit } from '@/state/git-store'
import { Spinner } from './Feedback'
import { Backdrop, useEscape } from './Modal'
import { FileDiff } from './GitParts'

export function CompareDialog() {
  const { view, actions, api } = useGit()
  const labelId = useId()
  const [compare, setCompare] = useState<Compare | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [chosen, setChosen] = useState<string[] | null>(null)
  const [confirming, setConfirming] = useState(false)
  const busy = view.busy === 'restore'
  useEscape(() => {
    if (!busy) actions.closeComparison()
  })

  const folder = view.folder
  const baseName = view.probe?.defaultBranch || view.probe?.branch || 'main'
  const base = `origin/${baseName}`
  const display = (path: string) =>
    view.under && path.startsWith(`${view.under}/`) ? path.slice(view.under.length + 1) : path

  useEffect(() => {
    if (!folder) return
    let cancelled = false
    setLoadError(null)
    setConfirming(false)
    api
      .compare(folder, base)
      .then((raw) => {
        if (cancelled) return
        const parsed = parseCompare(raw)
        if (!parsed) throw new Error(t.compare.failed)
        setCompare(parsed)
        setChosen(null)
      })
      .catch((reason) => {
        if (!cancelled) setLoadError(gitMessage(reason, t.compare.failed))
      })
    return () => {
      cancelled = true
    }
  }, [api, base, folder, view.compareVersion])

  const committable = view.changes.filter(isCommittable)
  const pending = committable.length
  // Soubory, které u uživatele chybí, se k odeslání nepředvybírají: po
  // napojení složky, ve které je jen část repa, by jich byla spousta a
  // odeslání by je na GitHubu smazalo. Kdo je smazat chce, zaškrtne si je.
  const missing = committable.filter((file) => file.kind === 'deleted')
  const toSend = committable.filter((file) => file.kind !== 'deleted')
  const steps = compare ? compareSteps(compare, pending, baseName) : []
  const candidates = compare ? restorable(compare) : []
  // Výchozí je všechno, co jde vrátit; uživatel může odškrtat.
  const selected = chosen ?? candidates.map((file) => file.path)
  const toggle = (path: string) =>
    setChosen(selected.includes(path) ? selected.filter((one) => one !== path) : [...selected, path])

  return (
    <Backdrop onClose={() => (busy ? undefined : actions.closeComparison())}>
      <div className="modal repos compare" role="dialog" aria-modal="true" aria-labelledby={labelId}>
        <div className="repos__head">
          <h2 className="modal__title" id={labelId}>
            {t.compare.title(baseName)}
          </h2>
          {view.remote ? (
            <span className="git__muted">
              {view.remote.owner}/{view.remote.repo}
            </span>
          ) : null}
        </div>

        <div className="repos__body compare__body">
          {loadError ? (
            <p className="git__error" role="alert">
              {loadError}
            </p>
          ) : !compare ? (
            <Spinner label={t.compare.loading} />
          ) : (
            <>
              <p className="modal__body">{t.compare.intro(compare.branch, baseName)}</p>
              {compare.fetchError ? <p className="git__muted">{t.compare.fetchFailed(compare.fetchError)}</p> : null}

              {steps.includes('identical') ? (
                <p className="compare__ok" role="status">
                  {t.compare.identical(baseName)}
                </p>
              ) : null}

              {compare.files.length > 0 ? (
                <ul className="compare__files" aria-label={t.compare.listLabel}>
                  {compare.files.map((file) => (
                    <FileDiff
                      key={file.path}
                      file={file}
                      label={display(file.path)}
                      kindLabel={t.compare.kind[file.kind] ?? file.kind}
                      load={
                        file.kind === 'local' ? null : () => api.diff(folder ?? '', base, '', file.path)
                      }
                      note={t.compare.localOnly(baseName)}
                    />
                  ))}
                </ul>
              ) : null}
              {compare.others > 0 ? <p className="git__muted">{t.compare.others(compare.others)}</p> : null}

              {steps.some((step) => step !== 'identical') ? (
                <>
                  <h3 className="branches__heading">{t.compare.steps}</h3>
                  <div className="compare__steps">
                    {steps.includes('publish') ? (
                      <div className="git__card">
                        <h4>{t.compare.publishTitle}</h4>
                        <p>{t.compare.publishBody(pending, baseName)}</p>
                        {missing.length > 0 && toSend.length > 0 ? (
                          <p className="git__muted">{t.compare.publishSkipsMissing(missing.length)}</p>
                        ) : null}
                        <div className="git__actions">
                          <button
                            type="button"
                            className="button button--primary"
                            disabled={view.busy !== null}
                            onClick={() => {
                              actions.closeComparison()
                              // Jen chybějící soubory? Pak je to zjevně záměr --
                              // dialog odeslání na smazání stejně upozorní.
                              actions.selectOnly((toSend.length > 0 ? toSend : missing).map((file) => file.path))
                              actions.openPublish()
                            }}
                          >
                            {t.compare.publishButton}
                          </button>
                        </div>
                      </div>
                    ) : null}

                    {steps.includes('restore') ? (
                      <div className="git__card">
                        <h4>{t.compare.restoreTitle(baseName)}</h4>
                        <p>{t.compare.restoreBody}</p>
                        <ul className="compare__restore" aria-label={t.compare.restoreTitle(baseName)}>
                          {candidates.map((file) => (
                            <li key={file.path}>
                              <label className="git__method">
                                <input
                                  type="checkbox"
                                  checked={selected.includes(file.path)}
                                  disabled={busy || confirming}
                                  onChange={() => toggle(file.path)}
                                />
                                <span>{display(file.path)}</span>
                              </label>
                            </li>
                          ))}
                        </ul>
                        {confirming ? (
                          <div className="compare__confirm" role="alertdialog" aria-label={t.compare.restoreTitle(baseName)}>
                            <p>{t.compare.restoreConfirm(selected.length, baseName)}</p>
                            <div className="git__actions">
                              <button
                                type="button"
                                className="button button--danger"
                                disabled={busy}
                                onClick={() => {
                                  void actions.restoreFiles(selected).then(() => setConfirming(false))
                                }}
                              >
                                {busy ? t.compare.restoring : t.compare.restoreYes}
                              </button>
                              <button type="button" className="button" disabled={busy} onClick={() => setConfirming(false)}>
                                {t.compare.restoreNo}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="git__actions">
                            <button
                              type="button"
                              className="button"
                              disabled={selected.length === 0 || view.busy !== null}
                              onClick={() => setConfirming(true)}
                            >
                              {t.compare.restoreButton(selected.length)}
                            </button>
                          </div>
                        )}
                        {view.compareError ? (
                          <p className="modal__error" role="alert">
                            {view.compareError}
                          </p>
                        ) : null}
                      </div>
                    ) : null}

                    {steps.includes('pull') ? (
                      <div className="git__card">
                        <h4>{t.compare.pullTitle(baseName)}</h4>
                        <p>{t.compare.pullBody(compare.behind, baseName)}</p>
                        <div className="git__actions">
                          <button
                            type="button"
                            className="button"
                            disabled={view.busy !== null}
                            onClick={() => {
                              actions.closeComparison()
                              actions.openBranches('pull')
                            }}
                          >
                            {t.compare.pullButton}
                          </button>
                        </div>
                      </div>
                    ) : null}

                    {steps.includes('ahead') ? (
                      <div className="git__card git__notice">
                        <h4>{t.compare.aheadTitle(baseName)}</h4>
                        <p>{t.compare.aheadBody(compare.ahead, compare.branch, baseName)}</p>
                      </div>
                    ) : null}
                  </div>
                </>
              ) : null}
            </>
          )}
        </div>

        <div className="modal__actions">
          <button type="button" className="button" onClick={actions.closeComparison} disabled={busy}>
            {steps.includes('identical') || !compare ? t.common.close : t.compare.keep}
          </button>
        </div>
      </div>
    </Backdrop>
  )
}
