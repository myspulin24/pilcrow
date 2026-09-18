/**
 * Stav asistenta.
 *
 * Bydlí vedle hlavního storu, ne v něm, a má to důvod: s poznámkami nesdílí
 * nic než text otevřeného souboru, zato si nese vlastní životní cyklus
 * (nainstalovat → přihlásit → ptát se), který by hlavní reduktor jen zvětšil
 * o třetinu, aniž by z toho cokoli získal.
 *
 * Provider se montuje uvnitř `StoreProvider`, takže si otevřenou poznámku
 * i ukládání nastavení vezme přes `useStore()` a testy nemusí obalovat
 * aplikaci podruhé.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

import {
  ASSISTANT_SYSTEM_PROMPT,
  appendDelta,
  awaitsLoginCode,
  buildQuestion,
  createLineSplitter,
  failMessage,
  findLoginUrl,
  finishMessage,
  parseAssistantLine,
  parseAuthStatus,
  setupStep,
  t,
  type AssistantAccount,
  type AssistantMessage,
  type AssistantProbe,
  type SetupStep,
} from '@/core'
import {
  assistantMessage,
  createAssistant,
  type AssistantApi,
  type AssistantChunk,
} from '@/assistant'

import { useStore } from './store'

/** Co zrovna běží. Nikdy dvě věci naráz -- proto jeden údaj, ne tři vlajky. */
export type AssistantBusy = 'probe' | 'install' | 'login' | 'ask' | null

export interface AssistantView {
  /** Panel je vidět. */
  open: boolean
  /** Zapnul si to uživatel? Dokud ne, neodchází nikam nic. */
  enabled: boolean
  busy: AssistantBusy
  /**
   * Už jsme se jednou ptali?
   *
   * Nestačí `probe !== null`: když asistent na tomhle sestavení vůbec nejde,
   * žádný výsledek nevznikne, a bez téhle vlajky by se efekt pokoušel zjistit
   * stav donekonečna.
   */
  probed: boolean
  probe: AssistantProbe | null
  account: AssistantAccount | null
  step: SetupStep
  /** Nastavení je rozbalené. Samo se otevře, když něco chybí. */
  setupOpen: boolean
  /** Co vypsala instalace nebo přihlašování. */
  transcript: string
  loginUrl: string | null
  awaitingCode: boolean
  error: string | null
  /** Rozhovor. */
  messages: AssistantMessage[]
  sessionId: string | null
  /** Poznámka se do kontextu nevešla celá. */
  truncated: boolean
  model: string
}

export interface AssistantActions {
  toggle(): void
  close(): void
  setEnabled(enabled: boolean): Promise<void>
  setModel(model: string): Promise<void>
  setSetupOpen(open: boolean): void
  refresh(): Promise<void>
  install(): Promise<void>
  login(): Promise<void>
  sendCode(code: string): Promise<void>
  cancelLogin(): Promise<void>
  logout(): Promise<void>
  ask(question: string): Promise<void>
  stop(): Promise<void>
  reset(): void
}

interface AssistantValue {
  view: AssistantView
  actions: AssistantActions
  api: AssistantApi
}

const AssistantContext = createContext<AssistantValue | null>(null)

const initialView = (supported: boolean): AssistantView => ({
  open: false,
  enabled: false,
  busy: null,
  probed: false,
  probe: null,
  account: null,
  step: supported ? 'install' : 'unsupported',
  setupOpen: false,
  transcript: '',
  loginUrl: null,
  awaitingCode: false,
  error: null,
  messages: [],
  sessionId: null,
  truncated: false,
  model: '',
})

export function AssistantProvider({
  children,
  assistant,
}: {
  children: ReactNode
  assistant?: AssistantApi
}) {
  const apiRef = useRef<AssistantApi>(assistant ?? createAssistant())
  const api = apiRef.current
  const { state, actions: storeActions } = useStore()

  const [view, setView] = useState<AssistantView>(() => initialView(api.available))
  const patch = useCallback((next: Partial<AssistantView>) => {
    setView((current) => ({ ...current, ...next }))
  }, [])

  /**
   * Nejnovější pohled pro obsluhu, která běží mimo překreslení.
   *
   * Kousky výstupu chodí z procesu kdykoli, i několikrát mezi dvěma
   * překresleními. Číst stav z closure by znamenalo číst ten, který platil
   * při odeslání dotazu.
   */
  const viewRef = useRef(view)
  viewRef.current = view

  // -- nastavení -------------------------------------------------------------

  // Přepínač žije v nastavení trezoru, aby přežil restart. Načte se, jakmile
  // trezor odpoví; do té doby platí „vypnuto“, což je ta bezpečná strana.
  useEffect(() => {
    patch({
      enabled: state.settings.assistantEnabled,
      model: state.settings.assistantModel,
    })
  }, [state.settings.assistantEnabled, state.settings.assistantModel, patch])

  const persist = useCallback(
    async (next: { assistantEnabled?: boolean; assistantModel?: string }) => {
      try {
        await storeActions.updateSettings(next)
      } catch (error) {
        patch({ error: assistantMessage(error, t.errors.generic) })
      }
    },
    [patch, storeActions],
  )

  // -- zjišťování stavu ------------------------------------------------------

  /**
   * Zjistit, jak na tom Claude Code je.
   *
   * `keepOpen` je tu kvůli jedné drobnosti, která by jinak vypadala jako
   * chyba: po dokončeném přihlášení se nastavení nesmí hned zavřít. Uživatel
   * má vidět, že se to povedlo a pod jakým účtem. Při prvním nahlédnutí do
   * panelu naopak nemá cenu ukazovat nastavení, když je všechno hotové.
   */
  const refresh = useCallback(
    async (keepOpen = false) => {
      if (!api.available) {
        patch({ step: 'unsupported', probed: true, probe: null, account: null, setupOpen: true })
        return
      }
      patch({ busy: 'probe', error: null })
      try {
        const probe = await api.probe()
        const step = setupStep(probe, true)
        patch({
          busy: null,
          probed: true,
          probe,
          account: parseAuthStatus(probe.auth),
          step,
          setupOpen: keepOpen || step !== 'ready',
          error: probe.error || null,
        })
      } catch (error) {
        patch({
          busy: null,
          probed: true,
          error: assistantMessage(error, t.assistant.failed),
          setupOpen: true,
        })
      }
    },
    [api, patch],
  )

  // Stav se zjišťuje, až když je asistent zapnutý a panel otevřený: dokud se
  // uživatel nerozhodl, nespouští se kvůli němu ani `claude --version`.
  useEffect(() => {
    if (!view.open || !view.enabled) return
    if (view.probed || view.busy) return
    void refresh()
  }, [refresh, view.busy, view.enabled, view.open, view.probed])

  // -- příprava --------------------------------------------------------------

  /**
   * Obsluha kousků výstupu pro instalaci a přihlášení.
   *
   * Sbírá se celý přepis, protože obojí je pro uživatele „co se děje“, ne
   * strojová data. Adresa k přihlášení se z něj vytáhne, jakmile se objeví.
   */
  const setupSink = useCallback(
    (kind: 'install' | 'login', onDone: () => void) => {
      let transcript = ''
      return (chunk: AssistantChunk) => {
        if (chunk.kind === 'out') {
          transcript += chunk.text
          patch({
            transcript,
            ...(kind === 'login'
              ? { loginUrl: findLoginUrl(transcript), awaitingCode: awaitsLoginCode(transcript) }
              : {}),
          })
          return
        }
        if (chunk.kind === 'failed') {
          patch({
            busy: null,
            awaitingCode: false,
            error: chunk.message || (kind === 'install' ? t.assistant.installFailed : t.assistant.loginFailed),
          })
          return
        }
        patch({ busy: null, awaitingCode: false })
        onDone()
      }
    },
    [patch],
  )

  const install = useCallback(async () => {
    patch({ busy: 'install', transcript: '', error: null })
    try {
      await api.install(setupSink('install', () => void refresh(true)))
    } catch (error) {
      patch({ busy: null, error: assistantMessage(error, t.assistant.installFailed) })
    }
  }, [api, patch, refresh, setupSink])

  const login = useCallback(async () => {
    patch({ busy: 'login', transcript: '', loginUrl: null, awaitingCode: false, error: null })
    try {
      await api.login(setupSink('login', () => void refresh(true)))
    } catch (error) {
      patch({ busy: null, error: assistantMessage(error, t.assistant.loginFailed) })
    }
  }, [api, patch, refresh, setupSink])

  const sendCode = useCallback(
    async (code: string) => {
      if (!code.trim()) return
      patch({ awaitingCode: false, error: null })
      try {
        await api.loginCode(code)
      } catch (error) {
        patch({ awaitingCode: true, error: assistantMessage(error, t.assistant.loginFailed) })
      }
    },
    [api, patch],
  )

  const cancelLogin = useCallback(async () => {
    await api.loginCancel().catch(() => undefined)
    patch({ busy: null, awaitingCode: false, loginUrl: null, transcript: '' })
  }, [api, patch])

  const logout = useCallback(async () => {
    try {
      await api.logout()
    } catch (error) {
      patch({ error: assistantMessage(error, t.assistant.failed) })
    }
    await refresh()
  }, [api, patch, refresh])

  // -- rozhovor --------------------------------------------------------------

  /**
   * Zeptat se na otevřenou poznámku.
   *
   * Kontextem je jen ona -- ne trezor, ne sousední soubory. Je to vědomé
   * omezení: co odchází z počítače, má jít spočítat na prstech.
   */
  const ask = useCallback(
    async (question: string) => {
      const text = question.trim()
      if (!text) return

      const current = viewRef.current
      if (!current.enabled || current.busy) return

      const editor = state.editor
      const { prompt, truncated } = buildQuestion({
        note: editor?.text ?? '',
        title: state.parsed?.frontmatter.title ?? editor?.path ?? '',
        question: text,
      })

      setView((view) => ({
        ...view,
        busy: 'ask',
        error: null,
        truncated,
        messages: [...view.messages, { role: 'user', text }],
      }))

      // Kousky chodí syrové; hranice řádků a jejich význam řeší `@/core`.
      const split = createLineSplitter()
      let sessionId = current.sessionId
      let failed = false

      const sink = (chunk: AssistantChunk) => {
        if (chunk.kind === 'failed') {
          failed = true
          setView((view) => ({
            ...view,
            busy: null,
            messages: failMessage(view.messages, chunk.message || t.assistant.failed),
          }))
          return
        }
        if (chunk.kind === 'finished') {
          // Bez `result` -- proces skončil dřív, než odpověď dopsal.
          setView((view) => ({
            ...view,
            busy: null,
            sessionId,
            messages: view.messages.some((message) => message.streaming)
              ? finishMessage(view.messages, '')
              : view.messages,
          }))
          return
        }

        for (const line of split(chunk.text)) {
          const event = parseAssistantLine(line)
          if (event.type === 'delta') {
            setView((view) => ({ ...view, messages: appendDelta(view.messages, event.text) }))
          } else if (event.type === 'done') {
            sessionId = event.sessionId ?? sessionId
            setView((view) => ({
              ...view,
              messages: finishMessage(view.messages, event.text),
            }))
          } else if (event.type === 'error') {
            failed = true
            setView((view) => ({
              ...view,
              busy: null,
              messages: failMessage(view.messages, event.message),
            }))
          }
        }
      }

      try {
        await api.ask(
          {
            prompt,
            system: ASSISTANT_SYSTEM_PROMPT,
            sessionId: current.sessionId,
            model: current.model || null,
          },
          sink,
        )
      } catch (error) {
        if (failed) return
        setView((view) => ({
          ...view,
          busy: null,
          messages: failMessage(view.messages, assistantMessage(error, t.assistant.failed)),
        }))
      }
    },
    [api, state.editor, state.parsed],
  )

  const stop = useCallback(async () => {
    await api.cancel().catch(() => undefined)
    setView((view) => ({
      ...view,
      busy: null,
      messages: view.messages.some((message) => message.streaming)
        ? failMessage(view.messages, t.assistant.cancelled)
        : view.messages,
    }))
  }, [api])

  const reset = useCallback(() => {
    patch({ messages: [], sessionId: null, truncated: false, error: null })
  }, [patch])

  // -- panel -----------------------------------------------------------------

  const setEnabled = useCallback(
    async (enabled: boolean) => {
      patch({ enabled, ...(enabled ? {} : { messages: [], sessionId: null }) })
      await persist({ assistantEnabled: enabled })
      if (enabled) await refresh()
    },
    [patch, persist, refresh],
  )

  const setModel = useCallback(
    async (model: string) => {
      // Model platí od dalšího rozhovoru: měnit ho uprostřed sezení by
      // znamenalo, že polovina odpovědí je od někoho jiného.
      patch({ model, sessionId: null })
      await persist({ assistantModel: model })
    },
    [patch, persist],
  )

  const actions = useMemo<AssistantActions>(
    () => ({
      toggle: () => setView((view) => ({ ...view, open: !view.open })),
      close: () => patch({ open: false }),
      setEnabled,
      setModel,
      setSetupOpen: (open: boolean) => patch({ setupOpen: open }),
      refresh,
      install,
      login,
      sendCode,
      cancelLogin,
      logout,
      ask,
      stop,
      reset,
    }),
    [
      ask,
      cancelLogin,
      install,
      login,
      logout,
      patch,
      refresh,
      reset,
      sendCode,
      setEnabled,
      setModel,
      stop,
    ],
  )

  const value = useMemo<AssistantValue>(() => ({ view, actions, api }), [actions, api, view])

  return <AssistantContext.Provider value={value}>{children}</AssistantContext.Provider>
}

export function useAssistant(): AssistantValue {
  const value = useContext(AssistantContext)
  if (!value) throw new Error('useAssistant must be used inside <AssistantProvider>')
  return value
}
