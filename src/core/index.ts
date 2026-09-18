/**
 * Public surface of the pure core.
 *
 * Nothing in here touches the file system, Tauri or React, which is what makes
 * it directly unit-testable and what lets the in-memory vault adapter share
 * exactly the same behaviour as the real one.
 */
export * from './types'
export * from './frontmatter'
export * from './mask'
export * from './tags'
export * from './wikilinks'
export * from './slug'
export * from './note'
export * from './markdown'
export * from './search-query'
export * from './conflict'
export * from './hash'
export * from './daily'
export * from './tree'
export * from './collections'
export * from './view-mode'
export * from './math'
export * from './math-languages'
export * from './format'
export * from './version'
export * from './messages'
export * from './assistant'
