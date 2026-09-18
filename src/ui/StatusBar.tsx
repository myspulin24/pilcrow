/**
 * Bottom strip: where the vault lives, how many notes are indexed, and whether
 * anything is degraded (no FTS5, in-memory backend, a long-running operation).
 */

import { t } from '@/core'
import { useAssistant } from '@/state/assistant-store'
import { useActions, useAppState } from '@/state/store'

export function StatusBar() {
  const state = useAppState()
  const actions = useActions()
  const assistant = useAssistant()
  const status = state.status

  return (
    <footer className="status-bar">
      <span className="status-bar__item status-bar__item--path" title={status?.vaultPath ?? ''}>
        {status?.vaultPath ?? t.status.noVault}
      </span>
      <span className="status-bar__spacer" />

      {state.busy ? (
        <span className="status-bar__item status-bar__item--busy" role="status">
          {state.busy}...
        </span>
      ) : null}

      {status && !status.fullTextSearch ? (
        <span className="status-bar__item status-bar__item--warn" title={t.status.substringSearchHint}>
          {t.status.substringSearch}
        </span>
      ) : null}

      {status?.backend === 'memory' ? (
        <span className="status-bar__item status-bar__item--warn">{t.status.inMemory}</span>
      ) : null}

      <span className="status-bar__item">{t.status.notes(status?.noteCount ?? 0)}</span>

      {/* Verze je tu proto, aby „mám nejnovější?“ šlo zodpovědět pohledem, a
          kliknutím se to rovnou ověří. V prohlížeči aktualizovat nejde, tak
          se tlačítko vůbec nenabízí. */}
      {state.update.supported && state.update.currentVersion ? (
        <button
          type="button"
          className={`status-bar__button ${
            state.update.phase === 'ready' || state.update.phase === 'available'
              ? 'status-bar__button--attention'
              : ''
          }`}
          onClick={() => void actions.checkForUpdates(true)}
          title={t.update.checkHint}
        >
          {state.update.phase === 'downloading'
            ? t.update.downloadingShort
            : state.update.phase === 'ready'
              ? t.update.readyTitle
              : t.update.version(state.update.currentVersion)}
        </button>
      ) : null}

      {/* Asistent se otevírá odsud, ne z lišty nahoře: je to volba, ne nástroj,
          který má být pořád po ruce. */}
      <button
        type="button"
        className={`status-bar__button ${assistant.view.open ? 'status-bar__button--attention' : ''}`}
        onClick={assistant.actions.toggle}
        title={t.assistant.openHint}
        aria-pressed={assistant.view.open}
      >
        {t.assistant.title}
      </button>

      <button
        type="button"
        className="status-bar__button"
        onClick={actions.openSettings}
        title={t.settings.openHint}
      >
        {t.settings.title}
      </button>

      <button
        type="button"
        className="status-bar__button"
        onClick={() => void actions.rebuildIndex()}
        title={t.status.rebuildIndexHint}
      >
        {t.status.rebuildIndex}
      </button>
      <button type="button" className="status-bar__button" onClick={() => void actions.exportVault()}>
        {t.status.export}
      </button>
      <button type="button" className="status-bar__button" onClick={() => actions.setPalette(true, 'commands')}>
        {t.status.commands}
      </button>
    </footer>
  )
}
