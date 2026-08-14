// ============================================================
// lib-export.mjs — 多格式导出（M5 扩展）
// 能力:
//   exportMermaid(req)  -> req.json → Mermaid 源码（.mmd）
//   exportPdf(svgText)  -> SVG → PNG(resvg) → RGB → PDF（零外部依赖）
//   pngToRgb(pngBuf)    -> PNG buffer → RGB 像素数组（PNG filter 解码）
// ============================================================
import fs from 'node:fs'
import zlib from 'node:zlib'
import path from 'node:path'
import { createRequire } from 'node:module'
import { reqToMermaid } from './req-util.mjs'
const require = createRequire(import.meta.url)

// ---------- Mermaid 源码 ----------
export function exportMermaid(req) {
  return '%% 由 flowchart-agent 生成（req.json → Mermaid）\n' + reqToMermaid(req)
}

// ---------- PNG 解码（IDAT 解压 + filter 还原 → RGB） ----------
export function pngToRgb(buf) {
  // 校验 PNG 签名
  const sig = [137, 80, 78, 71, 13, 10, 26, 10]
  for (let i = 0; i < 8; i++) if (buf[i] !== sig[i]) throw new Error('非 PNG 文件')
  let off = 8, w = 0, h = 0, bitDepth = 0, colorType = 0, idat = []
  while (off < buf.length) {
    const len = buf.readUInt32BE(off); const type = buf.toString('ascii', off + 4, off + 8)
    const data = buf.slice(off + 8, off + 8 + len)
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]
      if (bitDepth !== 8) throw new Error('仅支持 8bit PNG（bitDepth=' + bitDepth + '）')
      if (colorType !== 2 && colorType !== 6) throw new Error('仅支持 RGB/RGBA PNG（colorType=' + colorType + '）')
    } else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    off += 8 + len + 4
  }
  if (!w || !h) throw new Error('PNG 缺 IHDR')
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const bpp = colorType === 6 ? 4 : 3
  const stride = w * bpp
  const out = Buffer.alloc(w * h * 3)
  const prev = Buffer.alloc(stride)
  let p = 0
  const paeth = (a, b, c) => {
    const pv = a + b - c, pa = Math.abs(pv - a), pb = Math.abs(pv - b), pc = Math.abs(pv - c)
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
  }
  for (let y = 0; y < h; y++) {
    const f = raw[p++]
    const row = raw.slice(p, p + stride); p += stride
    const cur = Buffer.alloc(stride)
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0
      const b = prev[x]
      const c = x >= bpp ? prev[x - bpp] : 0
      let v = row[x]
      if (f === 1) v = (v + a) & 0xff
      else if (f === 2) v = (v + b) & 0xff
      else if (f === 3) v = (v + ((a + b) >> 1)) & 0xff
      else if (f === 4) v = (v + paeth(a, b, c)) & 0xff
      cur[x] = v
    }
    // 写 RGB（RGBA 丢 alpha；RGB 直拷）
    for (let x = 0; x < stride; x += bpp) {
      out[(y * w + x / bpp) * 3] = cur[x]
      out[(y * w + x / bpp) * 3 + 1] = cur[x + 1]
      out[(y * w + x / bpp) * 3 + 2] = cur[x + 2]
    }
    prev.set(cur)
  }
  return { width: w, height: h, rgb: out }
}

// ---------- SVG → PDF（零外部依赖，resvg 出 PNG 再嵌 PDF） ----------
export function svgToPdf(svgText) {
  let Resvg = null
  try {
    const resvgMod = require('C:/Users/1/.workbuddy/plugins/marketplaces/experts/plugins/mermaid-diagram-expert/skills/mermaid-render/scripts/node_modules/@resvg/resvg-js')
    Resvg = resvgMod.Resvg || resvgMod
  } catch { throw new Error('resvg 未加载，无法导出 PDF') }
  const clean = svgText.replace(/@import[^;]+;/g, '').replace(/font-family:[^;"]+/g, 'font-family: sans-serif')
  const png = new Resvg(clean, { fitTo: { mode: 'width', value: 1400 }, font: { loadSystemFonts: true } }).render().asPng()
  return pngToPdf(Buffer.from(png))
}

// PNG buffer → PDF（FlateDecode RGB 图像）
export function pngToPdf(pngBuf) {
  const { width, height, rgb } = pngToRgb(pngBuf)
  const compressed = zlib.deflateSync(rgb)
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`,
    `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${compressed.length} >>`,
    `<< /Length ${22 + String(width).length + String(height).length} >> stream\nq ${width} 0 0 ${height} 0 0 cm /Im0 Do Q\nendstream`,
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = []
  objects.forEach((obj, i) => {
    offsets.push(pdf.length)
    pdf += `${i + 1} 0 obj\n${obj}\n`
    if (i === 3) { pdf += 'stream\n'; pdf += compressed.toString('binary'); pdf += '\nendstream\n' }
    pdf += 'endobj\n'
  })
  const xref = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  offsets.forEach(o => { pdf += String(o).padStart(10, '0') + ' 00000 n \n' })
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(pdf, 'binary')
}

// ---------- 便捷：写文件 ----------
export function exportToFile(req, outBase, formats) {
  const written = []
  if (formats.includes('mmd')) {
    fs.writeFileSync(outBase + '.mmd', exportMermaid(req), 'utf-8')
    written.push(outBase + '.mmd')
  }
  return written
}

export { path }
