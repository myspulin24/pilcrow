/**
 * App shell: layout, global keyboard handling, and the modal stack.
 */

import { useCallback, useEffect } from 'react'

import { t } from '@/core'
import { isTypingTarget, matchesShortcut } from '@/lib/shortcuts'
import { buildCommands } from '@/state/commands'
import { useAssistant } from '@/state/assistant-store'
import { useGit } from '@/state/git-store'
import { useActions, useAppState, useStore } from '@/state/store'
import { CommandPalette } from '@/ui/CommandPalette'
import { ContextMenu } from '@/ui/ContextMenu'
import { ConflictView } from '@/ui/ConflictView'
import { ErrorState, Spinner, Toasts } from '@/ui/Feedback'
import { ConfirmModal, PromptModal } from '@/ui/Modal'
import { AssistantPanel } from '@/ui/AssistantPanel'
import { SettingsDialog } from '@/ui/SettingsDialog'
import { UpdateDialog } from '@/ui/UpdateDialog'
import { Workspace } from '@/ui/Workspace'
import { NotePane } from '@/ui/NotePane'
import { Sidebar } from '@/ui/Sidebar'
import { StatusBar } from '@/ui/StatusBar'

export function App() {
  const { state } = useStore()
  const actions = useActions()
  const assistant = useAssistant()
  const git = useGit()
  const openPublish = git.view.step === 'ready' && git.view.selected.length > 0 ? git.actions.openPublish : undefined
  // Modals live in the store so the sidebar, the tree and the palette can all
  // raise one without threading callbacks through every component.
  const { prompt, confirm, menu } = state
  const requestPrompt = useCallback(actions.promptFor, [actions])
  const requestConfirm = useCallback(actions.confirmFor, [actions])

  // Global shortcuts. Commands own their bindings, so this listener never
  // needs to know what any of them do.
  useEffect(() => {
    if (state.phase !== 'ready') return
    const handler = (event: KeyboardEvent) => {
      if (state.paletteOpen || prompt || confirm || state.conflict || menu) return
      if (state.settingsOpen) return

      const commands = buildCommands({
        state,
        actions,
        prompt: requestPrompt,
        confirm: requestConfirm,
        toggleAssistant: assistant.actions.toggle,
        openPublish,
      })
      for (const command of commands) {
        if (!command.shortcut) continue
        // Plain, unmodified keys (F2) must not fire while typing.
        if (!command.shortcut.mod && isTypingTarget(event.target)) continue
        if (!matchesShortcut(event, command.shortcut)) continue
        event.preventDefault()
        void command.run()
        return
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [state, actions, assistant, openPublish, prompt, confirm, menu, requestPrompt, requestConfirm])

  // `#note/<path>` links inside the preview.
  useEffect(() => {
    const onHashChange = () => {
      const match = /^#note\/(.+)$/.exec(window.location.hash)
      if (match?.[1]) void actions.open(decodeURIComponent(match[1]))
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [actions])

  if (state.phase === 'starting') {
    return (
      <div className="app app--centered">
        <Spinner label={t.app.opening} />
      </div>
    )
  }

  if (state.phase === 'failed') {
    return (
      <div className="app app--centered">
        <ErrorState
          title={t.app.failedTitle}
          message={`${state.fatal?.message ?? t.app.unknownError} ${t.app.failedHint}`}
          retry={{ label: t.app.retry, onClick: () => window.location.reload() }}
        />
      </div>
    )
  }

  return (
    <div className="app">
      <div className="app__main">
        {state.sidebarVisible ? <Sidebar /> : null}
        <Workspace />
        <NotePane />
        <AssistantPanel />
      </div>
      <StatusBar />

      <CommandPalette prompt={requestPrompt} confirm={requestConfirm} />
      {prompt ? <PromptModal request={prompt} onClose={actions.dismissPrompt} /> : null}
      {confirm ? <ConfirmModal request={confirm} onClose={actions.dismissConfirm} /> : null}
      {menu ? <ContextMenu request={menu} onClose={actions.closeMenu} /> : null}
      <SettingsDialog />
      <ConflictView />
      <UpdateDialog />
      <Toasts />
    </div>
  )
}

/** Re-exported so tests can assert on the same state the shell renders. */
export { useAppState }
