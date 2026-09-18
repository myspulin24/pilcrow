/**
 * The four states every surface in Pilcrow has to be able to show: loading,
 * empty, error and success. Keeping them in one file makes it obvious when a
 * new view forgets one.
 */

import type { ReactNode } from 'react'

import { t } from '@/core'
import { useActions, useAppState } from '@/state/store'

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="spinner" role="status" aria-live="polite">
      <span className="spinner__ring" aria-hidden="true" />
      <span className="spinner__label">{label ?? t.common.loading}</span>
    </div>
  )
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: string
  title: string
  description?: ReactNode
  action?: { label: string; onClick: () => void }
}) {
  return (
    <div className="empty-state">
      {icon ? (
        <div className="empty-state__icon" aria-hidden="true">
          {icon}
        </div>
      ) : null}
      <h2 className="empty-state__title">{title}</h2>
      {description ? <div className="empty-state__body">{description}</div> : null}
      {action ? (
        <button type="button" className="button button--primary" onClick={action.onClick}>
          {action.label}
        </button>
      ) : null}
    </div>
  )
}

export function ErrorState({
  title,
  message,
  retry,
}: {
  title: string
  message: string
  retry?: { label: string; onClick: () => void }
}) {
  return (
    <div className="empty-state empty-state--error" role="alert">
      <div className="empty-state__icon" aria-hidden="true">
        !
      </div>
      <h2 className="empty-state__title">{title}</h2>
      <div className="empty-state__body">{message}</div>
      {retry ? (
        <button type="button" className="button button--primary" onClick={retry.onClick}>
          {retry.label}
        </button>
      ) : null}
    </div>
  )
}

export function Toasts() {
  const { toasts } = useAppState()
  const actions = useActions()
  if (toasts.length === 0) return null

  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast--${toast.kind}`} role={toast.kind === 'error' ? 'alert' : 'status'}>
          <span className="toast__message">{toast.message}</span>
          {toast.action ? (
            <button
              type="button"
              className="toast__action"
              onClick={() => {
                toast.action?.run()
                actions.dismissToast(toast.id)
              }}
            >
              {toast.action.label}
            </button>
          ) : null}
          <button
            type="button"
            className="toast__close"
            aria-label={t.common.dismiss}
            onClick={() => actions.dismissToast(toast.id)}
          >
            &times;
          </button>
        </div>
      ))}
    </div>
  )
}
