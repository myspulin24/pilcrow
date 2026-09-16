/**
 * Conflict resolution.
 *
 * Shown when a note changed on disk while you had unsaved edits -- typically
 * iCloud Drive delivering a version from another device. Nothing is written
 * until you choose, and "Keep both" is always available so no version is ever
 * lost by accident.
 */

import { useMemo } from 'react'

import { collapseDiff, diffLines, summarizeDiff, t } from '@/core'
import { useActions, useAppState } from '@/state/store'

export function ConflictView() {
  const state = useAppState()
  const actions = useActions()
  const conflict = state.conflict

  const { rows, summary } = useMemo(() => {
    if (!conflict) return { rows: [], summary: { added: 0, removed: 0, unchanged: 0, identical: true } }
    const diff = diffLines(conflict.disk, conflict.local)
    return { rows: collapseDiff(diff), summary: summarizeDiff(diff) }
  }, [conflict])

  if (!conflict) return null

  return (
    <div className="conflict-backdrop" role="dialog" aria-modal="true" aria-labelledby="conflict-title">
      <div className="conflict">
        <header className="conflict__header">
          <h2 id="conflict-title" className="conflict__title">
            {t.conflict.title}
          </h2>
          <p className="conflict__subtitle">
            {t.conflict.subtitle(conflict.path)}
          </p>
          <p className="conflict__stats">
            <span className="conflict__stat conflict__stat--added">+{summary.added} {t.conflict.yours}</span>
            <span className="conflict__stat conflict__stat--removed">-{summary.removed} {t.conflict.onDisk}</span>
            <span className="conflict__stat">{summary.unchanged} {t.conflict.unchanged}</span>
          </p>
        </header>

        <div className="conflict__diff" role="region" aria-label={t.conflict.differences}>
          {summary.identical ? (
            <p className="conflict__identical">
              {t.conflict.identical}
            </p>
          ) : (
            <table className="diff">
              <caption className="visually-hidden">
                {t.conflict.caption}
              </caption>
              <tbody>
                {rows.map((row, index) => {
                  if ('skipped' in row) {
                    return (
                      <tr key={`skip-${index}`} className="diff__row diff__row--skip">
                        <td colSpan={3}>{t.conflict.skipped(row.skipped)}</td>
                      </tr>
                    )
                  }
                  const marker = row.kind === 'added' ? '+' : row.kind === 'removed' ? '-' : ' '
                  return (
                    <tr key={`row-${index}`} className={`diff__row diff__row--${row.kind}`}>
                      <td className="diff__gutter">{row.leftNumber ?? ''}</td>
                      <td className="diff__gutter">{row.rightNumber ?? ''}</td>
                      <td className="diff__text">
                        <span className="diff__marker" aria-hidden="true">
                          {marker}
                        </span>
                        {row.text || ' '}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        <footer className="conflict__actions">
          <button type="button" className="button" onClick={() => void actions.resolveConflict('use-disk')}>
            {t.conflict.useDisk}
          </button>
          <button type="button" className="button" onClick={() => void actions.resolveConflict('keep-both')}>
            {t.conflict.keepBoth}
          </button>
          <button
            type="button"
            className="button button--primary"
            onClick={() => void actions.resolveConflict('keep-local')}
          >
            {t.conflict.keepMine}
          </button>
        </footer>
      </div>
    </div>
  )
}
