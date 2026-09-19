/**
 * The command registry.
 *
 * One list drives the command palette, the keyboard listener and the buttons in
 * the toolbar, so every action in Pilcrow is reachable without the mouse and shows
 * the same binding everywhere.
 */

import { t } from '@/core'
import type { Shortcut } from '@/lib/shortcuts'
import type { Actions, AppState, ConfirmRequest, PromptRequest } from './store'

export type { ConfirmRequest, PromptRequest }

export interface Command {
  id: string
  title: string
  group: string
  hint?: string
  shortcut?: Shortcut
  /** False hides the command from the palette and disables its shortcut. */
  enabled?: boolean
  run: () => void | Promise<void>
}

export interface CommandContext {
  state: AppState
  actions: Actions
  prompt: (request: PromptRequest) => void
  confirm: (request: ConfirmRequest) => void
  /** Otevřít nebo zavřít panel asistenta. Chybí tam, kde asistent není. */
  toggleAssistant?: () => void
  /** Otevřít dialog odeslání do gitu. Chybí, když není co odeslat. */
  openPublish?: () => void
}

export function buildCommands({
  state,
  actions,
  prompt,
  confirm,
  toggleAssistant,
  openPublish,
}: CommandContext): Command[] {
  const hasNote = state.activePath !== null
  const activePath = state.activePath ?? ''
  const activeTitle = state.parsed?.frontmatter.title ?? ''
  const pinned = state.parsed?.frontmatter.pinned ?? false

  const commands: Command[] = [
    {
      id: 'note.new',
      title: t.commands.newNote,
      group: t.palette.groups.note,
      shortcut: { key: 'n', mod: true },
      run: () =>
        prompt({
          title: t.dialogs.newNote,
          label: t.dialogs.newNoteLabel,
          placeholder: t.dialogs.newNotePlaceholder,
          confirmLabel: t.common.create,
          onSubmit: (value) => void actions.create({ title: value }),
        }),
    },
    {
      id: 'note.new-in-folder',
      title: t.commands.newNoteInFolder,
      group: t.palette.groups.note,
      shortcut: { key: 'n', mod: true, shift: true },
      run: () =>
        prompt({
          title: t.dialogs.newNoteInFolder,
          label: t.dialogs.newNoteInFolderLabel,
          placeholder: t.dialogs.newNoteInFolderPlaceholder,
          confirmLabel: t.common.create,
          onSubmit: (value) => {
            const parts = value.split('/')
            const title = parts.pop() ?? ''
            void actions.create({ title, folder: parts.join('/') })
          },
        }),
    },
    {
      id: 'note.daily',
      title: t.commands.dailyNote,
      group: t.palette.groups.navigate,
      shortcut: { key: 'd', mod: true },
      run: () => void actions.openDaily(),
    },
    {
      id: 'note.rename',
      title: t.commands.renameNote,
      group: t.palette.groups.note,
      hint: t.commands.renameNoteHint,
      shortcut: { key: 'F2' },
      enabled: hasNote,
      run: () =>
        prompt({
          title: t.dialogs.renameNote,
          label: t.dialogs.renameNoteLabel,
          initialValue: activeTitle,
          confirmLabel: t.common.rename,
          validate: (value) => (value.trim() ? null : t.common.nameEmpty),
          onSubmit: (value) => void actions.rename(activePath, value),
        }),
    },
    {
      id: 'note.move',
      title: t.commands.moveNote,
      group: t.palette.groups.note,
      shortcut: { key: 'm', mod: true, shift: true },
      enabled: hasNote,
      run: () =>
        prompt({
          title: t.dialogs.moveNote,
          label: t.dialogs.moveNoteLabel,
          initialValue: activePath.includes('/') ? activePath.slice(0, activePath.lastIndexOf('/')) : '',
          placeholder: t.dialogs.moveNotePlaceholder,
          confirmLabel: t.dialogs.move,
          onSubmit: (value) => void actions.move(activePath, value),
        }),
    },
    {
      id: 'note.link',
      title: t.commands.insertLink,
      group: t.palette.groups.note,
      shortcut: { key: 'l', mod: true },
      enabled: hasNote,
      run: () => actions.setPalette(true, 'link'),
    },
    {
      id: 'note.math',
      title: t.toolbar.mathEditor,
      group: t.palette.groups.note,
      hint: t.math.help,
      // Ctrl + M chytá i textarea; v paletě je hlavně kvůli tomu, aby se na
      // editor vzorců dalo přijít, i když o něm člověk neví.
      shortcut: { key: 'm', mod: true },
      enabled: hasNote,
      run: () => actions.openMath(),
    },
    {
      id: 'note.pin',
      title: pinned ? t.note.unpin : t.note.pin,
      group: t.palette.groups.note,
      shortcut: { key: 'p', mod: true, shift: true },
      enabled: hasNote,
      run: () => void actions.togglePin(activePath),
    },
    {
      id: 'note.save',
      title: t.commands.saveNow,
      group: t.palette.groups.note,
      shortcut: { key: 's', mod: true },
      enabled: hasNote,
      run: () => void actions.save({ force: false }),
    },
    {
      id: 'note.delete',
      title: t.commands.deleteNote,
      group: t.palette.groups.note,
      enabled: hasNote,
      run: () =>
        confirm({
          title: t.dialogs.deleteNoteTitle,
          message: t.dialogs.deleteNoteMessage(activeTitle),
          confirmLabel: t.common.delete,
          destructive: true,
          onConfirm: () => void actions.remove(activePath),
        }),
    },
    {
      id: 'explorer.open-file',
      title: t.commands.openFile,
      group: t.palette.groups.explorer,
      hint: t.commands.openFileHint,
      shortcut: { key: 'o', mod: true },
      run: () => void actions.openFileFromDisk(),
    },
    {
      id: 'explorer.open-folder',
      title: t.commands.openFolder,
      group: t.palette.groups.explorer,
      hint: t.commands.openFolderHint,
      shortcut: { key: 'o', mod: true, shift: true },
      run: () => void actions.openFolderFromDisk(),
    },
    {
      id: 'explorer.refresh',
      title: t.commands.rescan,
      group: t.palette.groups.explorer,
      enabled: state.explorer.rootPath !== null,
      run: () => void actions.refreshTree(),
    },
    {
      id: 'explorer.expand',
      title: t.commands.expandAll,
      group: t.palette.groups.explorer,
      enabled: state.explorer.tree !== null,
      run: () => actions.expandAllFolders(),
    },
    {
      id: 'explorer.collapse',
      title: t.commands.collapseAll,
      group: t.palette.groups.explorer,
      enabled: state.explorer.tree !== null,
      run: () => actions.collapseAllFolders(),
    },
    {
      id: 'explorer.close',
      title: t.commands.closeFolder,
      group: t.palette.groups.explorer,
      enabled: state.explorer.rootPath !== null || state.explorer.loneFile !== null,
      run: () => actions.closeFolder(),
    },
    {
      id: 'view.files-section',
      title: t.commands.toggleFiles(state.filesSectionOpen),
      group: t.palette.groups.view,
      shortcut: { key: 'b', mod: true },
      run: () => actions.toggleFilesSection(),
    },
    {
      id: 'view.notes-section',
      title: t.commands.toggleNotes(state.notesSectionOpen),
      group: t.palette.groups.view,
      run: () => actions.toggleNotesSection(),
    },
    {
      id: 'nav.search',
      title: t.commands.search,
      group: t.palette.groups.navigate,
      shortcut: { key: 'f', mod: true },
      run: () => {
        const input = document.querySelector<HTMLInputElement>('[data-search-input]')
        input?.focus()
        input?.select()
      },
    },
    {
      id: 'nav.palette',
      title: t.commands.palette,
      group: t.palette.groups.navigate,
      shortcut: { key: 'k', mod: true },
      run: () => actions.setPalette(true, 'commands'),
    },
    {
      id: 'view.cycle',
      title: t.commands.cycleView,
      group: t.palette.groups.view,
      hint: t.commands.cycleViewHint(
        state.viewMode === 'editor' ? t.view.raw : state.viewMode === 'split' ? t.view.both : t.view.preview,
      ),
      shortcut: { key: 'e', mod: true },
      run: () => actions.cycleViewMode(),
    },
    {
      id: 'collection.new',
      title: t.commands.newGroup,
      group: t.palette.groups.collections,
      hint: t.commands.newGroupHint,
      shortcut: { key: 'g', mod: true, shift: true },
      run: () =>
        prompt({
          title: t.dialogs.newGroup,
          label: t.dialogs.groupNameLabel,
          placeholder: t.dialogs.groupNamePlaceholder,
          confirmLabel: t.common.create,
          onSubmit: (value) => void actions.createCollection(value),
        }),
    },
    {
      id: 'view.sidebar',
      title: t.commands.toggleRail(state.sidebarVisible),
      group: t.palette.groups.view,
      shortcut: { key: '\\', mod: true },
      run: () => actions.toggleSidebar(),
    },
    {
      id: 'vault.rebuild',
      title: t.commands.rebuildIndex,
      group: t.palette.groups.vault,
      hint: t.commands.rebuildIndexHint,
      shortcut: { key: 'r', mod: true, shift: true },
      run: () => void actions.rebuildIndex(),
    },
    {
      id: 'vault.export',
      title: t.commands.exportVault,
      group: t.palette.groups.vault,
      hint: t.commands.exportVaultHint,
      run: () => void actions.exportVault(),
    },
    {
      id: 'vault.import',
      title: t.commands.importFolder,
      group: t.palette.groups.vault,
      run: () => void actions.importFolder(),
    },
    {
      id: 'vault.reveal',
      title: t.commands.revealVault,
      group: t.palette.groups.vault,
      run: () => void actions.reveal(),
    },
    {
      id: 'app.update',
      title: t.update.check,
      group: t.palette.groups.app,
      hint: state.update.currentVersion
        ? t.update.version(state.update.currentVersion)
        : t.update.checkHint,
      // V prohlížeči nebo ve staré verzi bez updateru se příkaz vůbec neukáže,
      // místo aby skončil chybou.
      enabled: state.update.supported,
      run: () => void actions.checkForUpdates(true),
    },
    {
      id: 'app.settings',
      title: t.settings.open,
      group: t.palette.groups.app,
      hint: t.settings.openHint,
      shortcut: { key: ',', mod: true },
      run: () => actions.openSettings(),
    },
    {
      id: 'git.publish',
      title: t.commands.gitPublish,
      group: t.palette.groups.explorer,
      enabled: openPublish !== undefined,
      run: () => openPublish?.(),
    },
    {
      id: 'app.assistant',
      title: t.assistant.open,
      group: t.palette.groups.app,
      hint: t.assistant.openHint,
      // Asistent není součástí storu, takže si příkaz přebírá jen to jediné,
      // co po něm chce: otevřít panel.
      enabled: toggleAssistant !== undefined,
      run: () => toggleAssistant?.(),
    },
  ]

  // A disabled command is hidden from the palette and its shortcut goes quiet,
  // so "Rename note" with nothing open cannot fire at all.
  return commands.filter((command) => command.enabled !== false)
}
