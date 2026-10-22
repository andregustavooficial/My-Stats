// Lê o texto copiado (Texto ao Vivo do iPhone) dos prints "LIVE analysis" / "Key metrics" do TikTok.
// Funciona com o nome e o valor na mesma linha, em linhas seguidas ou em blocos separados
// (todos os nomes e depois todos os valores).

const LABELS = [
  ['views', /^(views|visualiza[cç](ões|oes))$/],
  ['unique_viewers', /^(unique viewers|espectadores [uú]nicos)$/],
  ['active_viewers', /^(active viewers|espectadores ativos)$/],
  ['avg_watch_sec', /^(average watch duration|(tempo|dura[cç][aã]o) m[eé]di[ao] (de visualiza[cç][aã]o|assistid[ao]))$/],
  ['peak_viewers', /^(peak concurrent viewers|pico de espectadores( simult[aâ]neos)?)$/],
  ['avg_viewers', /^(average concurrent viewers|m[eé]dia de espectadores( simult[aâ]neos)?)$/],
  ['gifters', /^(gifters|presenteadores|doadores)$/],
  ['new_followers', /^(new followers|novos seguidores)$/],
  ['comments', /^(comments|coment[aá]rios)$/],
  ['shares', /^(shares|compartilhamentos)$/],
  ['likes', /^(likes|curtidas)$/],
  ['rewards_usd', /^(estimated rewards|recompensas estimadas)$/],
  ['diamonds', /^(diamonds|diamantes)$/],
]

const MONTHS = { jan: 1, feb: 2, fev: 2, mar: 3, apr: 4, abr: 4, may: 5, mai: 5, jun: 6, jul: 7, aug: 8, ago: 8, sep: 9, set: 9, oct: 10, out: 10, nov: 11, dec: 12, dez: 12 }

const VALUE = /^(US\$|USD)?\s?\d[\d.,]*\s?[KkMm]?$|^\d+\s?m\s?\d+\s?s$/

const clean = s => s.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim()
const labelOf = s => LABELS.find(([, re]) => re.test(clean(s)))?.[0]

function number(raw) {
  let s = raw.replace(/US\$|USD|\s/gi, '')
  const mult = /k$/i.test(s) ? 1e3 : /m$/i.test(s) ? 1e6 : 1
  s = s.replace(/[kKmM]$/, '')
  // "1,234.5" (inglês) ou "1.234,5" (português)
  if (/,\d{1,2}$/.test(s) && !/\.\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.')
  else s = s.replace(/,/g, '')
  const n = Number(s) * mult
  return Number.isFinite(n) ? n : null
}

function convert(key, raw) {
  if (key === 'avg_watch_sec') {
    const m = raw.match(/(\d+)\s?m\s?(\d+)\s?s/)
    return m ? +m[1] * 60 + +m[2] : null
  }
  const n = number(raw)
  if (n == null) return null
  return key === 'rewards_usd' ? Math.round(n * 100) / 100 : Math.round(n)
}

export function parseTikTok(text, year = new Date().getFullYear()) {
  const out = {}
  const strength = {}
  const set = (key, raw, s) => {
    if ((strength[key] ?? -1) > s) return
    const v = convert(key, raw)
    if (v == null) return
    out[key] = v
    strength[key] = s
  }

  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  let pending = []
  let prevWasLabel = false
  let inSummary = false

  lines.forEach((line, i) => {
    // Cabeçalho: "Oct 20 11:42 AM · 3 hours 12 min"
    const head = line.match(/\b([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})\b.*?\b(\d{1,2}):(\d{2})/)
    if (head && MONTHS[head[1].toLowerCase()]) {
      const mm = String(MONTHS[head[1].toLowerCase()]).padStart(2, '0')
      out.date = `${year}-${mm}-${head[2].padStart(2, '0')}`
      const h = line.match(/(\d+)\s*(hours?|horas?|h)\b/i)
      const m = line.match(/(\d+)\s*(min|minutes?|minutos?)\b/i)
      if (h || m) out.duration_min = (h ? +h[1] * 60 : 0) + (m ? +m[1] : 0)
      const prev = lines[i - 1]
      if (prev && !labelOf(prev) && !VALUE.test(prev) && !/live analysis|an[aá]lise/i.test(prev)) out.title = prev.replace(/[^\p{L}\p{N}\p{P} ]/gu, '').trim()
      // O resumo logo abaixo do cabeçalho começa com um número e mistura números e nomes;
      // os mesmos dados vêm de novo em "Key metrics", então ele é ignorado
      inSummary = VALUE.test(lines[i + 1] ?? '')
      pending = []
      return
    }
    if (inSummary) {
      if (/^(view all|ver tudo|ver todos|performance|desempenho|key metrics|m[eé]tricas)/i.test(clean(line))) inSummary = false
      return
    }

    const label = labelOf(line)
    if (label) { pending.push(label); prevWasLabel = pending.length === 1; return }

    const inline = line.match(/^(.+?)[\s:]+((?:US\$|USD)?\s?\d[\d.,]*\s?[KkMm]?|\d+\s?m\s?\d+\s?s)$/)
    if (inline && labelOf(inline[1])) { set(labelOf(inline[1]), inline[2], 2); prevWasLabel = false; return }

    if (VALUE.test(line) && pending.length) {
      const key = pending.shift()
      set(key, line, prevWasLabel && pending.length === 0 ? 1 : 0)
    }
    prevWasLabel = false
  })
  return out
}
