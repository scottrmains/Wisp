// Rebuild deterministic app assets from the approved Wispa vector master.
// Run `npm run build:branding` at the repository root after editing the SVG.
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { Resvg } from '@resvg/resvg-js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const brandDir = path.join(root, 'src/Wisp.Client/public/branding')
const svg = await readFile(path.join(brandDir, 'wispa.svg'), 'utf8')
const sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256]
const frames = sizes.map(size => new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng())
const header = Buffer.alloc(6 + sizes.length * 16)
header.writeUInt16LE(1, 2) // Windows icon, not cursor
header.writeUInt16LE(sizes.length, 4)
let offset = header.length
for (let i = 0; i < sizes.length; i++) {
  const entry = 6 + i * 16
  header[entry] = header[entry + 1] = sizes[i] === 256 ? 0 : sizes[i]
  header.writeUInt16LE(1, entry + 4)
  header.writeUInt16LE(32, entry + 6)
  header.writeUInt32LE(frames[i].length, entry + 8)
  header.writeUInt32LE(offset, entry + 12)
  offset += frames[i].length
}
await writeFile(path.join(brandDir, 'wisp.ico'), Buffer.concat([header, ...frames]))
await writeFile(path.join(brandDir, 'wispa-256.png'), frames.at(-1))
await writeFile(path.join(brandDir, 'apple-touch-icon.png'), new Resvg(svg, { fitTo: { mode: 'width', value: 180 } }).render().asPng())

// A review sheet at actual UI sizes on both light and dark backgrounds.
const previewDir = path.join(root, 'artifacts/branding')
await mkdir(previewDir, { recursive: true })
const symbol = svg.replace(/<\?xml[^>]*>/, '')
const rows = ['#14141c', '#f5f3f8'].map((background, row) => {
  let x = 32
  return `<g transform="translate(0 ${row * 320})"><rect width="800" height="320" fill="${background}"/>` +
    [16, 24, 32, 48, 64, 128, 256].map(size => {
      const item = `<svg x="${x}" y="${(320 - size) / 2}" width="${size}" height="${size}" viewBox="0 0 1280 1280">${symbol}</svg>`
      x += size + 24
      return item
    }).join('') + '</g>'
})
await writeFile(path.join(previewDir, 'icon-sizes.png'), new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="640">${rows.join('')}</svg>`).render().asPng())
console.log(`Generated ${sizes.length} ICO frames, PNG assets and artifacts/branding/icon-sizes.png`)
