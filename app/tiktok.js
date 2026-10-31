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
  // mês (às vezes lido "0ct") seguido de dígitos com espaço, ":" ou "." no meio, até AM/PM ou o fim da hora
  const m = line.replace(/\b0(ct)\b/i, 'O$1').match(/\b([A-Za-z]{3})[a-z]*\.?\s*((?:\d[\s:.]?){3,6})\s*([AP]\.?M)?/i)
  if (!m || !MONTHS[m[1].toLowerCase()]) return null
  const digits = m[2].replace(/\D/g, '')
  const rest = digits.slice(0, -2)   // os dois últimos são os minutos
  for (const cut of [rest.length - 1, rest.length - 2]) {
    if (cut < 1) continue
    const day = Number(rest.slice(0, cut)), hour = Number(rest.slice(cut))
    if (day >= 1 && day <= 31 && hour >= 1 && hour <= 12) return Object.assign([m[0], m[1], day, hour, m[3]], { index: m.index })
  }
  return null
}

// "Estimated rewards USD428.40" com caracteres trocados pela leitura ("USDA28.4O", "U5D 428,40"):
// tira o prefixo da moeda e troca as letras parecidas com números
const LOOKALIKE = { O: '0', o: '0', D: '0', Q: '0', A: '4', S: '5', s: '5', l: '1', I: '1', i: '1', '|': '1', B: '8', Z: '2', z: '2', G: '6', g: '9', T: '7' }
function rewardsValue(raw) {
  const cur = raw.match(/(?:[U5S]?\s?[S5]\s?[D0O]|US\$|\$)\s?(?=[\dOoAS])(.*)$/i)
  const v = (cur ? cur[1] : raw).trim().replace(/\s+/g, '')
  const fixed = [...v].map(c => LOOKALIKE[c] ?? c).join('').replace(/[^\d.,]/g, '')
  return /\d/.test(fixed) && /^\d[\d.,]*$/.test(fixed) ? fixed : null
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
    // Recompensa: lida à parte, com tolerância a caracteres trocados
    const rw = line.match(/(estimated\s*rewards?|recompensas?\s*estimadas?)\s*:?\s*(.*)$/i)
    if (rw && !inSummary) {
      const value = rewardsValue(rw[2] || '') ?? rewardsValue(lines[i + 1] ?? '')
      if (value) { set('rewards_usd', value, 3); return }
    }
    // Cabeçalho: "Oct 20 11:42 AM · 3 hours 12 min"
    const std = line.match(/\b([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})\b.*?\b(\d{1,2}):(\d{2})/)
    const head = (std && MONTHS[std[1].toLowerCase()] ? std : null) || joinedHead(line)
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
      if (title.length >= 3) out.title = title.toLocaleUpperCase('pt-BR')
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
    const fits = r => ratio(r) >= 0.15 && ratio(r) <= 0.45
    let ok = false
    for (const fix of [1, 100, 10]) {
      const r = Math.round(out.rewards_usd / fix * 100) / 100
      if (fits(r)) { out.rewards_usd = r; ok = true; break }
    }
    // Restos da moeda lidos como dígitos na frente ("USD428.71" → "550428.71"): tira dígitos do começo até bater
    if (!ok) {
      const txt = out.rewards_usd.toFixed(2)
      for (let k = 1; k < txt.indexOf('.'); k++) {
        const r = Number(txt.slice(k))
        if (fits(r)) { out.rewards_usd = r; ok = true; break }
      }
    }
    if (!ok) delete out.rewards_usd   // valor sem sentido: melhor calcular e avisar
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
  // o "$" do cartão às vezes é lido como "S", "§" ou some
  const card = text.match(/^\s*[$S§]?\s?(\d[\d.,]*\.\d{2})\D+?(\d+(?:[.,]\d+)?)\s?([KkMm])/m)
  if (card) {
    // o valor da linha "Available/Upcoming rewards" é mais confiável (o do cartão perde o ponto: "$2551")
    out.upcoming_usd ??= money(card[1])
    out.week_diamonds = Math.round(Number(card[2].replace(',', '.')) * (/k/i.test(card[3]) ? 1e3 : 1e6))
  }
  // diamantes e porcentagem do cartão ("356.9K · 11%"), lidos direto quando a linha do valor falha
  const kp = text.match(/(\d+(?:[.,]\d+)?)\s?([KkMm])\s*[·•.,\-–]?\s*(\d{1,2}(?:[.,]\d)?)\s?%/)
  if (kp) {
    out.week_diamonds ??= Math.round(Number(kp[1].replace(',', '.')) * (/k/i.test(kp[2]) ? 1e3 : 1e6))
    const p = Number(kp[3].replace(',', '.'))
    if (p >= 6 && p <= 13) out.read_pct = p
  }
  // A porcentagem sai embaralhada na leitura; ela é o valor dividido pelos diamantes
  // O semanal vai de 6% (1 dia válido) a 13%. Se a conta sair fora disso, a leitura errou a escala dos diamantes
  // ("231.9K" sem o K ou sem o ponto): ajusta a escala; se nada bater, descarta os dois
  if (out.upcoming_usd != null && out.week_diamonds) {
    const pctFor = g => Math.round((out.upcoming_usd / (g * 0.01)) * 200) / 2
    const scale = [1, 10, 100, 1000, 0.1, 0.01].find(k => { const p = pctFor(out.week_diamonds * k); return p >= 6 && p <= 13 })
    if (scale) { out.week_diamonds = Math.round(out.week_diamonds * scale); out.weekly_pct = pctFor(out.week_diamonds) }
    else delete out.week_diamonds
  }
  // sem os diamantes, mas com a porcentagem lida: os diamantes saem da conta
  if (out.weekly_pct == null && out.read_pct && out.upcoming_usd) {
    out.weekly_pct = out.read_pct
    out.week_diamonds = Math.round(out.upcoming_usd / (out.read_pct / 100) / 0.01 / 100) * 100
  }
  delete out.read_pct

  const league = text.match(/\b([A-D])\s?([1-5lIi|])\s*for\s*7\s*d/i) || text.match(/l[e3]ag[uv]e\s*([A-D])\s?([1-5lIi|])\s*for/i) || text.match(/maintain league\s+([A-D])\s?([1-5lIi|])/i)
  if (league) out.league = league[1].toUpperCase() + league[2].replace(/[lIi|]/, '1')
  const days = text.match(/league days kept:\s*(\d)/i)
  if (days && Number(days[1]) <= 7) out.league_days = Number(days[1])
  out.valid_days_done = /valid go live days[\s\S]{0,40}?completed/i.test(text) || null
  out.fans_done = /active fans[\s\S]{0,40}?completed/i.test(text) || null
  return out
}

// Resumo do mês: LIVE Analytics → Overview (período "Custom") → Key metrics e Viewer insights
const MON_RX = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})\b/gi

const KNOWN = ['United Kingdom', 'United States', 'Saudi Arabia', 'South Africa', 'Brazil', 'Philippines', 'Italy', 'Portugal', 'Spain', 'Mexico', 'Indonesia', 'Germany', 'France', 'Argentina', 'Japan', 'Colombia', 'Peru', 'Chile', 'Canada', 'Angola', 'Mozambique', 'Paraguay', 'Uruguay', 'Bolivia', 'Venezuela', 'Ecuador', 'Others']

export function isMonthPrint(text) {
  if (/live analysis/i.test(text)) return false
  if (/viewer insights|countries or regions/i.test(text)) return true
  // o gráfico do mês tem datas no eixo ("Aug 31 ... Sep 29"); o de uma live não
  // topo do Overview: "Custom · Sep 1 - Sep 30"
  if (/\bcustom\b/i.test(text) || /\b[a-z]{3}\s+1\s*[-–]\s*[a-z]{3}\s+\d{1,2}\b/i.test(text)) return true
  return /key metrics/i.test(text) && [...text.matchAll(MON_RX)].length >= 2
}

// Grade do topo do Overview: uma linha com os números e, embaixo, a linha com os nomes
const GRID = [['views', /^views/i], ['diamonds', /^diamonds/i], ['duration_min', /^live duration/i], ['gifters', /^gifters/i],
  ['new_followers', /^new followers/i], ['comments', /^comments/i], ['shares', /^shares/i], ['likes', /^likes/i]]
function grid(text, out) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  for (let i = 0; i < lines.length - 1; i++) {
    const vals = lines[i].match(/\d[\d.,]*\s?[KkMmBb]?h?\b/g)
    if (!vals || lines[i].replace(/\d[\d.,]*\s?[KkMmBb]?h?\b/g, '').trim()) continue
    let rest = lines[i + 1], keys = []
    while (rest) {
      const hit = GRID.find(([, rx]) => rx.test(rest))
      if (!hit) break
      keys.push(hit[0]); rest = rest.replace(hit[1], '').trim()
    }
    if (keys.length !== vals.length) continue
    keys.forEach((k, j) => {
      const v = vals[j].replace(/\s/g, '')
      if (k === 'duration_min') { const h = v.match(/^(\d+)h$/); if (h) out[k] ??= Number(h[1]) * 60 }
      else { const m = v.match(/^([\d.,]+)([KkMmBb])?$/); if (m) out[k] ??= kmb(m[1].replace(/,(?=\d{3}\b)/g, ''), m[2]) }
    })
  }
}

// "488.9K" → 488900; "2.6M" → 2600000; "304" → 304
// O TikTok mostra no máximo uma casa decimal com K/M ("46.4K"); casa a mais é sujeira da leitura ("46.49K")
const kmb = (n, u) => {
  let v = n.replace(',', '.')
  if (u) v = v.replace(/^(\d+\.\d)\d+$/, '$1')
  return Math.round(Number(v) * ({ k: 1e3, m: 1e6, b: 1e9 }[(u || '').toLowerCase()] || 1))
}

// Confere os diamantes do mês com as recompensas (US$ 0,01 por diamante × ~51%).
// Se não baterem (ex.: "2.6M" lido como "3"), calcula pelas recompensas, arredondado como o TikTok mostra.
export function fixMonth(out) {
  if (out.rewards_usd) {
    const ratio = out.diamonds ? out.rewards_usd / (out.diamonds * 0.01) : 0
    if (ratio < 0.35 || ratio > 0.7) {
      const g = out.rewards_usd / 0.0051
      const step = g >= 1e6 ? 1e5 : 1e2
      out.diamonds = Math.round(g / step) * step
    }
  }
  // "4.1K" lido como "41K": no número grande do TikTok o ponto some e o valor fica 10× maior.
  // Views e espectadores únicos vêm com o ponto; os outros são uma fração pequena deles: muito acima disso, era o ponto
  const base = { unique: out.unique_viewers || out.views * 0.9, views: out.views || out.unique_viewers }
  const cap = [['gifters', 'unique', 0.03], ['new_followers', 'unique', 0.02], ['active_viewers', 'unique', 0.08], ['comments', 'views', 0.4], ['shares', 'views', 0.06]]
  for (const [k, b, max] of cap) while (out[k] && base[b] && out[k] > base[b] * max) out[k] = Math.round(out[k] / 10)
  return out
}

export function parseMonth(text, now = new Date()) {
  // letras que a leitura troca por números ("S3h" = 53h, "O0m41s" = 0m41s) e o "I" de "Italy" lido como "["
  text = text.replace(/(?<![A-Za-z])S(?=\d)/g, '5').replace(/(?<![A-Za-z])[O](?=\d)/g, '0').replace(/[\[|](?=[a-z]{2})/g, 'I')
  const out = {}
  // período escolhido no topo ("Custom · Oct 1 - Oct 29"): é ele que diz o mês e até que dia vão os números
  const per = text.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})\s*[-–—]\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})\b/i)
  const dates = [...text.matchAll(MON_RX)]
  if (per) {
    const m1 = MONTHS[per[1].toLowerCase()], m2 = MONTHS[per[3].toLowerCase()]
    const year = now.getFullYear() - (m1 > now.getMonth() + 1 ? 1 : 0)
    const ymd = (m, d) => `${year + (m < m1 ? 1 : 0)}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    out.month = ymd(m1, 1).slice(0, 7)
    out.period = [ymd(m1, per[2]), ymd(m2, per[4])]
  } else if (dates.length) {
    // o eixo termina no último dia com live; o mês do resumo é o dessa data
    const m = MONTHS[dates.at(-1)[1].toLowerCase()]
    const year = now.getFullYear() - (m > now.getMonth() + 1 ? 1 : 0)
    out.month = `${year}-${String(m).padStart(2, '0')}`
  }
  const num = label => {
    const r = text.match(new RegExp(label + '[^\\d\\n]*?(\\d[\\d.,]*)\\s?([KkMmBb])?\\b', 'i'))
    return r ? kmb(r[1].replace(/,(?=\d{3}\b)/g, ''), r[2]) : null
  }
  const fields = {
    views: '\\bviews', unique_viewers: 'unique viewers', active_viewers: 'active viewers', peak_viewers: 'peak concurrent viewers',
    avg_viewers: 'average concurrent viewers', gifters: 'gifters', new_followers: 'new followers', comments: 'comments',
    shares: 'shares', likes: 'likes', diamonds: '\\bdiamonds',
  }
  grid(text, out)
  for (const [k, label] of Object.entries(fields)) { if (out[k] != null) continue; const v = num(label); if (v != null) out[k] = v }
  const rw = text.match(/estimated rewards\s*(?:US\$|USD)\s?([\d.,]+)\s?([KkMm])?/i)
  if (rw) out.rewards_usd = kmb(rw[1], rw[2])
  const w = text.match(/average watch duration\s*(?:(\d+)\s?m)?\s*(\d+)\s?s/i)
  if (w) out.avg_watch_sec = (Number(w[1]) || 0) * 60 + Number(w[2])
  const h = text.match(/(\d+)\s?h\b[^\n]*\n?[^\n]*live duration/i)
  if (h) out.duration_min = Number(h[1]) * 60

  // Público: gênero, idade e países (em %)
  const g = text.match(/(\d{1,3})\s?%\s+(\d{1,3})\s?%\s*\n?\s*female\s+male/i)
  if (g) { out.female_pct = Number(g[1]); out.male_pct = Number(g[2]) }
  const ages = {}
  // a leitura às vezes troca o hífen ("45—54", "4554") ou some com o "+" do 55+
  // porcentagem com dígito sobrando ("239%" no lugar de "23%"): corta até caber em 100
  const pctOk = v => { let n = Number(v); while (n > 100) n = Math.floor(n / 10); return n }
  for (const r of text.matchAll(/^\W*(13|18|25|35|45)\s*\D{0,2}\s*(17|24|34|44|54)\s+(\d{1,4})\s?%/gm)) ages[`${r[1]}-${r[2]}`] = pctOk(r[3])
  for (const r of text.matchAll(/^\W*55\s*\+?\s+(\d{1,4})\s?%/gm)) ages['55+'] = pctOk(r[1])
  if (Object.keys(ages).length) out.ages = ages
  const cs = text.split(/countries or regions/i)[1]
  if (cs) {
    const countries = []
    // a bandeira vira letras soltas na leitura ("ER United Kingdom", "A Philippines"): procura o nome do país dentro da linha
    for (const line of cs.split('\n')) {
      const r = line.match(/([A-Z][a-z]+(?: [A-Z][a-z]+)*)\s+(\d{1,3})\s?%\s*$/)
      if (!r) continue
      const name = KNOWN.find(k => r[1].endsWith(k)) || r[1].replace(/^(?:[A-Z][A-Za-z]{0,2}\s)+/, '')
      countries.push([name, Number(r[2])])
    }
    if (countries.length) out.countries = countries
  }
  return out
}
