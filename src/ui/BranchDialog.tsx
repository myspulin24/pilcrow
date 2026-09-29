/**
 * Okno větví: prohlížeč toho, co je v repozitáři na GitHubu.
 *
 * Vlevo seznam větví, vpravo co vybraná větev přinesla proti výchozí --
 * commity a změněné soubory, u každého rozdíl na rozkliknutí. Stáhnout
 * a otevřít se dá jen tlačítkem dole, a jen tu větev, která je vybraná.
 *
 * Stejné okno se ptá, *odkud* stáhnout, když uživatel klikne na „Stáhnout…“
 * nebo když se otevřený repozitář ukáže být pozadu. Liší se jen nadpisem,
 * úvodní větou a tlačítkem -- v obou případech platí, že se nestáhne nic,
 * co si uživatel sám nevybral.
 */

import { useEffect, useId, useMemo, useRef, useState } from 'react'

import {
  branchRef,
  branchUrl,
  filterBranches,
  isCommittable,
  parseBranchReport,
  parseBranches,
  relativeTime,
  switchKind,
  t,
  type Branch,
  type BranchList,
  type BranchReport,
} from '@/core'
import { gitMessage } from '@/git'
import { useGit } from '@/state/git-store'
import { Spinner } from './Feedback'
import { Backdrop, useEscape } from './Modal'
import { FileDiff, Transcript } from './GitParts'

function Badges({ branch }: { branch: Branch }) {
  return (
    <>
      {branch.current ? <span className="repos__badge repos__badge--cloned">{t.branches.current}</span> : null}
      {branch.isDefault ? <span className="repos__badge">{t.branches.isDefault}</span> : null}
      {branch.gone ? (
        <span className="repos__badge repos__badge--warn">{t.branches.gone}</span>
      ) : !branch.local ? (
        <span className="repos__badge">{t.branches.remoteOnly}</span>
      ) : !branch.remote ? (
        <span className="repos__badge">{t.branches.localOnly}</span>
      ) : null}
      {branch.behind > 0 ? (
        <span className="repos__badge branches__badge--pull" title={t.branches.toPullHint(branch.behind)}>
          {t.branches.toPull(branch.behind)}
        </span>
      ) : null}
      {branch.ahead > 0 ? (
        <span className="repos__badge" title={t.branches.unpushedHint(branch.ahead)}>
          {t.branches.unpushed(branch.ahead)}
        </span>
      ) : null}
    </>
  )
}

/** Co vybraná větev přinesla proti výchozí. */
function Detail({ branch, list, now }: { branch: Branch; list: BranchList; now: number }) {
  const { view, api } = useGit()
  const [report, setReport] = useState<BranchReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const folder = view.folder
  const base = list.branches.find((candidate) => candidate.isDefault)
  const baseRef = base ? branchRef(base) : list.defaultBranch
  const target = branchRef(branch)
  const display = (path: string) =>
    view.under && path.startsWith(`${view.under}/`) ? path.slice(view.under.length + 1) : path

  useEffect(() => {
    setReport(null)
    setError(null)
    if (!folder || !baseRef || branch.isDefault) return
    let cancelled = false
    api
      .branchLog(folder, baseRef, target)
      .then((raw) => {
        if (!cancelled) setReport(parseBranchReport(raw))
      })
      .catch((reason) => {
        if (!cancelled) setError(gitMessage(reason, t.branches.detailFailed))
      })
    return () => {
      cancelled = true
    }
  }, [api, baseRef, branch.isDefault, folder, target])

  return (
    <div className="branches__detail" aria-label={branch.name}>
      <h3 className="branches__name">{branch.name}</h3>
      <div className="repos__name-line">
        <Badges branch={branch} />
      </div>
      <p className="branches__meta">
        <span className="branches__subject">{branch.subject}</span>
        <span className="git__muted"> — {t.branches.by(branch.author, relativeTime(branch.date, now))}</span>
      </p>

      {branch.isDefault ? (
        <p className="git__muted">{t.branches.defaultSelected(list.defaultBranch)}</p>
      ) : !baseRef ? (
        // Bez výchozí větve není proti čemu porovnávat -- a čekat na
        // odpověď, která nepřijde, by nikdo nerozeznal od pomalé sítě.
        <p className="git__muted">{t.branches.noDefault}</p>
      ) : error ? (
        <p className="git__muted" role="alert">
          {error}
        </p>
      ) : !report ? (
        <Spinner label={t.branches.detailLoading} />
      ) : (
        <>
          <p className="git__muted">
            {report.ahead === 0 && report.behind === 0
              ? t.branches.upToDate(list.defaultBranch)
              : [
                  report.ahead > 0 ? t.branches.ahead(report.ahead, list.defaultBranch) : '',
                  report.behind > 0 ? t.branches.behind(report.behind, list.defaultBranch) : '',
                ]
                  .filter(Boolean)
                  .join(', ')}
          </p>

          {report.commits.length > 0 ? (
            <>
              <h4 className="branches__heading">{t.branches.commits}</h4>
              <ul className="branches__commits">
                {report.commits.slice(0, 20).map((commit) => (
                  <li key={commit.sha}>
                    <code>{commit.sha}</code> <span>{commit.subject}</span>{' '}
                    <span className="git__muted">{t.branches.by(commit.author, relativeTime(commit.date, now))}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          <h4 className="branches__heading">{t.branches.files}</h4>
          {report.files.length === 0 ? <p className="git__muted">{t.branches.noFiles}</p> : null}
          <ul className="compare__files" aria-label={t.branches.files}>
            {report.files.map((file) => (
              <FileDiff
                key={file.path}
                file={file}
                label={display(file.path)}
                kindLabel={t.git.kind[file.kind] ?? file.kind}
                load={() => api.diff(folder ?? '', baseRef, target, file.path)}
              />
            ))}
          </ul>
          {report.others > 0 ? <p className="git__muted">{t.branches.others(report.others)}</p> : null}
        </>
      )}
    </div>
  )
}

export function BranchDialog() {
  const { view, actions, api } = useGit()
  const labelId = useId()
  const searchRef = useRef<HTMLInputElement>(null)
  const [list, setList] = useState<BranchList | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [now] = useState(() => Date.now())
  const intent = view.branches ?? 'browse'
  const busy = view.busy === 'switch' || view.busy === 'pull'
  useEscape(() => {
    if (!busy) actions.closeBranches()
  })

  const folder = view.folder
  useEffect(() => {
    if (!folder) return
    let cancelled = false
    setList(null)
    setLoadError(null)
    api
      .branches(folder)
      .then((raw) => {
        if (cancelled) return
        const parsed = parseBranches(raw)
        setList(parsed)
        // Začíná se tam, kde se stojí -- u stahování je to skoro vždycky ta
        // větev, o kterou jde.
        setSelected((previous) => previous ?? parsed.branches[0]?.name ?? null)
      })
      .catch((reason) => {
        if (!cancelled) setLoadError(gitMessage(reason, t.branches.failed))
      })
    return () => {
      cancelled = true
    }
  }, [api, folder])

  useEffect(() => {
    searchRef.current?.focus()
  }, [])

  const shown = useMemo(() => (list ? filterBranches(list.branches, query) : []), [list, query])
  const branch = list?.branches.find((candidate) => candidate.name === selected) ?? null
  const pending = view.changes.filter(isCommittable).length
  const kind = branch ? switchKind(branch) : null
  const url = branch?.remote && view.remote ? branchUrl(view.remote, branch.name) : null

  const primary = (() => {
    if (!branch || !kind) return null
    if (kind === 'current') return { label: t.branches.stayHere, run: null }
    if (kind === 'pull') return { label: t.branches.pullHere(branch.name), run: () => void actions.pull() }
    const label =
      kind === 'download'
        ? t.branches.download(branch.name)
        : intent === 'pull'
          ? t.branches.switchAndPull(branch.name)
          : t.branches.switchTo(branch.name)
    return { label, run: () => void actions.switchBranch(branch.name) }
  })()

  return (
    <Backdrop onClose={() => (busy ? undefined : actions.closeBranches())}>
      <div className="modal repos branches" role="dialog" aria-modal="true" aria-labelledby={labelId}>
        <div className="repos__head">
          <h2 className="modal__title" id={labelId}>
            {intent === 'pull' ? t.branches.titlePull : t.branches.titleBrowse}
          </h2>
          {view.remote ? (
            <span className="git__muted">
              {view.remote.owner}/{view.remote.repo}
            </span>
          ) : null}
        </div>
        <p className="modal__body">
          {intent === 'pull'
            ? t.branches.introPull(view.probe?.branch ?? '')
            : t.branches.introBrowse(view.probe?.defaultBranch || view.probe?.branch || '')}
        </p>
        {list?.fetchError ? <p className="git__muted">{t.branches.fetchFailed(list.fetchError)}</p> : null}

        <div className="branches__body">
          <div className="branches__pane">
            <input
              ref={searchRef}
              type="search"
              className="modal__input repos__search"
              placeholder={t.branches.search}
              aria-label={t.branches.search}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {loadError ? (
              <p className="git__error" role="alert">
                {loadError}
              </p>
            ) : !list ? (
              <Spinner label={t.branches.loading} />
            ) : shown.length === 0 ? (
              <p className="git__muted repos__empty">{query ? t.branches.noMatches : t.branches.empty}</p>
            ) : (
              <ul className="repos__list branches__list" aria-label={t.branches.listLabel}>
                {shown.map((candidate) => (
                  <li key={candidate.name}>
                    <button
                      type="button"
                      className={`branches__row ${candidate.name === selected ? 'is-selected' : ''}`}
                      aria-pressed={candidate.name === selected}
                      onClick={() => setSelected(candidate.name)}
                    >
                      <span className="branches__row-name">{candidate.name}</span>
                      <span className="branches__row-badges">
                        <Badges branch={candidate} />
                      </span>
                      <span className="branches__row-meta">
                        {t.branches.by(candidate.author, relativeTime(candidate.date, now))}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {branch && list ? <Detail branch={branch} list={list} now={now} /> : <div className="branches__detail" />}
        </div>

        {branch && pending > 0 && (kind === 'switch' || kind === 'download') ? (
          <p className="git__muted branches__dirty">{t.branches.dirty(pending)}</p>
        ) : null}
        {intent === 'pull' && kind === 'current' && branch ? (
          <p className="git__muted">{t.branches.nothingToPull(branch.name)}</p>
        ) : null}
        {view.branchError ? (
          <p className="modal__error" role="alert">
            {view.branchError}
          </p>
        ) : null}
        {busy ? <Spinner label={t.branches.working} /> : null}
        <Transcript text={busy || view.branchError ? view.transcript : ''} />

        <div className="modal__actions">
          {url ? (
            <button type="button" className="button branches__github" onClick={() => void actions.openUrl(url)}>
              {t.branches.openOnGitHub}
            </button>
          ) : null}
          {/* Stahování může na špatné síti viset donekonečna. Zavřít okno by
              ho nezastavilo, takže místo „Zavřít“ je během něj „Zrušit“. */}
          {busy ? (
            <button type="button" className="button" onClick={() => void actions.cancel()}>
              {t.git.cancel}
            </button>
          ) : (
            <button type="button" className="button" onClick={actions.closeBranches}>
              {t.common.close}
            </button>
          )}
          {primary ? (
            <button
              type="button"
              className="button button--primary"
              disabled={!primary.run || busy || view.busy !== null}
              onClick={primary.run ?? undefined}
            >
              {primary.label}
            </button>
          ) : null}
        </div>
      </div>
    </Backdrop>
  )
}
