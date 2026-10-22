// Lê os prints do TikTok no próprio aparelho com o Tesseract (gratuito, sem enviar as imagens para fora).
// O Tesseract (~10 MB com o idioma) só é baixado na primeira vez que alguém escolhe um print.

const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js'
let workerPromise = null

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (window.Tesseract) return resolve()
    const s = document.createElement('script')
    s.src = src
    s.onload = resolve
    s.onerror = () => reject(new Error('Não foi possível baixar o leitor de prints. Verifique a internet.'))
    document.head.append(s)
  })
}

function getWorker() {
  workerPromise ??= loadScript(TESSERACT_URL)
    .then(() => window.Tesseract.createWorker('eng'))
    .catch(err => { workerPromise = null; throw err })
  return workerPromise
}

// Amplia, passa para tons de cinza e estica o contraste por faixas: o cabeçalho do print
// fica escurecido atrás da janela "Key metrics" e, sem isso, a leitura pula essa parte.
async function prepare(file) {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(2, 2400 / bitmap.width)
  const w = Math.round(bitmap.width * scale)
  const h = Math.round(bitmap.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(bitmap, 0, 0, w, h)
  const img = ctx.getImageData(0, 0, w, h)
  const px = img.data
  const gray = new Uint8ClampedArray(w * h)
  for (let i = 0; i < w * h; i++) gray[i] = px[i * 4] * 0.299 + px[i * 4 + 1] * 0.587 + px[i * 4 + 2] * 0.114

  // Faixas de linhas escuras ou claras, cada uma com o próprio contraste
  const rowDark = y => {
    let sum = 0
    for (let x = 0; x < w; x += 4) sum += gray[y * w + x]
    return sum / Math.ceil(w / 4) < 175
  }
  let start = 0
  let dark = rowDark(0)
  const stretch = (y0, y1) => {
    const hist = new Uint32Array(256)
    for (let i = y0 * w; i < y1 * w; i++) hist[gray[i]]++
    const total = (y1 - y0) * w
    let lo = 0, hi = 255, acc = 0
    while (lo < 255 && (acc += hist[lo]) < total * 0.01) lo++
    acc = 0
    while (hi > 0 && (acc += hist[hi]) < total * 0.01) hi--
    const range = Math.max(hi - lo, 1)
    for (let i = y0 * w; i < y1 * w; i++) gray[i] = ((gray[i] - lo) * 255) / range
  }
  for (let y = 1; y <= h; y++) {
    const d = y < h ? rowDark(y) : !dark
    if (d !== dark && (y - start > 20 || y === h)) { stretch(start, y); start = y; dark = d }
  }
  for (let i = 0; i < w * h; i++) { px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = gray[i] }
  ctx.putImageData(img, 0, 0)
  return canvas
}

// Remonta as linhas pela posição das palavras na imagem: o Tesseract às vezes separa a coluna
// dos nomes da coluna dos valores, e no print cada nome fica na mesma altura do seu valor.
function rows(words) {
  const sorted = words
    .map(w => ({ text: w.text, x: w.bbox.x0, y: (w.bbox.y0 + w.bbox.y1) / 2, h: w.bbox.y1 - w.bbox.y0 }))
    .sort((a, b) => a.y - b.y)
  const out = []
  for (const w of sorted) {
    const row = out.at(-1)
    if (row && Math.abs(w.y - row.y) < Math.max(w.h, row.h) * 0.6) row.words.push(w)
    else out.push({ y: w.y, h: w.h, words: [w] })
  }
  return out.map(r => r.words.sort((a, b) => a.x - b.x))
}

async function readImage(worker, file) {
  const canvas = await prepare(file)
  const { data } = await worker.recognize(canvas, {}, { text: true, blocks: true })
  const words = (data.blocks ?? []).flatMap(b => b.paragraphs.flatMap(p => p.lines.flatMap(l => l.words)))
  return rows(words).map(row => row.map(w => w.text).join(' ')).join('\n')
}

export async function readScreenshots(files, onStatus) {
  onStatus?.('Preparando o leitor de prints…')
  const worker = await getWorker()
  let text = ''
  for (let i = 0; i < files.length; i++) {
    onStatus?.(`Lendo print ${i + 1} de ${files.length}…`)
    text += '\n' + await readImage(worker, files[i])
  }
  return text
}
