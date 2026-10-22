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
  const color = new Uint8ClampedArray(px)
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
  return { canvas, color, w }
}

// Na tela "Upcoming rewards", os dias em que a liga foi mantida são bolinhas laranjas entre
// "Maintain League A1 for 7 days" e "Day 1 … Day 7". Contamos as manchas laranjas nessa faixa.
function countOrangeDots(color, w, y0, y1) {
  const h = y1 - y0
  if (h <= 0) return 0
  const on = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = ((y0 + y) * w + x) * 4
      const r = color[i], g = color[i + 1], b = color[i + 2]
      on[y * w + x] = r > 200 && g > 100 && g < 200 && b < 110 && r - b > 120 ? 1 : 0
    }
  }
  const seen = new Uint8Array(w * h)
  let dots = 0
  for (let start = 0; start < w * h; start++) {
    if (!on[start] || seen[start]) continue
    let size = 0, minX = w, maxX = 0
    const stack = [start]
    seen[start] = 1
    while (stack.length) {
      const i = stack.pop()
      const x = i % w
      size++
      if (x < minX) minX = x; if (x > maxX) maxX = x
      for (const j of [i - 1, i + 1, i - w, i + w]) {
        if (j < 0 || j >= w * h || seen[j] || !on[j]) continue
        if ((j === i - 1 && x === 0) || (j === i + 1 && x === w - 1)) continue
        seen[j] = 1
        stack.push(j)
      }
    }
    // a bolinha tem uns 4% da largura do print; o ícone de diamante à esquerda fica de fora pela posição
    const width = maxX - minX + 1
    if (width > w * 0.025 && width < w * 0.06 && size > width * width * 0.4 && minX > w * 0.15) dots++
  }
  return dots
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

// O Tesseract engole o ponto em números como "2.1K" (sai "21K"). O ponto é uma mancha pequena,
// isolada e rente à base do número: procuramos essa mancha na imagem e devolvemos o ponto
// depois de quantos dígitos houver à esquerda dela.
const NO_POINT = /^(\d{2,})([KkMm])$/

function decimalIndex(ctx, { x0, y0, x1, y1 }) {
  const w = x1 - x0
  const h = y1 - y0
  if (w < 4 || h < 4) return -1
  const px = ctx.getImageData(x0, y0, w, h).data
  const dark = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) dark[i] = px[i * 4] < 128 ? 1 : 0
  const seen = new Uint8Array(w * h)
  const parts = []
  for (let start = 0; start < w * h; start++) {
    if (!dark[start] || seen[start]) continue
    let minX = w, maxX = 0, minY = h, maxY = 0
    const stack = [start]
    seen[start] = 1
    while (stack.length) {
      const i = stack.pop()
      const x = i % w, y = (i / w) | 0
      if (x < minX) minX = x; if (x > maxX) maxX = x
      if (y < minY) minY = y; if (y > maxY) maxY = y
      for (const j of [i - 1, i + 1, i - w, i + w]) {
        if (j < 0 || j >= w * h || seen[j] || !dark[j]) continue
        if ((j === i - 1 && x === 0) || (j === i + 1 && x === w - 1)) continue
        seen[j] = 1
        stack.push(j)
      }
    }
    parts.push({ cx: (minX + maxX) / 2, pw: maxX - minX + 1, ph: maxY - minY + 1, bottom: maxY })
  }
  const tallest = Math.max(...parts.map(p => p.ph))
  const dot = parts.find(p => p.ph < tallest * 0.3 && p.pw < tallest * 0.35 && p.bottom > h - tallest * 0.35 && p.ph > 1)
  if (!dot) return -1
  return parts.filter(p => p.ph > tallest * 0.6 && p.cx < dot.cx).length
}

async function readImage(worker, file) {
  const { canvas, color, w } = await prepare(file)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  const { data } = await worker.recognize(canvas, {}, { text: true, blocks: true })
  const words = (data.blocks ?? []).flatMap(b => b.paragraphs.flatMap(p => p.lines.flatMap(l => l.words)))
  for (const word of words) {
    const m = word.text.match(NO_POINT)
    if (!m) continue
    const i = decimalIndex(ctx, word.bbox)
    if (i > 0 && i < m[1].length) word.text = `${m[1].slice(0, i)}.${m[1].slice(i)}${m[2]}`
  }
  const lines = rows(words)
  const text = lines.map(row => row.map(w => w.text).join(' ')).join('\n')
  const league = lines.findIndex(row => /maintain league/i.test(row.map(w => w.text).join(' ')))
  const dayRow = lines.findIndex((row, i) => i > league && /day\s*1/i.test(row.map(w => w.text).join(' ')))
  if (league < 0 || dayRow < 0) return text
  // só as palavras de verdade: o ícone de diamante à esquerda vira um "O" alto e alargaria a faixa
  const only = (row, re) => row.filter(w => re.test(w.text))
  const top = Math.max(...only(lines[league], /^(maintain|league|for|days|\d|[a-d]\w?)$/i).map(w => w.y + w.h / 2))
  const bottom = Math.min(...only(lines[dayRow], /^(day|\d)$/i).map(w => w.y - w.h / 2))
  return `${text}\nLeague days kept: ${countOrangeDots(color, w, Math.round(top), Math.round(bottom))}`
}

// Devolve o texto de cada print separado, para reconhecer o tipo de cada um
export async function readEach(files, onStatus) {
  onStatus?.('Preparando o leitor de prints…')
  const worker = await getWorker()
  const texts = []
  for (let i = 0; i < files.length; i++) {
    onStatus?.(`Lendo print ${i + 1} de ${files.length}…`)
    texts.push(await readImage(worker, files[i]))
  }
  return texts
}

export async function readScreenshots(files, onStatus) {
  return (await readEach(files, onStatus)).join('\n')
}
