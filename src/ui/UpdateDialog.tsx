/**
 * Okno aktualizace.
 *
 * Ukazuje jen to, co uživatel potřebuje k rozhodnutí: která verze, co je
 * nového a jak daleko je stahování. Instalace je jediné tlačítko, protože
 * v tu chvíli se aplikace zavře a znovu otevře -- a to je věc, o kterou si
 * má říct on, ne my.
 */

import { useId } from 'react'

import {
  downloadPercent,
  formatProgress,
  formatReleaseDate,
  renderMarkdown,
  summariseNotes,
  t,
} from '@/core'
import { useActions, useAppState } from '@/state/store'

import { Backdrop, useEscape } from './Modal'

function ProgressBar({ downloaded, total }: { downloaded: number; total: number | null }) {
  const percent = downloadPercent(downloaded, total)

  return (
    <div className="update__progress">
      <div
        className={`update__bar ${percent === null ? 'is-indeterminate' : ''}`}
        role="progressbar"
        aria-label={t.update.downloading}
        {...(percent === null
          ? {}
          : { 'aria-valuenow': percent, 'aria-valuemin': 0, 'aria-valuemax': 100 })}
      >
        <span
          className="update__bar-fill"
          style={percent === null ? undefined : { width: `${percent}%` }}
        />
      </div>
      <span className="update__progress-text">
        {percent === null ? t.update.downloadingShort : `${percent} % · ${formatProgress(downloaded, total)}`}
      </span>
    </div>
  )
}

export function UpdateDialog() {
  const { update } = useAppState()
  const actions = useActions()
  const labelId = useId()
  useEscape(actions.dismissUpdate)

  if (!update.dialogOpen) return null

  const info = update.info
  const downloading = update.phase === 'downloading'
  const ready = update.phase === 'ready'
  const failed = update.phase === 'error'

  const title = failed
    ? t.update.failedTitle
    : ready
      ? t.update.readyTitle
      : update.phase === 'checking'
        ? t.update.checking
        : t.update.dialogTitle

  return (
    <Backdrop onClose={actions.dismissUpdate}>
      <div
        className="modal modal--update"
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelId}
      >
        <h2 className="modal__title" id={labelId}>
          {title}
        </h2>

        {info ? (
          <p className="update__lead">
            {ready
              ? t.update.readyLine(info.version)
              : t.update.availableLine(info.version, info.currentVersion)}
            {formatReleaseDate(info.date ?? '') ? (
              <span className="update__date">{t.update.released(formatReleaseDate(info.date ?? ''))}</span>
            ) : null}
          </p>
        ) : null}

        {failed ? <p className="update__error">{update.error}</p> : null}

        {info && !failed ? (
          <section className="update__notes" aria-label={t.update.notesTitle}>
            <h3 className="update__notes-title">{t.update.notesTitle}</h3>
            {info.notes.trim() ? (
              <div
                className="markdown markdown--compact"
                // Stejný renderer jako u poznámek: escapuje u zdroje a hlídá
                // schéma každé URL, takže text z GitHubu nemůže nic provést.
                dangerouslySetInnerHTML={{ __html: renderMarkdown(summariseNotes(info.notes)) }}
              />
            ) : (
              <p className="update__empty">{t.update.noNotes}</p>
            )}
          </section>
        ) : null}

        {downloading ? <ProgressBar downloaded={update.downloaded} total={update.total} /> : null}

        {ready ? <p className="update__hint">{t.update.installHint}</p> : null}

        <div className="modal__actions">
          <button type="button" className="button" onClick={actions.dismissUpdate}>
            {t.update.later}
          </button>
          <button
            type="button"
            className="button button--primary"
            disabled={downloading || update.phase === 'checking'}
            onClick={() => void actions.installUpdate()}
          >
            {downloading ? t.update.installing : t.update.installNow}
          </button>
        </div>
      </div>
    </Backdrop>
  )
}
