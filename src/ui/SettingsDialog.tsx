/**
 * Nastavení.
 *
 * Každá volba se ukládá hned, jak se změní -- žádné tlačítko „Uložit“ a žádný
 * dialog „opravdu zahodit změny?“. Nastavení je malé a jeho následky jsou
 * okamžitě vidět v okně za ním, takže potvrzování by jen přidávalo krok mezi
 * rozhodnutí a jeho výsledek.
 *
 * Poslední sekce je „O aplikaci“. Není to vizitka: je to odpověď na otázku,
 * kterou položí každý, komu něco nefunguje -- co tady vlastně běží.
 */

import { useEffect, useId, useState } from 'react'

import { t, VIEW_MODES, type ThemeSetting, type ViewMode } from '@/core'
import {
  frontendVersions,
  loadAppInfo,
  osName,
  webviewName,
  type AboutRow,
  type AppInfo,
} from '@/lib/about'
import { useAssistant } from '@/state/assistant-store'
import { useActions, useAppState } from '@/state/store'
import type { VaultSettings } from '@/vault'

import { Backdrop, useEscape } from './Modal'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="settings__section">
      <h3 className="settings__heading">{title}</h3>
      {children}
    </section>
  )
}

/** Jeden řádek: popisek vlevo, ovládání vpravo, vysvětlení pod tím. */
function Row({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string
  hint?: string
  htmlFor?: string
  children: React.ReactNode
}) {
  return (
    <div className="settings__row">
      <div className="settings__label">
        <label htmlFor={htmlFor}>{label}</label>
        {hint ? <p className="settings__hint">{hint}</p> : null}
      </div>
      <div className="settings__control">{children}</div>
    </div>
  )
}

function Toggle({
  id,
  checked,
  onChange,
  disabled,
}: {
  id: string
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
}) {
  return (
    <input
      id={id}
      type="checkbox"
      className="settings__toggle"
      checked={checked}
      disabled={disabled}
      onChange={(event) => onChange(event.target.checked)}
    />
  )
}

const VIEW_LABELS: Record<ViewMode, string> = {
  editor: t.view.raw,
  split: t.view.both,
  preview: t.view.preview,
}

function AboutTable({ rows }: { rows: AboutRow[] }) {
  return (
    <dl className="settings__facts">
      {rows.map((row) => (
        <div className="settings__fact" key={row.label}>
          <dt>{row.label}</dt>
          <dd>{row.value || '—'}</dd>
        </div>
      ))}
    </dl>
  )
}

function About() {
  const state = useAppState()
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false
    void loadAppInfo().then((value) => {
      if (!cancelled) setInfo(value)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const front = frontendVersions()
  const frontend: AboutRow[] = [
    { label: 'React', value: front.react ?? '' },
    { label: 'TypeScript', value: front.typescript ?? '' },
    { label: 'Vite', value: front.vite ?? '' },
    { label: 'KaTeX', value: front.katex ?? '' },
    { label: '@tauri-apps/api', value: front['@tauri-apps/api'] ?? '' },
    { label: 'Node (při sestavení)', value: front.node ?? '' },
  ]

  const backend: AboutRow[] = info
    ? [
        { label: 'Tauri', value: info.tauriVersion },
        { label: 'Rust', value: info.rustcVersion },
        { label: 'SQLite', value: info.sqliteVersion },
        { label: 'Cíl překladu', value: info.target },
      ]
    : []

  const runtime: AboutRow[] = info
    ? [
        { label: webviewName(info.os), value: info.webviewVersion },
        { label: 'Systém', value: `${osName(info.os)} (${info.arch})` },
        {
          label: 'Sestavení',
          value: info.profile === 'release' ? t.settings.profileRelease : t.settings.profileDebug,
        },
        { label: 'Identifikátor', value: info.identifier },
      ]
    : []

  const version = info?.version ?? ''

  /** Celý výpis jako text -- přesně to, co se hodí přilepit k hlášení chyby. */
  const copyAll = () => {
    const lines = [
      `${t.app.name} ${version}`.trim(),
      `${t.settings.author}: Michal Jašek`,
      '',
      ...[
        [t.settings.aboutFrontend, frontend],
        [t.settings.aboutBackend, backend],
        [t.settings.aboutRuntime, runtime],
      ].flatMap(([heading, rows]) =>
        (rows as AboutRow[]).length
          ? [`${heading as string}:`, ...(rows as AboutRow[]).map((r) => `  ${r.label}: ${r.value || '—'}`), '']
          : [],
      ),
    ]
    void navigator.clipboard?.writeText(lines.join('\n').trim()).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <Section title={t.settings.about}>
      <div className="settings__about-head">
        <div>
          <p className="settings__app-name">
            {t.app.name} {version}
          </p>
          <p className="settings__hint">© 2026 Michal Jašek · MIT</p>
        </div>
        <button type="button" className="button" onClick={copyAll}>
          {copied ? t.settings.copied : t.settings.copyAbout}
        </button>
      </div>

      <p className="settings__hint">{t.settings.aboutHint}</p>

      <h4 className="settings__subheading">{t.settings.aboutFrontend}</h4>
      <AboutTable rows={frontend} />

      {info ? (
        <>
          <h4 className="settings__subheading">{t.settings.aboutBackend}</h4>
          <AboutTable rows={backend} />
          <h4 className="settings__subheading">{t.settings.aboutRuntime}</h4>
          <AboutTable rows={runtime} />
        </>
      ) : (
        <p className="settings__hint">{t.settings.aboutUnavailable}</p>
      )}

      <h4 className="settings__subheading">{t.settings.notes}</h4>
      <AboutTable
        rows={[
          { label: t.settings.vaultPath, value: state.status?.vaultPath ?? '' },
          { label: t.settings.repository, value: 'github.com/myspulin24/pilcrow' },
        ]}
      />
    </Section>
  )
}

export function SettingsDialog() {
  const state = useAppState()
  const actions = useActions()
  const assistant = useAssistant()
  const labelId = useId()
  const ids = {
    theme: useId(),
    font: useId(),
    view: useId(),
    sidebar: useId(),
    toolbar: useId(),
    daily: useId(),
    updates: useId(),
  }
  useEscape(actions.closeSettings)

  if (!state.settingsOpen) return null
  const s = state.settings

  const set = (patch: Partial<VaultSettings>) => {
    void actions.updateSettings(patch).catch(() => actions.toast('error', t.settings.saveFailed))
  }

  // `.env` je tvrdší než tenhle přepínač; když vypne aktualizace tam,
  // přepínač to nepřebije a nemá smysl předstírat, že ano.
  const updatesBlocked = state.update.supported && !state.update.autoAllowed

  return (
    <Backdrop onClose={actions.closeSettings}>
      <div className="modal settings" role="dialog" aria-modal="true" aria-labelledby={labelId}>
        <header className="settings__head">
          <h2 id={labelId}>{t.settings.title}</h2>
          <button type="button" className="button button--ghost" onClick={actions.closeSettings}>
            {t.settings.close}
          </button>
        </header>

        <div className="settings__body">
          <Section title={t.settings.appearance}>
            <Row label={t.settings.theme} hint={t.settings.themeHint} htmlFor={ids.theme}>
              <select
                id={ids.theme}
                className="settings__select"
                value={s.theme}
                onChange={(event) => set({ theme: event.target.value as ThemeSetting })}
              >
                <option value="system">{t.settings.themeSystem}</option>
                <option value="light">{t.settings.themeLight}</option>
                <option value="dark">{t.settings.themeDark}</option>
              </select>
            </Row>

            <Row label={t.settings.fontSize} hint={t.settings.fontSizeHint} htmlFor={ids.font}>
              <div className="settings__slider">
                <input
                  id={ids.font}
                  type="range"
                  min={11}
                  max={24}
                  value={s.editorFontSize}
                  onChange={(event) => set({ editorFontSize: Number(event.target.value) })}
                />
                <span className="settings__value">{s.editorFontSize} px</span>
              </div>
            </Row>
          </Section>

          <Section title={t.settings.startup}>
            <Row label={t.settings.defaultView} hint={t.settings.defaultViewHint} htmlFor={ids.view}>
              <select
                id={ids.view}
                className="settings__select"
                value={s.defaultViewMode}
                onChange={(event) => set({ defaultViewMode: event.target.value as ViewMode })}
              >
                {VIEW_MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {VIEW_LABELS[mode]}
                  </option>
                ))}
              </select>
            </Row>

            <Row label={t.settings.showSidebar} hint={t.settings.showSidebarHint} htmlFor={ids.sidebar}>
              <Toggle id={ids.sidebar} checked={s.showSidebar} onChange={(v) => set({ showSidebar: v })} />
            </Row>

            <Row label={t.settings.showToolbar} hint={t.settings.showToolbarHint} htmlFor={ids.toolbar}>
              <Toggle id={ids.toolbar} checked={s.showToolbar} onChange={(v) => set({ showToolbar: v })} />
            </Row>
          </Section>

          <Section title={t.settings.notes}>
            <Row label={t.settings.dailyFolder} hint={t.settings.dailyFolderHint} htmlFor={ids.daily}>
              <input
                id={ids.daily}
                className="settings__input"
                value={s.dailyFolder}
                onChange={(event) => set({ dailyFolder: event.target.value })}
                spellCheck={false}
              />
            </Row>

            <Row label={t.settings.vaultPath} hint={t.settings.vaultPathHint}>
              <div className="settings__path">
                <code>{state.status?.vaultPath ?? ''}</code>
                <button type="button" className="button" onClick={() => void actions.reveal()}>
                  {t.settings.reveal}
                </button>
              </div>
            </Row>
          </Section>

          <Section title={t.settings.updates}>
            <Row
              label={t.settings.checkUpdates}
              hint={updatesBlocked ? t.settings.checkUpdatesBlocked : t.settings.checkUpdatesHint}
              htmlFor={ids.updates}
            >
              <Toggle
                id={ids.updates}
                checked={s.checkUpdates && !updatesBlocked}
                disabled={updatesBlocked}
                onChange={(v) => set({ checkUpdates: v })}
              />
            </Row>
            {state.update.supported ? (
              <div className="settings__actions">
                <button type="button" className="button" onClick={() => void actions.checkForUpdates(true)}>
                  {t.settings.checkNow}
                </button>
              </div>
            ) : null}
          </Section>

          <Section title={t.settings.assistant}>
            <p className="settings__hint">
              {s.assistantEnabled ? t.settings.assistantOn : t.settings.assistantOff}
            </p>
            <div className="settings__actions">
              <button
                type="button"
                className="button"
                onClick={() => {
                  actions.closeSettings()
                  if (!assistant.view.open) assistant.actions.toggle()
                }}
              >
                {t.settings.assistantOpen}
              </button>
            </div>
          </Section>

          <About />
        </div>
      </div>
    </Backdrop>
  )
}
