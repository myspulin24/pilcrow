/**
 * The workspace: the single left column you navigate from.
 *
 * One search box at the top, and underneath it the two places a document can
 * come from, as collapsible sections:
 *
 *   NOTES    your vault  — titles, excerpts, tags
 *   <folder> any folder you opened — a tree of sub-folders and .md files
 *   GIT      when that folder is in a repository — changes, publish, CI
 *
 * They share the search box: typing narrows the notes by full text and the
 * tree by file name at the same time. Keeping both in one column is the point
 * — navigation on one side, the document on the other.
 *
 * You can also drop files or a folder onto the window from the OS; that is
 * handled here too, since this is where the result shows up.
 */

import { useRef } from 'react'

import {
  folderLabel,
  folderOf,
  folderSectionKey,
  relativePath,
  sameFolder,
  SECTION_NOTES,
  t,
  type OpenFolder,
} from '@/core'
import { useRepos } from '@/state/repos-store'
import { useActions, useAppState } from '@/state/store'
import { Spinner } from './Feedback'
import { FileIcon, FileTree, FolderIcon } from './FileTree'
import { GitSection } from './GitSection'
import { NoteList } from './NoteList'
import { ResizeHandle } from './ResizeHandle'
import { Section } from './Section'

/**
 * Jedna otevřená složka: hlavička, ikony a strom.
 *
 * Aktivní složka je ta, ke které patří sekce Git. Přepíná se kliknutím do
 * hlavičky, ale jen tehdy, když aktivní není -- na aktivní složce hlavička
 * dělá to co vždycky, sbalí a rozbalí blok. Jedno kliknutí tak nikdy
 * neudělá dvě věci naráz.
 */
function FolderSection({ folder, active }: { folder: OpenFolder; active: boolean }) {
  const state = useAppState()
  const actions = useActions()
  const name = folderLabel(folder.rootPath)
  const id = `ws-files-${folderSectionKey(folder.rootPath).replace(/[^a-z0-9]+/gi, '-')}`

  const icons = (
    <>
      <button
        type="button"
        className="ws-icon-button"
        title={t.workspace.expandAllHint}
        aria-label={t.workspace.expandAll}
        onClick={() => actions.expandAllFolders(folder.rootPath)}
      >
        {'⇲'}
      </button>
      <button
        type="button"
        className="ws-icon-button"
        title={t.workspace.collapseAllHint}
        aria-label={t.workspace.collapseAll}
        onClick={() => actions.collapseAllFolders(folder.rootPath)}
      >
        {'⇱'}
      </button>
      <button
        type="button"
        className={`ws-icon-button ${folder.loading ? 'is-busy' : ''}`}
        title={t.workspace.refreshHint}
        aria-label={t.workspace.refresh}
        aria-busy={folder.loading}
        disabled={folder.loading}
        onClick={() => void actions.refreshTree(folder.rootPath)}
      >
        <span aria-hidden="true">{'↻'}</span>
      </button>
      <button
        type="button"
        className="ws-icon-button"
        title={t.workspace.closeFolderHint}
        aria-label={t.workspace.closeFolder}
        onClick={() => actions.closeFolder(folder.rootPath)}
      >
        {'×'}
      </button>
    </>
  )

  return (
    <Section
      id={id}
      active={active}
      activeLabel={t.workspace.activeFolder}
      title={
        <>
          <FolderIcon open={folder.open} />
          <span className="ws-section__label">{name}</span>
        </>
      }
      meta={
        <>
          {t.workspace.files_(folder.fileCount)}
          {folder.truncated ? (
            <span className="ws-section__warn"> · {t.workspace.partialScan}</span>
          ) : null}
        </>
      }
      titleHint={active ? folder.rootPath : t.workspace.activateFolder(name)}
      open={folder.open}
      onToggle={() =>
        active ? actions.toggleFolderSection(folder.rootPath) : actions.activateFolder(folder.rootPath)
      }
      resize={{ key: folderSectionKey(folder.rootPath), label: name }}
      actions={icons}
    >
      {folder.loading && !folder.tree ? (
        <Spinner label={t.workspace.scanning} />
      ) : folder.error ? (
        <>
          <p className="workspace__note workspace__note--error" role="alert">
            {folder.error}
          </p>
          <button
            type="button"
            className="workspace__link"
            onClick={() => void actions.openFolderFromDisk()}
          >
            {t.workspace.chooseAnother}
          </button>
        </>
      ) : folder.tree ? (
        <FileTree folder={folder} filter={state.query} />
      ) : null}
    </Section>
  )
}

export function Workspace() {
  const state = useAppState()
  const actions = useActions()
  const repos = useRepos()
  const searchRef = useRef<HTMLInputElement>(null)
  const { explorer } = state

  /** Cesta otevřeného souboru vůči složce, ze které je -- ne vůči aktivní. */
  const readingPath = state.activePath
    ? (() => {
        const owner = folderOf(explorer.folders, state.activePath)
        return owner ? relativePath(owner.rootPath, state.activePath) : state.activePath
      })()
    : ''

  /** Down/Up from the search box walks the note list, as it always has. */
  const stepNote = (delta: number) => {
    if (state.notes.length === 0) return
    const current = state.notes.findIndex((note) => note.path === state.activePath)
    const next = Math.min(state.notes.length - 1, Math.max(0, (current === -1 ? -1 : current) + delta))
    const note = state.notes[next]
    if (note) void actions.open(note.path)
  }

  return (
    <div className={`workspace ${state.dropActive ? 'is-drop-target' : ''}`} aria-label={t.workspace.label}>
      <div className="workspace__search">
        {state.sidebarVisible ? null : (
          <button
            type="button"
            className="workspace__reveal-rail"
            title={t.rail.showHint}
            aria-label={t.rail.show}
            onClick={() => actions.toggleSidebar()}
          >
            {'»'}
          </button>
        )}
        <input
          type="search"
          data-search-input
          ref={searchRef}
          className="workspace__input"
          placeholder={t.workspace.search}
          aria-label={t.workspace.search}
          value={state.query}
          onChange={(event) => actions.setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              stepNote(1)
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              stepNote(-1)
            } else if (event.key === 'Enter') {
              event.preventDefault()
              document.querySelector<HTMLTextAreaElement>('[data-editor-textarea]')?.focus()
            } else if (event.key === 'Escape') {
              actions.setQuery('')
            }
          }}
        />
        <button
          type="button"
          className="workspace__new"
          title={t.workspace.newNote}
          aria-label={t.workspace.newNote}
          onClick={() => void actions.create({ title: state.query.trim() || 'Untitled' })}
        >
          +
        </button>
      </div>

      {state.activeTag ? (
        <div className="workspace__filter">
          <span>
            {t.workspace.filteredByTag} <strong>#{state.activeTag}</strong>
          </span>
          <button type="button" onClick={() => actions.setActiveTag(null)}>
            {t.workspace.clearFilter}
          </button>
        </div>
      ) : null}

      <div className="workspace__scroll">
        <Section
          id="ws-notes"
          title={t.workspace.notes}
          meta={`${state.notes.length}`}
          open={state.notesSectionOpen}
          onToggle={() => actions.toggleNotesSection()}
          resize={{ key: SECTION_NOTES, label: t.workspace.notes }}
        >
          <NoteList />
        </Section>

        {explorer.folders.map((folder) => (
          <FolderSection
            key={folder.rootPath}
            folder={folder}
            active={sameFolder(folder.rootPath, explorer.active ?? '')}
          />
        ))}

        {/* Sekce Git patří aktivní složce, ale stojí pod všemi -- na jednom
            místě, které se sbalováním a rozbalováním složek nehýbe. Dřív byla
            hned pod tou aktivní a při každém sbalení uskočila jinam; navíc se
            při přepnutí složky celá přestavěla, takže si nepamatovala, jestli
            byla rozbalená. Ke které složce patří, je vidět v její hlavičce. */}
        <GitSection />

        {explorer.loneFile ? (
          <Section
            id="ws-files"
            title={t.workspace.openedFile}
            open={state.filesSectionOpen}
            onToggle={() => actions.toggleFilesSection()}
            actions={
              <button
                type="button"
                className="ws-icon-button"
                title={t.workspace.closeFileHint}
                aria-label={t.workspace.closeFolder}
                onClick={() => actions.closeFolder()}
              >
                {'×'}
              </button>
            }
          >
            <ul className="tree" aria-label={t.workspace.openedFile}>
              <li className="tree__row">
                <button
                  type="button"
                  className={`tree__button ${state.activePath === explorer.loneFile ? 'is-active' : ''}`}
                  title={explorer.loneFile}
                  data-tree-file={explorer.loneFile}
                  onClick={() => void actions.openFromTree(explorer.loneFile!)}
                >
                  <span className="tree__twisty tree__twisty--empty" aria-hidden="true" />
                  <FileIcon />
                  <span className="tree__name">{explorer.loneFile.split(/[\\/]/).pop()}</span>
                </button>
              </li>
            </ul>
            <p className="workspace__note">{t.workspace.loneFileHint}</p>
          </Section>
        ) : null}
      </div>

      <div className="workspace__actions">
        <button type="button" className="button" onClick={() => void actions.openFileFromDisk()}>
          {t.workspace.openFile}
        </button>
        <button
          type="button"
          className="button"
          title={explorer.folders.length > 0 ? t.workspace.openAnother : undefined}
          onClick={() => void actions.openFolderFromDisk()}
        >
          {t.workspace.openFolder}
        </button>
        {repos.view.open ? null : (
          <button
            type="button"
            className="button workspace__repos"
            title={t.repos.openHint}
            onClick={repos.actions.open}
          >
            {t.repos.open}
          </button>
        )}
      </div>

      {state.editor?.external && state.activePath ? (
        <div className="workspace__current" title={state.activePath}>
          <span className="workspace__current-label">{t.workspace.reading}</span>
          <span className="workspace__current-path">
            {readingPath}
          </span>
        </div>
      ) : null}

      <ResizeHandle />

      {state.dropActive ? (
        <div className="workspace__drop" aria-hidden="true">
          {t.workspace.dropHint}
        </div>
      ) : null}
    </div>
  )
}
