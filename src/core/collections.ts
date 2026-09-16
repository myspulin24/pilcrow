/**
 * Collections: your own groups of files.
 *
 * Pure operations on the list. Persistence is the vault's job; everything here
 * is a function from collections to collections, which is what makes the rules
 * -- no duplicate members, no empty names, stable ids -- directly testable.
 */

import { t } from './messages'
import { baseName, stemOf } from './tree'

export interface CollectionItem {
  /** Absolute path for an external file, vault-relative for a note. */
  path: string
  label: string
  /** False for a vault note, true for anything else on disk. */
  external: boolean
}

export interface Collection {
  id: string
  name: string
  items: CollectionItem[]
}

const MAX_NAME_LENGTH = 60

export interface NameCheck {
  ok: boolean
  value: string
  message?: string
}

/** Validate a collection name the user typed. */
export function validateCollectionName(input: string, existing: Collection[] = []): NameCheck {
  const value = (input ?? '').trim().replace(/\s+/g, ' ')
  if (!value) return { ok: false, value: '', message: t.names.groupEmpty }
  if (value.length > MAX_NAME_LENGTH) {
    return { ok: false, value, message: t.names.groupTooLong(MAX_NAME_LENGTH) }
  }
  if (existing.some((collection) => collection.name.toLowerCase() === value.toLowerCase())) {
    return { ok: false, value, message: t.names.groupDuplicate(value) }
  }
  return { ok: true, value }
}

/** Short, stable id. Collections are few, so time plus randomness is plenty. */
export function collectionId(now: number = Date.now(), random: () => number = Math.random): string {
  return `c${Math.floor(now).toString(36)}${Math.floor(random() * 1e6).toString(36)}`
}

export function createCollection(
  collections: Collection[],
  name: string,
  makeId: () => string = () => collectionId(),
): Collection[] {
  return [...collections, { id: makeId(), name: name.trim(), items: [] }]
}

export function renameCollection(collections: Collection[], id: string, name: string): Collection[] {
  return collections.map((collection) =>
    collection.id === id ? { ...collection, name: name.trim() } : collection,
  )
}

export function deleteCollection(collections: Collection[], id: string): Collection[] {
  return collections.filter((collection) => collection.id !== id)
}

/** A sensible label for a file: its name without the extension. */
export function itemLabel(path: string): string {
  return stemOf(baseName(path)) || path
}

export function makeItem(path: string, external: boolean, label?: string): CollectionItem {
  return { path, external, label: (label ?? '').trim() || itemLabel(path) }
}

/**
 * Add a file to a collection.
 *
 * Adding the same file twice is a no-op rather than an error -- the user's
 * intent ("this belongs in here") is already satisfied.
 */
export function addToCollection(
  collections: Collection[],
  id: string,
  item: CollectionItem,
): Collection[] {
  return collections.map((collection) => {
    if (collection.id !== id) return collection
    if (collection.items.some((existing) => samePath(existing.path, item.path))) return collection
    return { ...collection, items: [...collection.items, item] }
  })
}

export function removeFromCollection(
  collections: Collection[],
  id: string,
  path: string,
): Collection[] {
  return collections.map((collection) =>
    collection.id === id
      ? { ...collection, items: collection.items.filter((item) => !samePath(item.path, path)) }
      : collection,
  )
}

/** Drop a file from every collection -- used when the file itself is deleted. */
export function forgetPath(collections: Collection[], path: string): Collection[] {
  return collections.map((collection) => ({
    ...collection,
    items: collection.items.filter((item) => !samePath(item.path, path)),
  }))
}

/** Which collections already contain this file. */
export function collectionsContaining(collections: Collection[], path: string): Collection[] {
  return collections.filter((collection) =>
    collection.items.some((item) => samePath(item.path, path)),
  )
}

/**
 * Paths compare case-insensitively with separators normalised, because Windows
 * hands back `C:\Notes\a.md` where a drop might give `C:/Notes/a.md`.
 */
export function samePath(a: string, b: string): boolean {
  return normalizePath(a) === normalizePath(b)
}

export function normalizePath(path: string): string {
  return (path ?? '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

/** Total number of linked files, for the rail's header. */
export function countItems(collections: Collection[]): number {
  return collections.reduce((total, collection) => total + collection.items.length, 0)
}
