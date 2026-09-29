/**
 * Výběr repozitáře: vstupní bod k práci s gitem.
 *
 * Jeden krok po druhém, stejně jako u asistenta. Není GitHub CLI? Jak ho
 * pořídit, a nic víc. Je, ale nepřihlášené? Kód do prohlížeče. Teprve pak
 * seznam repozitářů -- ty už na disku se otevřou, zbytek se nejdřív stáhne.
 */

import { useEffect, useId, useRef } from 'react'

import { formatRepoSize, t, type Repo } from '@/core'
import { useRepos, visibleRepos } from '@/state/repos-store'
import { Spinner } from './Feedback'
import { Transcript } from './GitParts'
import { Backdrop, useEscape } from './Modal'

// -- kroky přípravy ---------------------------------------------------------

function InstallStep() {
  const { view, actions } = useRepos()
  return (
    <div className="git__card git__notice">
      <h4>{t.repos.install}</h4>
      <p>{t.repos.installBody}</p>
      {view.probe?.installCommand ? <pre className="git__command">{view.probe.installCommand}</pre> : null}
      <div className="git__actions">
        <button type="button" className="button" onClick={() => void actions.refresh()}>
          {t.repos.reload}
        </button>
      </div>
    </div>
  )
}

function LoginStep() {
  const { view, actions } = useRepos()
  const busy = view.busy === 'login'

  return (
    <div className="git__card git__notice">
      <h4>{t.repos.login}</h4>
      <p>{t.repos.loginBody}</p>
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
            {t.repos.loginButton}
          </button>
        </div>
      )}
      <Transcript text={busy ? view.transcript : ''} />
    </div>
  )
}

// -- seznam -----------------------------------------------------------------

function RepoRow({ repo }: { repo: Repo }) {
  const { view, actions } = useRepos()
  const cloned = !!repo.localPath
  const busy = view.busy !== null && view.busy !== 'probe'
  const size = formatRepoSize(repo.sizeKb)

  return (
    <li className={`repos__row ${cloned ? 'repos__row--cloned' : ''}`}>
      <div className="repos__main">
        <div className="repos__name-line">
          <span className="repos__name">{repo.fullName}</span>
          {cloned ? <span className="repos__badge repos__badge--cloned">{t.repos.cloned}</span> : null}
          {repo.private ? <span className="repos__badge">{t.repos.private}</span> : null}
          {repo.fork ? <span className="repos__badge">{t.repos.fork}</span> : null}
          {repo.archived ? <span className="repos__badge">{t.repos.archived}</span> : null}
          {/* Bez práva zápisu by odeslání změn spadlo až na pushi -- ať je to
              vidět teď, ne za deset minut práce. */}
          {!repo.canPush ? (
            <span className="repos__badge repos__badge--warn" title={t.repos.readOnlyHint}>
              {t.repos.readOnly}
            </span>
          ) : null}
        </div>
        {repo.description ? <p className="repos__description">{repo.description}</p> : null}
        <p className="repos__meta">
          {[repo.language, size, cloned ? repo.localPath : null].filter(Boolean).join(' · ')}
        </p>
      </div>
      <div className="repos__row-actions">
        <button
          type="button"
          className={`button ${cloned ? 'button--primary' : ''}`}
          disabled={busy}
          onClick={() => void (cloned ? actions.openRepo(repo) : actions.cloneRepo(repo))}
        >
          {cloned ? t.repos.openOne : t.repos.clone}
        </button>
        {/* Pro soubory, které už na disku jsou, jen ne v kopii repozitáře:
            stará složka s dokumentací, kopie na OneDrivu, … */}
        <button
          type="button"
          className="workspace__link repos__link"
          title={t.repos.linkOneHint}
          disabled={busy}
          onClick={() => void actions.linkRepo(repo)}
        >
          {t.repos.linkOne}
        </button>
      </div>
    </li>
  )
}

/**
 * „Soubory mám jinde“ -- složka je vybraná, teď se buď potvrdí, nebo se
 * vysvětlí, proč to nejde.
 *
 * Potvrzuje se tady, v okně, ne dalším dialogem přes něj: dva modály nad
 * sebou by se zavíraly jedním Escapem naráz.
 */
function LinkCard() {
  const { view, actions } = useRepos()
  const link = view.link
  if (!link) return null
  const working = view.busy === 'link'

  if (working) {
    return (
      <div className="repos__cloning" role="status">
        <p className="repos__cloning-label">{t.repos.linking(link.repo.fullName)}</p>
        <div className="repos__bar" role="progressbar" aria-valuemin={0} aria-valuemax={100}>
          <div className="repos__bar-fill repos__bar-fill--pulse" />
        </div>
        <Transcript text={view.transcript} />
        <div className="git__actions">
          <button type="button" className="button" onClick={() => void actions.stopLink()}>
            {t.git.cancel}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="git__card repos__link-card" aria-label={t.repos.linkTitle}>
      <h4>{t.repos.linkTitle}</h4>
      {link.kind === 'plain' ? (
        <>
          <p>{t.repos.linkBody(link.folder, link.repo.fullName, link.repo.defaultBranch || 'main')}</p>
          <p className="git__muted">
            {t.repos.linkMarkdown(link.markdownFiles)} {t.repos.linkNothingSent}
          </p>
        </>
      ) : (
        <p role="alert">{link.kind === 'other' ? t.repos.linkOther(link.remote) : t.repos.linkInside(link.root)}</p>
      )}
      <div className="git__actions">
        {link.kind === 'plain' ? (
          <button type="button" className="button button--primary" onClick={() => void actions.confirmLink()}>
            {t.repos.linkConfirm}
          </button>
        ) : null}
        <button type="button" className="button" onClick={actions.cancelLink}>
          {t.repos.linkBack}
        </button>
      </div>
      <Transcript text={view.error ? view.transcript : ''} />
    </div>
  )
}

function CloneProgressView() {
  const { view } = useRepos()
  if (view.busy !== 'clone') return null
  const percent = view.progress?.percent ?? null
  const phase = view.progress ? (t.repos.phase[view.progress.phase] ?? '') : ''

  return (
    <div className="repos__cloning" role="status">
      <p className="repos__cloning-label">
        {t.repos.cloning(view.cloning ?? '')}
        {phase ? ` — ${phase}` : ''}
      </p>
      <div
        className="repos__bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        {...(percent === null ? {} : { 'aria-valuenow': percent })}
      >
        <div
          className={`repos__bar-fill ${percent === null ? 'repos__bar-fill--pulse' : ''}`}
          style={percent === null ? undefined : { width: `${percent}%` }}
        />
      </div>
      <Transcript text={view.transcript} />
    </div>
  )
}

function RepoList() {
  const { view, actions } = useRepos()
  const searchId = useId()
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    searchRef.current?.focus()
  }, [])

  if (view.busy === 'clone') return <CloneProgressView />
  if (view.link) return <LinkCard />

  const repos = visibleRepos(view)

  return (
    <>
      <input
        id={searchId}
        ref={searchRef}
        type="search"
        className="modal__input repos__search"
        placeholder={t.repos.search}
        aria-label={t.repos.search}
        value={view.query}
        onChange={(event) => actions.setQuery(event.target.value)}
      />

      {view.busy === 'probe' ? <Spinner label={t.repos.checking} /> : null}
      {view.busy === 'inspect' ? <Spinner label={t.repos.inspecting} /> : null}

      {repos.length === 0 && view.busy !== 'probe' ? (
        <p className="git__muted repos__empty">{view.query ? t.repos.noMatches : t.repos.empty}</p>
      ) : (
        <ul className="repos__list" aria-label={t.repos.title}>
          {repos.map((repo) => (
            <RepoRow key={repo.fullName} repo={repo} />
          ))}
        </ul>
      )}
    </>
  )
}

/**
 * Výchozí složka: tam začne dialog „kam stáhnout“ a tam se hledá, co už je
 * na disku. Stahovat jde i bez ní -- kam, se ptá pokaždé.
 */
function FolderFooter() {
  const { view, actions } = useRepos()

  if (!view.folder) {
    return (
      <div className="repos__folder repos__folder--unset">
        <div>
          <p className="repos__folder-title">{t.repos.folderUnset}</p>
          <p className="git__muted">{t.repos.folderUnsetBody}</p>
        </div>
        <button type="button" className="button button--primary" onClick={() => void actions.pickFolder()}>
          {t.repos.pickFolder}
        </button>
      </div>
    )
  }

  return (
    <div className="repos__folder repos__folder--set">
      <span className="git__muted">{t.repos.folderLabel}</span>
      <span className="repos__folder-path" title={view.folder}>
        {view.folder}
      </span>
      <button type="button" className="workspace__link" onClick={() => void actions.pickFolder()}>
        {t.repos.changeFolder}
      </button>
      <p className="git__muted repos__folder-hint">{t.repos.folderHint}</p>
    </div>
  )
}

export function RepoDialog() {
  const { view, actions } = useRepos()
  const labelId = useId()
  useEscape(actions.close)

  if (!view.open) return null

  return (
    <Backdrop onClose={actions.close}>
      <div className="modal repos" role="dialog" aria-modal="true" aria-labelledby={labelId}>
        <div className="repos__head">
          <h2 className="modal__title" id={labelId}>
            {t.repos.title}
          </h2>
          {view.step === 'ready' && view.account?.login ? (
            <span className="git__muted">{t.repos.account(view.account.login)}</span>
          ) : null}
        </div>

        <div className="repos__body">
          {view.step === 'install' ? <InstallStep /> : null}
          {view.step === 'login' ? <LoginStep /> : null}
          {view.step === 'ready' ? <RepoList /> : null}
        </div>

        {view.error ? (
          <p className="git__error" role="alert">
            {view.error}
          </p>
        ) : null}

        {view.step === 'ready' && view.busy !== 'clone' && !view.link ? <FolderFooter /> : null}

        <div className="modal__actions">
          <button type="button" className="button" onClick={actions.close}>
            {t.common.close}
          </button>
        </div>
      </div>
    </Backdrop>
  )
}
