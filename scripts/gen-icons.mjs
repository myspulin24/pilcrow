#!/usr/bin/env node
/**
 * Generate the application icons.
 *
 * Tauri's bundler needs PNG, ICO and ICNS files, and `tauri icon` needs an
 * image toolchain we would otherwise have to install. Since the mark is a few
 * geometric primitives, drawing it here keeps the repo dependency-free and the
 * icons reproducible: `npm run icons` regenerates byte-identical files.
 *
 * The mark is a rounded square with a warm gradient and a white pilcrow (¶),
 * the paragraph mark the application is named after.
 */

import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ICONS_DIR = join(HERE, '..', 'src-tauri', 'icons')

// --- PNG encoding -----------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buffer) {
  let c = 0xffffffff
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([length, body, crc])
}

/** Encode RGBA pixel data as a PNG. */
function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type: RGBA
  ihdr[10] = 0 // deflate
  ihdr[11] = 0 // adaptive filtering
  ihdr[12] = 0 // no interlacing

  // One filter byte (0 = None) per scanline.
  const raw = Buffer.alloc(height * (width * 4 + 1))
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 4 + 1)
    raw[rowStart] = 0
    rgba.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// --- the mark ---------------------------------------------------------------

const BG_TOP = [0xb4, 0x53, 0x2a]
const BG_BOTTOM = [0x5c, 0x27, 0x14]

function mix(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ]
}

/**
 * Coverage of the rounded-square background at a point, 0..1.
 * Signed-distance field for a rounded box, so edges anti-alias for free.
 */
function boxCoverage(x, y, size) {
  const radius = size * 0.22
  const half = size / 2
  const inset = size * 0.04
  const dx = Math.abs(x - half) - (half - inset - radius)
  const dy = Math.abs(y - half) - (half - inset - radius)
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0))
  const distance = outside + Math.min(Math.max(dx, dy), 0) - radius
  return clamp01(0.5 - distance)
}

/** Signed distance to a thick line segment, used for the bowl's spine. */
function segmentDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax
  const dy = by - ay
  const lengthSquared = dx * dx + dy * dy
  const t = lengthSquared === 0 ? 0 : clamp01(((px - ax) * dx + (py - ay) * dy) / lengthSquared)
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/**
 * Coverage of the white pilcrow (¶) at a point, 0..1.
 *
 * Three primitives unioned: the full-height stem on the right, a shorter stem
 * beside it, and the solid bowl that closes over them both. Each returns a
 * signed distance, so edges anti-alias for free.
 *
 * The bowl is solid rather than a ring on purpose: at 16 px an outlined bowl
 * closes up into a grey smudge, while a filled one stays a recognisable mark.
 */
function glyphCoverage(x, y, size) {
  const top = size * 0.23
  const bottom = size * 0.79
  const stroke = size * 0.05 // half-thickness of a stem

  const rightStem = size * 0.6
  const leftStem = size * 0.455

  const bowlRadius = size * 0.135
  const bowlCenterY = top + bowlRadius
  // Left end of the bowl's spine; the round cap reaches `bowlRadius` further.
  const bowlStart = size * 0.3 + bowlRadius

  // 1. Right stem: full height, the spine of the mark.
  const rightDistance = Math.max(Math.abs(x - rightStem) - stroke, top - y, y - bottom)

  // 2. Left stem: descends from inside the bowl, parallel to the first.
  const leftDistance = Math.max(Math.abs(x - leftStem) - stroke, bowlCenterY - y, y - bottom)

  // 3. Bowl: a capsule, clipped at the right stem so it does not bulge past
  //    it -- the stem supplies that edge itself.
  let bowlDistance = Number.POSITIVE_INFINITY
  if (x <= rightStem) {
    bowlDistance =
      segmentDistance(x, y, bowlStart, bowlCenterY, rightStem, bowlCenterY) - bowlRadius
  }

  const distance = Math.min(rightDistance, leftDistance, bowlDistance)
  return clamp01(0.5 - distance)
}

function clamp01(value) {
  return value < 0 ? 0 : value > 1 ? 1 : value
}

/** Render the icon at `size`, supersampled 3x3 for smooth edges. */
function renderIcon(size) {
  const rgba = Buffer.alloc(size * size * 4)
  const samples = 3
  const step = 1 / (samples + 1)

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let box = 0
      let glyph = 0
      for (let sy = 1; sy <= samples; sy++) {
        for (let sx = 1; sx <= samples; sx++) {
          const px = x + sx * step
          const py = y + sy * step
          box += boxCoverage(px, py, size)
          glyph += glyphCoverage(px, py, size)
        }
      }
      const total = samples * samples
      box /= total
      glyph /= total

      const base = mix(BG_TOP, BG_BOTTOM, y / size)
      // The glyph is white, composited over the background, and both are
      // clipped by the rounded box so the corners stay transparent.
      const t = Math.min(glyph, box)
      const offset = (y * size + x) * 4
      rgba[offset] = Math.round(base[0] + (255 - base[0]) * t)
      rgba[offset + 1] = Math.round(base[1] + (255 - base[1]) * t)
      rgba[offset + 2] = Math.round(base[2] + (255 - base[2]) * t)
      rgba[offset + 3] = Math.round(box * 255)
    }
  }
  return encodePng(size, size, rgba)
}

// --- container formats ------------------------------------------------------

/** ICO with PNG-compressed entries (Windows Vista and later). */
function encodeIco(entries) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(entries.length, 4)

  const directory = Buffer.alloc(16 * entries.length)
  let offset = header.length + directory.length

  entries.forEach((entry, i) => {
    const at = i * 16
    directory[at] = entry.size >= 256 ? 0 : entry.size
    directory[at + 1] = entry.size >= 256 ? 0 : entry.size
    directory[at + 2] = 0 // palette size
    directory[at + 3] = 0 // reserved
    directory.writeUInt16LE(1, at + 4) // colour planes
    directory.writeUInt16LE(32, at + 6) // bits per pixel
    directory.writeUInt32LE(entry.png.length, at + 8)
    directory.writeUInt32LE(offset, at + 12)
    offset += entry.png.length
  })

  return Buffer.concat([header, directory, ...entries.map((entry) => entry.png)])
}

/** ICNS containing PNG payloads, which macOS has accepted since 10.7. */
function encodeIcns(entries) {
  const blocks = entries.map((entry) => {
    const head = Buffer.alloc(8)
    head.write(entry.type, 0, 4, 'ascii')
    head.writeUInt32BE(entry.png.length + 8, 4)
    return Buffer.concat([head, entry.png])
  })
  const body = Buffer.concat(blocks)
  const header = Buffer.alloc(8)
  header.write('icns', 0, 4, 'ascii')
  header.writeUInt32BE(body.length + 8, 4)
  return Buffer.concat([header, body])
}

// --- main -------------------------------------------------------------------

function main() {
  mkdirSync(ICONS_DIR, { recursive: true })

  const cache = new Map()
  const png = (size) => {
    if (!cache.has(size)) cache.set(size, renderIcon(size))
    return cache.get(size)
  }

  const files = {
    '32x32.png': png(32),
    '128x128.png': png(128),
    '128x128@2x.png': png(256),
    'icon.png': png(512),
    'Square30x30Logo.png': png(30),
    'Square44x44Logo.png': png(44),
    'Square71x71Logo.png': png(71),
    'Square89x89Logo.png': png(89),
    'Square107x107Logo.png': png(107),
    'Square142x142Logo.png': png(142),
    'Square150x150Logo.png': png(150),
    'Square284x284Logo.png': png(284),
    'Square310x310Logo.png': png(310),
    'StoreLogo.png': png(50),
    'icon.ico': encodeIco([16, 32, 48, 64, 256].map((size) => ({ size, png: png(size) }))),
    'icon.icns': encodeIcns([
      { type: 'ic07', png: png(128) },
      { type: 'ic08', png: png(256) },
      { type: 'ic09', png: png(512) },
      { type: 'ic11', png: png(32) },
      { type: 'ic12', png: png(64) },
    ]),
  }

  for (const [name, data] of Object.entries(files)) {
    writeFileSync(join(ICONS_DIR, name), data)
  }
  console.log(`Wrote ${Object.keys(files).length} icon files to src-tauri/icons/`)
}

main()
