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

// A leitura do iPhone às vezes troca o zero pela letra O ("Om34s")
const VALUE = /^(US\$|USD)?\s?\d[\d.,]*\s?[KkMm]?$|^[\dOo]+\s?m\s?[\dOo]+\s?s$/

const clean = s => s.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim()
// Emojis não são lidos e às vezes viram um símbolo solto ("LET'S SING &"): sai tudo que não for texto nas pontas
const cleanTitle = s => (s || '')
  .replace(/[^\p{L}\p{N}\p{P} ]/gu, '')
  .replace(/^[^\p{L}\p{N}]+/u, '')
  .replace(/(\s+[^\p{L}\p{N}\s]{1,2})+$/u, '')
  .replace(/[\s.…•·\-–—|&©®@#*~^]+$/u, '')
  .trim()
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
    const m = raw.replace(/[Oo]/g, '0').match(/(\d+)\s?m\s?(\d+)\s?s/)
    return m ? +m[1] * 60 + +m[2] : null
  }
  const n = number(raw)
  if (n == null) return null
  return key === 'rewards_usd' ? Math.round(n * 100) / 100 : Math.round(n)
}

// A leitura às vezes junta o dia com a hora: "Oct 17:03 PM" é Oct 1, 7:03 PM (não existe 17h com PM).
// Separa os dígitos de forma que a hora fique entre 1 e 12 e o dia entre 1 e 31.
function joinedHead(line) {
  const m = line.match(/\b([A-Za-z]{3})[a-z]*\.?\s+(\d{2,4}):(\d{2})\s*([AP]M)?/i)
  if (!m) return null
  const digits = m[2]
  for (const cut of [digits.length - 1, digits.length - 2]) {
    if (cut < 1) continue
    const day = Number(digits.slice(0, cut)), hour = Number(digits.slice(cut))
    if (day >= 1 && day <= 31 && hour >= 1 && hour <= 12) return Object.assign([m[0], m[1], day, hour, m[3]], { index: m.index })
  }
  return null
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
    const head = line.match(/\b([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})\b.*?\b(\d{1,2}):(\d{2})/) || joinedHead(line)
    if (head && MONTHS[head[1].toLowerCase()]) {
      const mm = String(MONTHS[head[1].toLowerCase()]).padStart(2, '0')
      out.date = `${year}-${mm}-${String(head[2]).padStart(2, '0')}`
      const h = line.match(/(\d+)\s*(hours?|horas?|h)\b/i)
      const m = line.match(/(\d+)\s*(min|minutes?|minutos?)\b/i)
      // "- 2 20" com "hours min" partido em outra linha: os dois últimos números depois do horário
      if (!h && !m) {
        const after = line.slice(line.search(/\d{1,2}:\d{2}/) + 4).match(/(\d+)\D+(\d+)\s*$/)
        if (after && /hours?\s+min/i.test(lines[i - 1] + ' ' + (lines[i + 1] ?? ''))) out.duration_min = +after[1] * 60 + +after[2]
      }
      if (h || m) out.duration_min = (h ? +h[1] * 60 : 0) + (m ? +m[1] : 0)
      // O título vem na linha anterior ou na mesma linha, antes da data
      // (a leitura de imagem pode trazer lixo do avatar antes do título ou da data, então fica o candidato mais longo)
      const isTitle = l => l && !labelOf(l) && !VALUE.test(l) && !/live analysis|an[aá]lise|^\W*hours?\s+min/i.test(l)
      const prev = [lines[i - 1], lines[i - 2]].find(isTitle)
      const title = [line.slice(0, head.index), prev || '']
        .map(cleanTitle).sort((a, b) => b.length - a.length)[0]
      if (title.length >= 3) out.title = title
      // O resumo logo abaixo do cabeçalho começa com um número e mistura números e nomes;
      // os mesmos dados vêm de novo em "Key metrics", então ele é ignorado
      inSummary = /^\S*\d/.test(lines[i + 1] ?? '')
      pending = []
      return
    }
    if (inSummary) {
      // "View all" pode aparecer no meio do resumo; ele só termina nas seções seguintes
      // (a leitura de imagem pode trazer o "X" de fechar junto: "Key metrics X")
      if (/^(performance|desempenho|viewers|espectadores|key metrics|m[eé]tricas|viewership|engagement|rewards|audi[eê]ncia|engajamento|recompensas)\b/i.test(clean(line))) inSummary = false
      return
    }

    const label = labelOf(line)
    if (label) { pending.push(label); prevWasLabel = pending.length === 1; return }

    const inline = line.match(/^(.+?)[\s:]+((?:US\$|USD)?\s?\d[\d.,]*\s?[KkMm]?|[\dOo]+\s?m\s?[\dOo]+\s?s)$/)
    if (inline && labelOf(inline[1])) { set(labelOf(inline[1]), inline[2], 2); prevWasLabel = false; return }

    if (VALUE.test(line) && pending.length) {
      const key = pending.shift()
      set(key, line, prevWasLabel && pending.length === 0 ? 1 : 0)
    }
    prevWasLabel = false
  })

  // A leitura de imagem às vezes perde o ponto decimal ("48.1K" vira "481K"). Visualizações
  // ficam perto dos espectadores únicos, então um valor 10 vezes maior denuncia o erro.
  if (out.views && out.unique_viewers && out.views >= out.unique_viewers * 5) out.views = Math.round(out.views / 10)
  // A recompensa é diamantes × US$ 0,01 × 20% a 40%. Se o ponto se perdeu ("USD20309"), volta duas casas.
  if (out.rewards_usd && out.diamonds) {
    const ratio = r => r / (out.diamonds * 0.01)
    for (const fix of [1, 100, 10]) {
      const r = Math.round(out.rewards_usd / fix * 100) / 100
      if (ratio(r) >= 0.15 && ratio(r) <= 0.45) { out.rewards_usd = r; break }
    }
  }
  return out
}

// Print de domingo: Content rewards → Upcoming rewards
const money = s => Number(s.replace(/,/g, '')) || null

export function isWeeklyPrint(text) {
  return /upcoming rewards/i.test(text) && !/key metrics/i.test(text)
}

export function parseWeekly(text, now = new Date()) {
  const out = {}
  const bal = text.match(/available rewards[^\n]*\n[^\n]*?(?:US\$|USD)\s?([\d.,]+)[^\n]*?(?:US\$|USD)\s?([\d.,]+)/i)
  if (bal) { out.available_usd = money(bal[1]); out.upcoming_usd = money(bal[2]) }

  // "Oct 19 - Oct 25" e, na linha seguinte, "$255.11 231.9K · 11%"
  const week = text.match(/\b([A-Za-z]{3})\s+(\d{1,2})\s*[-–]\s*[A-Za-z]{3}\s+\d{1,2}/)
  if (week && MONTHS[week[1].toLowerCase()]) {
    const month = MONTHS[week[1].toLowerCase()]
    const year = now.getFullYear() - (month > now.getMonth() + 2 ? 1 : 0)
    out.week_start = `${year}-${String(month).padStart(2, '0')}-${week[2].padStart(2, '0')}`
  }
  const card = text.match(/^\s*\$\s?([\d.,]+)\D+?(\d+(?:\.\d+)?)\s?([KkMm])/m)
  if (card) {
    out.upcoming_usd = money(card[1])
    out.week_diamonds = Math.round(Number(card[2]) * (/k/i.test(card[3]) ? 1e3 : 1e6))
  }
  // A porcentagem sai embaralhada na leitura; ela é o valor dividido pelos diamantes
  if (out.upcoming_usd != null && out.week_diamonds) {
    out.weekly_pct = Math.round((out.upcoming_usd / (out.week_diamonds * 0.01)) * 200) / 2
  }

  const league = text.match(/maintain league\s+([A-D])\s?([1-5lIi|])/i)
  if (league) out.league = league[1].toUpperCase() + league[2].replace(/[lIi|]/, '1')
  const days = text.match(/league days kept:\s*(\d)/i)
  if (days && league) out.league_days = Number(days[1])
  out.valid_days_done = /valid go live days[\s\S]{0,40}?completed/i.test(text) || null
  out.fans_done = /active fans[\s\S]{0,40}?completed/i.test(text) || null
  return out
}
