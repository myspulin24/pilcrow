import { describe, expect, it } from 'vitest'

import { hashText, sha256Bytes } from './hash'

describe('sha256', () => {
  /**
   * These vectors also appear in `src-tauri/crates/pilcrow-core/src/vault.rs`.
   * The two implementations must agree, because conflict detection compares a
   * hash computed in the browser against one computed in Rust.
   */
  it('matches the published SHA-256 test vectors', () => {
    expect(hashText('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(hashText('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(hashText('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    )
  })

  it('hashes input longer than one block', () => {
    expect(hashText('a'.repeat(1000))).toBe(
      '41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3',
    )
  })

  it('hashes multi-byte UTF-8 the same way a byte-oriented hasher does', () => {
    // "über" is 5 bytes, not 4 characters' worth.
    expect(hashText('über')).toBe(sha256Bytes(new TextEncoder().encode('über')))
    expect(hashText('日本語')).toHaveLength(64)
  })

  it('is stable and sensitive to a single-character change', () => {
    expect(hashText('note')).toBe(hashText('note'))
    expect(hashText('note')).not.toBe(hashText('notes'))
  })

  it('handles inputs that land exactly on a block boundary', () => {
    for (const length of [55, 56, 57, 63, 64, 65, 119, 120]) {
      expect(hashText('x'.repeat(length))).toMatch(/^[0-9a-f]{64}$/)
    }
  })
})
