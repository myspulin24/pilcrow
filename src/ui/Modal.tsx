/**
 * The two modal shapes the app needs: a single-field prompt (new / rename /
 * move) and a confirmation. Both trap focus, close on Escape, and validate
 * before they let you submit.
 */

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

import { t } from '@/core'
import type { ConfirmRequest, PromptRequest } from '@/state/commands'

export function useEscape(onClose: () => void) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [onClose])
}

export function Backdrop({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      {children}
    </div>
  )
}

export function PromptModal({ request, onClose }: { request: PromptRequest; onClose: () => void }) {
  const [value, setValue] = useState(request.initialValue ?? '')
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const labelId = useId()
  useEscape(onClose)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    const message = request.validate?.(value) ?? null
    if (message) {
      setError(message)
      return
    }
    void request.onSubmit(value)
    onClose()
  }

  return (
    <Backdrop onClose={onClose}>
      <form className="modal" onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby={labelId}>
        <h2 className="modal__title" id={labelId}>
          {request.title}
        </h2>
        <label className="modal__label" htmlFor={`${labelId}-input`}>
          {request.label}
        </label>
        <input
          id={`${labelId}-input`}
          ref={inputRef}
          className="modal__input"
          value={value}
          placeholder={request.placeholder ?? ''}
          onChange={(event) => {
            setValue(event.target.value)
            setError(null)
          }}
          aria-invalid={error ? 'true' : 'false'}
          aria-describedby={error ? `${labelId}-error` : undefined}
        />
        {error ? (
          <p className="modal__error" id={`${labelId}-error`} role="alert">
            {error}
          </p>
        ) : null}
        <div className="modal__actions">
          <button type="button" className="button" onClick={onClose}>
            {t.common.cancel}
          </button>
          <button type="submit" className="button button--primary">
            {request.confirmLabel ?? t.common.ok}
          </button>
        </div>
      </form>
    </Backdrop>
  )
}

export function ConfirmModal({ request, onClose }: { request: ConfirmRequest; onClose: () => void }) {
  const labelId = useId()
  const confirmRef = useRef<HTMLButtonElement>(null)
  useEscape(onClose)

  useEffect(() => {
    confirmRef.current?.focus()
  }, [])

  return (
    <Backdrop onClose={onClose}>
      <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby={labelId}>
        <h2 className="modal__title" id={labelId}>
          {request.title}
        </h2>
        <p className="modal__body">{request.message}</p>
        <div className="modal__actions">
          <button type="button" className="button" onClick={onClose}>
            {t.common.cancel}
          </button>
          <button
            type="button"
            ref={confirmRef}
            className={`button ${request.destructive ? 'button--danger' : 'button--primary'}`}
            onClick={() => {
              void request.onConfirm()
              onClose()
            }}
          >
            {request.confirmLabel}
          </button>
        </div>
      </div>
    </Backdrop>
  )
}
