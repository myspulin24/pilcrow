/**
 * Okno feedbacku: rozepsaná zpráva, označený prvek, příloha, odeslání.
 *
 * Bydlí vedle hlavního storu jako asistent a git. S poznámkami sdílí jen
 * pohled na to, co je otevřené -- a to se popíše obecně, bez názvů a cest
 * (`feedbackLocation`), v chvíli, kdy se okno otevře.
 *
 * Rozepsaná zpráva přežije zavření okna: kdo ho zavře, aby si něco ověřil,
 * nemá o text přijít. Zahodí se až po odeslání.
 */

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'

import {
  checkAttachment,
  draftProblem,
  EMPTY_DRAFT,
  feedbackLocation,
  feedbackRequest,
  t,
  type FeedbackDraft,
  type FeedbackElement,
} from '@/core'
import { createFeedback, feedbackMessage, type FeedbackApi, type FeedbackStatus } from '@/feedback'

import { useAssistant } from './assistant-store'
import { useGit } from './git-store'
import { useStore } from './store'

export interface FeedbackView {
  open: boolean
  /** Okno je schované a uživatel ukazuje na prvek. */
  picking: boolean
  draft: FeedbackDraft
  /** Co bylo otevřené, když se okno otevřelo. */
  location: string
  status: FeedbackStatus | null
  sending: boolean
  error: string | null
  /** ID, pod kterým feedback dorazil. Dokud je, okno ukazuje poděkování. */
  sentId: string | null
}

export interface FeedbackActions {
  open(): void
  close(): void
  edit(patch: Partial<FeedbackDraft>): void
  startPicking(): void
  /** Konec ukazování: prvek, nebo `null`, když uživatel zrušil. */
  finishPicking(element: FeedbackElement | null): void
  attach(file: File): Promise<void>
  removeAttachment(): void
  send(): Promise<void>
  /** Po poděkování: začít novou zprávu. */
  another(): void
}

interface FeedbackValue {
  view: FeedbackView
  actions: FeedbackActions
}

const FeedbackContext = createContext<FeedbackValue | null>(null)

const initialView: FeedbackView = {
  open: false,
  picking: false,
  draft: EMPTY_DRAFT,
  location: '',
  status: null,
  sending: false,
  error: null,
  sentId: null,
}

/** Obsah souboru v base64, bez prefixu `data:…;base64,`. */
function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.onerror = () => reject(reader.error ?? new Error('read failed'))
    reader.readAsDataURL(file)
  })
}

const PROBLEM_TEXT = {
  kind: t.feedback.needKind,
  message: t.feedback.needMessage,
  'too-long': t.feedback.tooLong,
  email: t.feedback.badEmail,
} as const

export function FeedbackProvider({ children, feedback }: { children: ReactNode; feedback?: FeedbackApi }) {
  const apiRef = useRef<FeedbackApi>(feedback ?? createFeedback())
  const api = apiRef.current
  const { state, actions: storeActions } = useStore()
  const git = useGit()
  const assistant = useAssistant()

  const [view, setView] = useState<FeedbackView>(initialView)
  const viewRef = useRef(view)
  const update = useCallback((fn: (current: FeedbackView) => FeedbackView) => {
    viewRef.current = fn(viewRef.current)
    setView(fn)
  }, [])
  const patch = useCallback((next: Partial<FeedbackView>) => update((current) => ({ ...current, ...next })), [update])

  /** Co je teď na obrazovce -- jen druh věcí, žádná jména. */
  const describeLocation = useCallback(
    () =>
      feedbackLocation({
        open: state.linked ? 'linked' : state.editor ? (state.editor.external ? 'file' : 'note') : 'none',
        viewMode: state.viewMode,
        sidebarVisible: state.sidebarVisible,
        openFolders: state.explorer.folders.length,
        gitReady: git.view.step === 'ready',
        assistantOpen: assistant.view.open,
      }),
    [assistant.view.open, git.view.step, state.editor, state.explorer.folders.length, state.linked, state.sidebarVisible, state.viewMode],
  )

  const open = useCallback(() => {
    const settings = state.settings
    update((current) => ({
      ...current,
      open: true,
      picking: false,
      location: describeLocation(),
      error: null,
      // Jméno a e-mail z minula, pokud uživatel nerozepsal něco jiného.
      draft: {
        ...current.draft,
        name: current.draft.name || settings.feedbackName,
        email: current.draft.email || settings.feedbackEmail,
      },
    }))
    storeActions.suppressDrops(true)
    void api
      .status()
      .then((status) => patch({ status }))
      .catch((error) =>
        patch({ status: { available: false, host: '', version: '', os: '', error: feedbackMessage(error, t.feedback.failed) } }),
      )
  }, [api, describeLocation, patch, state.settings, storeActions, update])

  const close = useCallback(() => {
    if (viewRef.current.sending) return
    // Po poděkování se začíná načisto; rozepsaná zpráva se drží.
    update((current) => ({
      ...current,
      open: false,
      picking: false,
      error: null,
      sentId: null,
      draft: current.sentId ? { ...EMPTY_DRAFT, name: current.draft.name, email: current.draft.email } : current.draft,
    }))
    storeActions.suppressDrops(false)
  }, [storeActions, update])

  const edit = useCallback(
    (next: Partial<FeedbackDraft>) => update((current) => ({ ...current, error: null, draft: { ...current.draft, ...next } })),
    [update],
  )

  const attach = useCallback(
    async (file: File) => {
      const check = checkAttachment(file.name, file.size)
      if (!check.ok) {
        patch({ error: check.reason === 'size' ? t.feedback.attachTooBig : t.feedback.attachWrongType })
        return
      }
      try {
        const data = await readBase64(file)
        update((current) => ({
          ...current,
          error: null,
          draft: { ...current.draft, file: { name: file.name, type: check.type, size: file.size, data } },
        }))
      } catch {
        patch({ error: t.feedback.attachFailed })
      }
    },
    [patch, update],
  )

  const send = useCallback(async () => {
    const current = viewRef.current
    if (current.sending || !current.status?.available) return
    const problem = draftProblem(current.draft)
    if (problem) {
      patch({ error: PROBLEM_TEXT[problem] })
      return
    }
    patch({ sending: true, error: null })
    try {
      const id = await api.send(feedbackRequest(current.draft, current.location))
      patch({ sending: false, sentId: id })
      // Kdo se podepsal, nemusí to příště psát znovu. Anonym nic nepřepíše.
      const { anonymous, name, email } = current.draft
      const settings = state.settings
      if (!anonymous && (name.trim() !== settings.feedbackName || email.trim() !== settings.feedbackEmail)) {
        void storeActions.updateSettings({ feedbackName: name.trim(), feedbackEmail: email.trim() }).catch(() => undefined)
      }
    } catch (error) {
      // Text zůstává v okně; dá se poslat znovu.
      patch({ sending: false, error: feedbackMessage(error, t.feedback.failed) })
    }
  }, [api, patch, state.settings, storeActions])

  const actions = useMemo<FeedbackActions>(
    () => ({
      open,
      close,
      edit,
      startPicking: () => patch({ picking: true, error: null }),
      finishPicking: (element) =>
        update((current) => ({
          ...current,
          picking: false,
          draft: element ? { ...current.draft, element } : current.draft,
        })),
      attach,
      removeAttachment: () => update((current) => ({ ...current, draft: { ...current.draft, file: null } })),
      send,
      another: () =>
        update((current) => ({
          ...current,
          sentId: null,
          error: null,
          location: describeLocation(),
          draft: { ...EMPTY_DRAFT, name: current.draft.name, email: current.draft.email },
        })),
    }),
    [attach, close, describeLocation, edit, open, patch, send, update],
  )

  const value = useMemo<FeedbackValue>(() => ({ view, actions }), [actions, view])
  return <FeedbackContext.Provider value={value}>{children}</FeedbackContext.Provider>
}

export function useFeedback(): FeedbackValue {
  const value = useContext(FeedbackContext)
  if (!value) throw new Error('useFeedback must be used inside <FeedbackProvider>')
  return value
}
