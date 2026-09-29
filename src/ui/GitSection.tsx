/**
 * Sekce Git v levém sloupci: změny v otevřené složce, odeslání na větev,
 * a průběh běhu Actions po pushi.
 *
 * Ukazuje se jen u složky, která leží v repozitáři. Stejně jako u asistenta
 * vždycky jen jeden krok: chybí git? Jak ho nainstalovat, a nic víc. Je,
 * ale repo nemá remote? Jen to. Teprve když je všechno, ukáže se seznam změn.
 *
 * GitHub CLI je bokem: bez něj commit a push fungují, jen se nesledují běhy
 * a nezakládá PR -- a sekce to řekne, místo aby ta tlačítka schovala.
 */

import { useEffect, useId, useState } from 'react'

import {
  activeFolder,
  clockTime,
  folderLabel,
  currentPublishStep,
  isCommittable,
  defaultMergeMethod,
  existingTargets,
  isValidBranchName,
  parseBranches,
  mergeBlocker,
  outcome,
  overallOutcome,
  SECTION_GIT,
  SECTION_RUNS,
  syncAction,
  suggestBranch,
  suggestMessage,
  suggestPrBody,
  suggestPrTitle,
  t,
  type MergeMethod,
  type Outcome,
  type WorkflowJob,
  type WorkflowRun,
} from '@/core'
import { gitMessage } from '@/git'
import { useGit } from '@/state/git-store'
import { useAppState } from '@/state/store'
import { BranchDialog } from './BranchDialog'
import { CompareDialog } from './CompareDialog'
import { Spinner } from './Feedback'
import { Transcript } from './GitParts'
import { SectionResize } from './SectionResize'
import { Backdrop, useEscape } from './Modal'
import { Section } from './Section'

// -- drobnosti --------------------------------------------------------------

function GitIcon() {
  return (
    <svg className="ws-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <circle cx="4" cy="3" r="1.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="4" cy="13" r="1.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="12" cy="6" r="1.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M4 4.6v6.8M12 7.6c0 2.4-2.5 3-5 3.4" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  )
}

/** Semafor: jeden znak a barva podle stavu, jméno stavu pro čtečku. */
function State({ outcome: state, small = false }: { outcome: Outcome; small?: boolean }) {
  const glyph: Record<Outcome, string> = {
    queued: '○',
    running: '◐',
    success: '✓',
    failure: '✕',
    cancelled: '⊘',
    skipped: '–',
    unknown: '?',
  }
  return (
    <span
      className={`git__state git__state--${state} ${small ? 'git__state--small' : ''}`}
      role="img"
      aria-label={t.git.outcome[state] ?? state}
    >
      {glyph[state]}
    </span>
  )
}

/** Ikona větve: dvě koleje, které se rozcházejí. */
function BranchIcon() {
  return (
    <svg className="git__branch-icon" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
      <circle cx="4.5" cy="3" r="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="4.5" cy="13" r="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="11.5" cy="4.5" r="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M4.5 4.5v7M11.5 6c0 3-3.5 3-6.2 5.6" fill="none" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  )
}

function SetupCard({ title, body, command }: { title: string; body: string; command?: string }) {
  const { actions, view } = useGit()
  return (
    <div className="git__card git__setup">
      <h4>{title}</h4>
      <p>{body}</p>
      {command ? <pre className="git__command">{command}</pre> : null}
      <div className="git__actions">
        <button type="button" className="button" onClick={() => void actions.refresh()} disabled={view.busy === 'probe'}>
          {t.git.recheck}
        </button>
      </div>
    </div>
  )
}

// -- GitHub CLI -------------------------------------------------------------

function GhNotice() {
  const { view, actions } = useGit()
  if (view.gh !== 'install' && view.gh !== 'login') return null
  const busy = view.busy === 'login'

  if (view.gh === 'install') {
    return (
      <div className="git__card git__notice">
        <h4>{t.git.ghInstall}</h4>
        <p>{t.git.ghInstallBody}</p>
        {view.probe?.ghInstallCommand ? <pre className="git__command">{view.probe.ghInstallCommand}</pre> : null}
      </div>
    )
  }

  return (
    <div className="git__card git__notice">
      <h4>{t.git.ghLogin}</h4>
      <p>{t.git.ghLoginBody}</p>
      {busy ? (
        <>
          {view.deviceCode ? (
            <>
              <p className="git__label">{t.git.deviceCodeHint}</p>
              <p className="git__device-code" aria-label={t.git.deviceCodeLabel}>
                {view.deviceCode}
              </p>
            </>
          ) : (
            <p className="git__muted">{t.git.loggingIn}</p>
          )}
          <div className="git__actions">
            <button type="button" className="button" onClick={() => void actions.cancelLogin()}>
              {t.git.loginCancel}
            </button>
          </div>
        </>
      ) : (
        <div className="git__actions">
          <button type="button" className="button button--primary" onClick={() => void actions.login()}>
            {t.git.login}
          </button>
        </div>
      )}
      <Transcript text={busy ? view.transcript : ''} />
    </div>
  )
}

// -- změny ------------------------------------------------------------------

/**
 * Jak je složka na tom proti GitHubu.
 *
 * Mlčí, když je všechno aktuální -- stav, který platí skoro pořád, si řádek
 * v panelu nezaslouží. Ozve se jen tehdy, když je co stáhnout nebo když
 * stáhnout nejde a je fér říct proč.
 */
function SyncNotice() {
  const { view, actions } = useGit()
  const action = syncAction(view.sync)

  if (view.busy === 'pull') {
    return (
      <div className="git__sync" role="status">
        <Spinner label={t.git.pulling} />
      </div>
    )
  }
  if (view.pulled && action === 'current') {
    return <p className="git__sync git__muted">{t.git.pulled}</p>
  }
  if (action === 'current' || action === 'unknown' || action === 'detached') return null

  return (
    <div className="git__sync">
      {action === 'pull' ? (
        <>
          <span className="git__muted">{t.git.behind(view.sync?.behind ?? 0)}</span>
          {/* Neptat se = nestahovat. Okno ukáže, odkud se stahuje, a nechá
              vybrat i jinou větev. */}
          <button
            type="button"
            className="button button--primary"
            title={t.git.pullNowHint}
            disabled={view.busy !== null}
            onClick={() => actions.openBranches('pull')}
          >
            {t.git.pullNow}
          </button>
        </>
      ) : null}
      {action === 'dirty' ? <span className="git__muted">{t.git.syncDirty}</span> : null}
      {action === 'ahead' ? <span className="git__muted">{t.git.syncAhead(view.sync?.ahead ?? 0)}</span> : null}
      {action === 'diverged' ? <span className="git__muted">{t.git.syncDiverged}</span> : null}
    </div>
  )
}

function Changes() {
  const { view, actions } = useGit()
  const publishing = view.busy === 'publish' || view.busy === 'push'
  const touched = new Set(view.touched)
  const display = (path: string) =>
    view.under && path.startsWith(`${view.under}/`) ? path.slice(view.under.length + 1) : path

  if (view.changes.length === 0 && !publishing) {
    return <p className="workspace__note">{t.git.noChanges}</p>
  }

  return (
    <div className="git__changes-block">
      {view.changes.length > 0 ? (
        <>
          <div className="git__changes-head">
            <span className="git__muted">{t.git.changes(view.changes.length)}</span>
            <span className="git__changes-tools">
              <button type="button" className="workspace__link" onClick={actions.selectAll} disabled={publishing}>
                {t.git.selectAll}
              </button>
              <button type="button" className="workspace__link" onClick={actions.selectNone} disabled={publishing}>
                {t.git.selectNone}
              </button>
            </span>
          </div>
          <ul className="git__changes" aria-label={t.git.changesLabel}>
            {view.changes.map((file) => {
              const committable = isCommittable(file)
              const own = touched.has(file.path)
              return (
                <li key={file.path} className={`git__file ${own ? 'git__file--own' : ''}`}>
                  <label className="git__file-label" title={file.path}>
                    <input
                      type="checkbox"
                      checked={view.selected.includes(file.path)}
                      disabled={!committable || publishing}
                      onChange={() => actions.toggleFile(file.path)}
                    />
                    <span className="git__file-name">{display(file.path)}</span>
                    <span className={`git__badge git__badge--${file.kind}`}>{t.git.kind[file.kind] ?? file.kind}</span>
                  </label>
                  <span className={`git__hint ${own ? 'git__hint--own' : ''}`}>
                    {!committable ? t.git.conflictedHint : own ? t.git.touchedHint : t.git.foreignHint}
                  </span>
                </li>
              )
            })}
          </ul>
        </>
      ) : null}

      {publishing ? (
        <div className="git__progress" role="status">
          <Spinner label={t.git.step(currentPublishStep(view.transcript) ?? t.git.publishing)} />
          <button type="button" className="button" onClick={() => void actions.cancel()}>
            {t.git.cancel}
          </button>
        </div>
      ) : (
        <div className="git__actions">
          <button
            type="button"
            className="button button--primary"
            disabled={view.selected.length === 0}
            onClick={() => actions.openPublish()}
          >
            {t.git.publish}
          </button>
        </div>
      )}
      <Transcript text={publishing || view.error ? view.transcript : ''} />
    </div>
  )
}

/** Odkaz na porovnání s výchozí větví, pod seznamem změn. */
function CompareLink() {
  const { view, actions } = useGit()
  const base = view.probe?.defaultBranch || view.probe?.branch || ''
  if (!base) return null
  return (
    <div className="git__tools">
      <button
        type="button"
        className="workspace__link"
        title={t.git.compareLinkHint}
        disabled={view.busy !== null}
        onClick={actions.openComparison}
      >
        {t.git.compareLink(base)}
      </button>
    </div>
  )
}

// -- po odeslání ------------------------------------------------------------

function PublishedCard() {
  const { view, actions } = useGit()
  const published = view.published
  // Karta patří i tam, kde se v tomhle sezení nic neodesílalo: otevřený
  // pull request pro aktuální větev může pocházet z minulého spuštění nebo
  // z prohlížeče, a sloučit se má dát i tak.
  if (!published && !view.pr && !view.mergedNumber) return null
  if (view.busy === 'publish' || view.busy === 'push') return null

  const pushedLabel = (entry: NonNullable<typeof published>) =>
    !entry.pushed
      ? t.git.pushFailed(entry.branch)
      : entry.direct
        ? t.git.publishedDirect(entry.branch)
        : t.git.published(entry.branch)
  const label = published ? pushedLabel(published) : t.git.prOpenState(view.pr?.number ?? 0)
  // Commit rovnou do výchozí větve nemá co slučovat; nabízet PR by lhalo.
  const offersPr = !!published?.pushed && !published.direct

  return (
    <div className="git__card" aria-label={label}>
      {published ? (
        <p className="git__ready">
          <State outcome={published.pushed ? 'success' : 'failure'} />
          <span>{pushedLabel(published)}</span>
        </p>
      ) : null}
      {view.mergedNumber ? (
        <p className="git__ready">
          <State outcome="success" />
          <span>{t.git.merged(view.mergedNumber)}</span>
        </p>
      ) : view.pr ? (
        <p className="git__ready">
          <State outcome="success" />
          <span>{t.git.prOpenState(view.pr.number)}</span>
        </p>
      ) : view.prUrl ? (
        <p className="git__ready">
          <State outcome="success" />
          <span>{t.git.prReady(view.prUrl)}</span>
        </p>
      ) : null}
      {/* Proč sloučit nejde, když nejde -- ať se nehádá s šedým tlačítkem. */}
      {view.pr && mergeBlocker(view.pr) ? (
        <p className="git__muted">{t.git.mergeBlocked[mergeBlocker(view.pr) ?? 'none']}</p>
      ) : null}
      <div className="git__actions">
        {view.pr && !mergeBlocker(view.pr) ? (
          <button type="button" className="button button--primary" onClick={actions.openMerge}>
            {t.git.merge}
          </button>
        ) : null}
        {view.pr?.url || view.prUrl ? (
          <button
            type="button"
            className="button"
            onClick={() => void actions.openUrl(view.pr?.url ?? view.prUrl!)}
          >
            {t.git.prOpenInBrowser}
          </button>
        ) : null}
        {offersPr && view.gh === 'ready' && !view.prUrl && !view.pr && !view.mergedNumber ? (
          <button type="button" className="button button--primary" onClick={actions.openPr}>
            {t.git.openPr}
          </button>
        ) : null}
        {offersPr && view.gh !== 'ready' && view.gh !== 'not-github' ? (
          <button
            type="button"
            className="button button--primary"
            title={t.git.openPrHint}
            onClick={() => void actions.openCompare()}
          >
            {t.git.openPr}
          </button>
        ) : null}
        {published && !published.pushed && published.retryable ? (
          <button type="button" className="button button--primary" onClick={() => void actions.retryPush()}>
            {t.git.retryPush}
          </button>
        ) : null}
        <button type="button" className="button" onClick={actions.dismissPublished}>
          {t.git.dismiss}
        </button>
      </div>
    </div>
  )
}

function Job({ job }: { job: WorkflowJob }) {
  return (
    <div className="git__job">
      <div className="git__job-head">
        <State outcome={outcome(job.status, job.conclusion)} small />
        <span>{job.name}</span>
      </div>
      {job.steps.length > 0 ? (
        <ol className="git__steps" aria-label={job.name}>
          {job.steps.map((step) => {
            const state = outcome(step.status, step.conclusion)
            return (
              <li key={step.number} className={`git__step git__step--${state}`}>
                <State outcome={state} small />
                <span>{step.name}</span>
              </li>
            )
          })}
        </ol>
      ) : null}
    </div>
  )
}

function Run({ run, jobs }: { run: WorkflowRun; jobs: WorkflowJob[] }) {
  const { actions } = useGit()
  return (
    <div className="git__run">
      <div className="git__run-head">
        <State outcome={outcome(run.status, run.conclusion)} />
        <strong>{run.name}</strong>
        <span className="git__muted">{t.git.runNumber(run.runNumber)}</span>
        {run.url ? (
          <button type="button" className="workspace__link" onClick={() => void actions.openUrl(run.url)}>
            {t.git.ciOpen}
          </button>
        ) : null}
      </div>
      {jobs.map((job) => (
        <Job key={job.id} job={job} />
      ))}
    </div>
  )
}

function CiCard() {
  const { view, actions } = useGit()
  if (!view.published?.pushed || view.gh !== 'ready') return null
  if (view.watching === 'idle' && view.runs.length === 0) return null
  const names = view.workflows.map((workflow) => workflow.name).join(', ')

  return (
    <div className="git__card" aria-label={t.git.ciTitle}>
      <h4 className="git__card-title">
        <span>{t.git.ciTitle}</span>
        {view.runs.length > 0 ? <State outcome={overallOutcome(view.runs)} /> : null}
      </h4>
      {view.watching === 'waiting' ? <Spinner label={t.git.ciWaiting} /> : null}
      {view.watching === 'none' ? (
        <>
          {/* Tohle jde vědět hned, ne až po třech minutách čekání. */}
          <p className="git__muted">{t.git.ciNoWorkflows}</p>
          <div className="git__actions">
            <button type="button" className="button" onClick={() => void actions.openActions()}>
              {t.git.ciOpenActions}
            </button>
          </div>
        </>
      ) : null}
      {view.watching === 'timeout' ? (
        <>
          <p className="git__muted">{names ? t.git.ciNoRunForBranch(names) : t.git.ciTimeout}</p>
          <div className="git__actions">
            <button type="button" className="button" onClick={() => void actions.openActions()}>
              {t.git.ciOpenActions}
            </button>
          </div>
        </>
      ) : null}
      {view.runs.map((run) => (
        <Run key={run.id} run={run} jobs={view.jobs[run.id] ?? []} />
      ))}
    </div>
  )
}

function Recent() {
  const { view, actions } = useGit()
  if (view.gh !== 'ready') return null

  return (
    <details
      className="git__recent"
      onToggle={(event) => {
        if (event.currentTarget.open && view.recent === null) void actions.loadRecent()
      }}
    >
      <summary>{t.git.recent}</summary>
      {view.recentError ? <p className="git__muted">{view.recentError}</p> : null}
      {view.recent && view.recent.length === 0 && !view.recentError ? (
        <p className="git__muted">{t.git.recentEmpty}</p>
      ) : null}
      {view.recent && view.recent.length > 0 ? (
        <>
        <ul className="git__recent-list">
          {view.recent.map((run) => (
            <li key={run.id} className="git__recent-item">
              <State outcome={outcome(run.status, run.conclusion)} small />
              <span className="git__recent-name">{run.name}</span>
              <span className="git__muted">{run.branch}</span>
              {run.url ? (
                <button type="button" className="workspace__link" onClick={() => void actions.openUrl(run.url)}>
                  {t.git.ciOpen}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
        <SectionResize sectionKey={SECTION_RUNS} label={t.git.recent} />
        </>
      ) : null}
    </details>
  )
}

// -- dialog odeslání --------------------------------------------------------

/** Kam odeslat: nová větev, větev, která už je, nebo rovnou výchozí. */
type Target = 'new' | 'existing' | 'default'

/**
 * Větve, na které se dá odeslat „do existující“. Načtou se až tehdy, když si
 * je uživatel vybere -- načtení znamená fetch, a kdo jde na novou větev,
 * nemá na něj čekat.
 */
function useExistingTargets(enabled: boolean, base: string) {
  const { view, api } = useGit()
  const [branches, setBranches] = useState<string[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const folder = view.folder

  useEffect(() => {
    if (!enabled || !folder || branches !== null) return
    let cancelled = false
    api
      .branches(folder)
      .then((raw) => {
        if (cancelled) return
        const list = parseBranches(raw)
        // Výchozí větev tady být nesmí, i když ji klon nezná -- má vlastní
        // volbu s varováním.
        const names = existingTargets(list, list.defaultBranch || base).map((branch) => branch.name)
        setBranches(names.filter((name) => name !== base))
      })
      .catch((reason) => {
        if (!cancelled) {
          setBranches([])
          setError(gitMessage(reason, t.branches.failed))
        }
      })
    return () => {
      cancelled = true
    }
  }, [api, base, branches, enabled, folder])

  return { branches, error }
}

function PublishDialog() {
  const { view, actions } = useGit()
  const files = view.changes.filter((file) => view.selected.includes(file.path))
  const deletions = files.filter((file) => file.kind === 'deleted').length
  const current = view.probe?.branch ?? ''
  const base = view.probe?.defaultBranch || current
  const preset = view.publishPreset
  const [message, setMessage] = useState(() => suggestMessage(files))
  const [branch, setBranch] = useState(() =>
    preset?.mode === 'new' && preset.branch ? preset.branch : suggestBranch(new Date()),
  )
  const [target, setTarget] = useState<Target>(() =>
    preset?.mode === 'existing' ? (preset.branch === base ? 'default' : 'existing') : 'new',
  )
  const [existing, setExisting] = useState(() =>
    preset?.mode === 'existing' && preset.branch !== base ? preset.branch : current !== base ? current : '',
  )
  const [directOk, setDirectOk] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const labelId = useId()
  const targets = useExistingTargets(target === 'existing', base)
  useEscape(actions.closePublish)

  useEffect(() => {
    document.getElementById(`${labelId}-message`)?.focus()
  }, [labelId])

  // Když se seznam načte a vybraná větev v něm není, vezme se první.
  useEffect(() => {
    const list = targets.branches
    if (!list || list.length === 0 || list.includes(existing)) return
    setExisting(list[0] ?? '')
  }, [existing, targets.branches])

  const choose = (next: Target) => {
    setTarget(next)
    setError(null)
  }

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    if (!message.trim()) {
      setError(t.git.messageEmpty)
      return
    }
    if (target === 'new') {
      if (!isValidBranchName(branch.trim())) {
        setError(t.git.branchInvalid)
        return
      }
      void actions.publish(message.trim(), branch.trim(), 'new')
      return
    }
    if (target === 'existing') {
      if (!existing) {
        setError(t.git.targetMissing)
        return
      }
      void actions.publish(message.trim(), existing, 'existing')
      return
    }
    if (!directOk) {
      setError(t.git.targetDefaultUnconfirmed(base))
      return
    }
    void actions.publish(message.trim(), base, 'existing')
  }

  const sendLabel =
    target === 'default' ? t.git.sendTo(base) : target === 'existing' && existing ? t.git.sendTo(existing) : t.git.send

  return (
    <Backdrop onClose={actions.closePublish}>
      <form className="modal git__dialog" onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby={labelId}>
        <h2 className="modal__title" id={labelId}>
          {t.git.publishTitle}
        </h2>
        <p className="modal__body">{t.git.publishBody(files.length)}</p>
        <ul className="git__summary">
          {files.map((file) => (
            <li key={file.path} className="git__summary-item">
              <span className="git__summary-path">{file.path}</span>
              <span className={`git__badge git__badge--${file.kind}`}>{t.git.kind[file.kind] ?? file.kind}</span>
            </li>
          ))}
        </ul>
        {/* Smazání se odesílá stejně snadno jako úprava -- a na GitHubu po něm
            soubor zmizí. Má to být vidět dřív, než se klikne. */}
        {deletions > 0 ? (
          <p className="git__target-warning" role="note">
            {t.git.publishDeletes(deletions)}
          </p>
        ) : null}

        <label className="modal__label" htmlFor={`${labelId}-message`}>
          {t.git.messageLabel}
        </label>
        <textarea
          id={`${labelId}-message`}
          className="modal__input git__message"
          rows={3}
          value={message}
          onChange={(event) => {
            setMessage(event.target.value)
            setError(null)
          }}
        />

        <fieldset className="git__methods git__targets">
          <legend className="modal__label">{t.git.targetLabel}</legend>

          <label className="git__method">
            <input
              type="radio"
              name={`${labelId}-target`}
              checked={target === 'new'}
              onChange={() => choose('new')}
            />
            <span>{t.git.targetNew}</span>
          </label>
          {target === 'new' ? (
            <div className="git__target-body">
              <label className="modal__label" htmlFor={`${labelId}-branch`}>
                {t.git.branchLabel}
              </label>
              <input
                id={`${labelId}-branch`}
                className="modal__input"
                value={branch}
                spellCheck={false}
                onChange={(event) => {
                  setBranch(event.target.value)
                  setError(null)
                }}
                aria-invalid={error ? 'true' : 'false'}
              />
              <p className="git__muted">{t.git.targetNewHint(base)}</p>
            </div>
          ) : null}

          <label className="git__method">
            <input
              type="radio"
              name={`${labelId}-target`}
              checked={target === 'existing'}
              onChange={() => choose('existing')}
            />
            <span>{t.git.targetExisting}</span>
          </label>
          {target === 'existing' ? (
            <div className="git__target-body">
              {targets.branches === null ? (
                <Spinner label={t.git.targetExistingLoading} />
              ) : targets.branches.length === 0 ? (
                <p className="git__muted">{targets.error ?? t.git.targetExistingNone}</p>
              ) : (
                <>
                  <label className="modal__label" htmlFor={`${labelId}-existing`}>
                    {t.git.targetExistingLabel}
                  </label>
                  <select
                    id={`${labelId}-existing`}
                    className="modal__input"
                    value={existing}
                    onChange={(event) => {
                      setExisting(event.target.value)
                      setError(null)
                    }}
                  >
                    {targets.branches.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </>
              )}
              <p className="git__muted">{t.git.targetExistingHint(current)}</p>
            </div>
          ) : null}

          <label className="git__method">
            <input
              type="radio"
              name={`${labelId}-target`}
              checked={target === 'default'}
              onChange={() => choose('default')}
            />
            <span>{t.git.targetDefault(base)}</span>
          </label>
          {target === 'default' ? (
            <div className="git__target-body git__target-warning" role="note">
              <p>{t.git.targetDefaultWarning(base)}</p>
              <label className="git__method">
                <input
                  type="checkbox"
                  checked={directOk}
                  onChange={(event) => {
                    setDirectOk(event.target.checked)
                    setError(null)
                  }}
                />
                <span>{t.git.targetDefaultConfirm(base)}</span>
              </label>
            </div>
          ) : null}
        </fieldset>

        {error ? (
          <p className="modal__error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="modal__actions">
          <button type="button" className="button" onClick={actions.closePublish}>
            {t.common.cancel}
          </button>
          <button
            type="submit"
            className={`button ${target === 'default' ? 'button--danger' : 'button--primary'}`}
          >
            {sendLabel}
          </button>
        </div>
      </form>
    </Backdrop>
  )
}

function PrDialog() {
  const { view, actions } = useGit()
  const [title, setTitle] = useState(() => suggestPrTitle(view.lastMessage))
  const [body, setBody] = useState(() => suggestPrBody(view.lastMessage))
  const [base, setBase] = useState(() => view.published?.base ?? '')
  const [error, setError] = useState<string | null>(null)
  const busy = view.busy === 'pr'
  const labelId = useId()
  useEscape(actions.closePr)

  useEffect(() => {
    document.getElementById(`${labelId}-title`)?.focus()
  }, [labelId])

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    if (!title.trim()) {
      setError(t.git.prTitleEmpty)
      return
    }
    if (!isValidBranchName(base.trim())) {
      setError(t.git.branchInvalid)
      return
    }
    void actions.createPr(title.trim(), body, base.trim())
  }

  return (
    <Backdrop onClose={actions.closePr}>
      <form className="modal git__dialog" onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby={labelId}>
        <h2 className="modal__title" id={labelId}>
          {t.git.openPrTitle}
        </h2>
        <p className="modal__body">
          {t.git.openPrBody(view.published?.branch ?? '', base)}
        </p>

        <label className="modal__label" htmlFor={`${labelId}-title`}>
          {t.git.prTitleLabel}
        </label>
        <input
          id={`${labelId}-title`}
          className="modal__input"
          value={title}
          onChange={(event) => {
            setTitle(event.target.value)
            setError(null)
          }}
          aria-invalid={error ? 'true' : 'false'}
        />

        <label className="modal__label" htmlFor={`${labelId}-base`}>
          {t.git.prBaseLabel}
        </label>
        <input
          id={`${labelId}-base`}
          className="modal__input"
          value={base}
          spellCheck={false}
          onChange={(event) => {
            setBase(event.target.value)
            setError(null)
          }}
        />

        <label className="modal__label" htmlFor={`${labelId}-body`}>
          {t.git.prBodyLabel}
        </label>
        <textarea
          id={`${labelId}-body`}
          className="modal__input git__message"
          rows={4}
          value={body}
          placeholder={t.git.prBodyPlaceholder}
          onChange={(event) => setBody(event.target.value)}
        />

        {/* Chyba z gitu patří sem, ne do panelu za dialogem. */}
        {error || view.prError ? (
          <p className="modal__error" role="alert">
            {error ?? view.prError}
          </p>
        ) : null}
        <div className="modal__actions">
          <button type="button" className="button" onClick={actions.closePr} disabled={busy}>
            {t.common.cancel}
          </button>
          <button type="submit" className="button button--primary" disabled={busy}>
            {busy ? t.git.prCreating : t.git.prCreate}
          </button>
        </div>
      </form>
    </Backdrop>
  )
}

function MergeDialog() {
  const { view, actions } = useGit()
  const [method, setMethod] = useState<MergeMethod>(() => defaultMergeMethod(view.mergeMethods))
  const [deleteBranch, setDeleteBranch] = useState(true)
  const labelId = useId()
  const busy = view.busy === 'merge'
  useEscape(actions.closeMerge)

  const pr = view.pr
  if (!pr) return null

  const allowed: MergeMethod[] = (['squash', 'merge', 'rebase'] as const).filter(
    (one) => view.mergeMethods[one],
  )

  return (
    <Backdrop onClose={actions.closeMerge}>
      <div className="modal git__dialog" role="alertdialog" aria-modal="true" aria-labelledby={labelId}>
        <h2 className="modal__title" id={labelId}>
          {t.git.mergeTitle}
        </h2>
        <p className="modal__body">{t.git.mergeBody(pr.number, pr.headRefName, pr.baseRefName)}</p>
        <p className="git__muted">{t.git.mergeAfter(pr.baseRefName)}</p>

        <fieldset className="git__methods">
          <legend className="modal__label">{t.git.mergeMethodLabel}</legend>
          {allowed.map((one) => (
            <label key={one} className="git__method">
              <input
                type="radio"
                name={`${labelId}-method`}
                value={one}
                checked={method === one}
                disabled={busy}
                onChange={() => setMethod(one)}
              />
              <span>{t.git.mergeMethod[one]}</span>
            </label>
          ))}
        </fieldset>

        <label className="git__method">
          <input
            type="checkbox"
            checked={deleteBranch}
            disabled={busy}
            onChange={(event) => setDeleteBranch(event.target.checked)}
          />
          <span>{t.git.mergeDelete}</span>
        </label>

        {view.prError ? (
          <p className="modal__error" role="alert">
            {view.prError}
          </p>
        ) : null}
        <Transcript text={busy || view.prError ? view.transcript : ''} />

        <div className="modal__actions">
          <button type="button" className="button" onClick={actions.closeMerge} disabled={busy}>
            {t.common.cancel}
          </button>
          <button
            type="button"
            className="button button--primary"
            disabled={busy}
            onClick={() => void actions.mergePr(method, deleteBranch)}
          >
            {busy ? t.git.merging : t.git.mergeConfirm}
          </button>
        </div>
      </div>
    </Backdrop>
  )
}

// -- sekce ------------------------------------------------------------------

export function GitSection() {
  const state = useAppState()
  const { view, actions } = useGit()
  const [open, setOpen] = useState(true)

  // Jen u otevřené složky, a jen když je v repu. Prohlížeč bez Tauri, počítač
  // bez gitu a složka mimo repo sekci vůbec nedostanou: bez gitu se nedá
  // zjistit ani to, jestli složka v repu je, a nabízet instalaci gitu každé
  // otevřené složce by otravovalo i toho, kdo git nikdy nechtěl.
  const folder = activeFolder(state.explorer.folders, state.explorer.active)
  if (!folder) return null
  if (!view.probed) return null
  if (view.step === 'unsupported' || view.step === 'install-git' || view.step === 'not-repo') return null

  // Zjišťování stavu trvá od zlomku vteřiny po několik vteřin a dřív po něm
  // v hlavičce nezbylo nic. Teď je tam po celou dobu „zjišťuji…“ a pak čas,
  // kdy to doběhlo -- takže je vidět i to, že se právě nic nezměnilo.
  const checking = view.busy === 'probe' || view.busy === 'status'
  const branch = view.probe?.branch ?? ''

  /**
   * Kdy se stav naposled zjišťoval.
   *
   * V těle sekce, ne v hlavičce: tam se o místo dělí s názvem sekce, jménem
   * složky a jménem větve a při `docs/2026-09-22-1710` na řádku nezbylo nic.
   * Když je sekce sbalená, je odpovědí točící se ikona vedle hlavičky.
   */
  const checkedLine = checking ? (
    <p className="git__checked-line" role="status">
      {t.git.rechecking}
    </p>
  ) : view.checkedAt ? (
    <p className="git__checked-line">{t.git.checkedAt(clockTime(view.checkedAt))}</p>
  ) : null

  return (
    <>
      <Section
        id="ws-git"
        title={
          <>
            <GitIcon />
            <span className="ws-section__label ws-section__label--fixed">{t.git.section}</span>
            {/* Ke které složce se sekce vztahuje. Bez toho by s víc otevřenými
                složkami nebylo poznat, čí větev a čí změny jsou vidět. */}
            <span className="ws-section__for">{folderLabel(folder.rootPath)}</span>
          </>
        }
        titleHint={folder.rootPath}
        open={open}
        onToggle={() => setOpen((value) => !value)}
        resize={{ key: SECTION_GIT, label: t.git.section }}
        actions={
          <>
            {/* Jméno větve je zároveň vstup do okna větví: tam, kde člověk
                vidí „main“, čeká, že na to jde kliknout a vybrat jinou. */}
            {branch ? (
              <button
                type="button"
                className="git__branch-button"
                title={`${branch} — ${t.git.branchesHint}`}
                aria-label={t.git.branchesButton}
                disabled={view.step !== 'ready' || view.busy !== null}
                onClick={() => actions.openBranches('browse')}
              >
                <BranchIcon />
                <span className="git__branch">{branch}</span>
                <span className="git__branch-caret" aria-hidden="true">
                  ▾
                </span>
              </button>
            ) : null}
            <button
            type="button"
            className={`ws-icon-button ${checking ? 'is-busy' : ''}`}
            title={t.git.recheckHint}
            aria-label={t.git.recheck}
            aria-busy={checking}
            disabled={view.busy !== null}
            onClick={() => void actions.refresh()}
          >
            <span aria-hidden="true">{'↻'}</span>
          </button>
          </>
        }
      >
        <div className="git">
          {checkedLine}
          {view.busy === 'probe' && !view.probe ? <Spinner label={t.git.checking} /> : null}

          {view.step === 'no-remote' ? <SetupCard title={t.git.noRemote} body={t.git.noRemoteBody} /> : null}
          {view.step === 'identity' ? (
            <SetupCard title={t.git.identity} body={t.git.identityBody} command={t.git.identityCommands} />
          ) : null}

          {view.step === 'ready' ? (
            <>
              <GhNotice />
              <SyncNotice />
              <Changes />
              <CompareLink />
              <PublishedCard />
              <CiCard />
              <Recent />
            </>
          ) : null}

          {view.error ? (
            <p className="git__error" role="alert">
              {view.error}
            </p>
          ) : null}
        </div>
      </Section>
      {view.publishOpen ? <PublishDialog /> : null}
      {view.prOpen ? <PrDialog /> : null}
      {view.mergeOpen ? <MergeDialog /> : null}
      {view.branches && view.step === 'ready' ? <BranchDialog /> : null}
      {view.compareOpen && view.step === 'ready' ? <CompareDialog /> : null}
    </>
  )
}
