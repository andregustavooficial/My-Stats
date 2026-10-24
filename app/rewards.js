// Regras de recompensas do TikTok LIVE e contas do saldo (sem tela: só cálculo).

export const WITHDRAW_FEE_USD = 3
// Sem saque registrado, a cotação estimada é o dólar comercial menos R$ 0,18 (diferença vista no Pix)
export const FALLBACK_RATE_DIFF = 0.18

// Ganho no mês → limite de saque por dia no mês seguinte
export const LIMIT_TIERS = [[0, 100], [50, 150], [100, 200], [200, 250], [400, 300], [600, 400], [1000, 600], [2000, 1000], [3000, 1500], [5000, 2500], [8000, 4000], [10000, 5000], [20000, 10000], [30000, 15000], [40000, 20000], [60000, 30000], [100000, 50000]]

export const livePct = (min, followers) =>
  ((min ?? 0) >= 25 ? 38 : min >= 10 ? 35 : min >= 5 ? 30 : 20) + ((followers ?? 0) >= 5 ? 2 : 0)
export const daysPct = n => (n >= 2 ? 8 : n === 1 ? 6 : 0)

const ymd = d => d.toLocaleDateString('sv-SE')

// A semana do TikTok vai de segunda a domingo e vira na segunda à 1h da manhã
export function weekStartOf(now = new Date()) {
  const d = new Date(now.getTime() - 3600e3)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return ymd(d)
}

export function weekEndOf(start) {
  const d = new Date(`${start}T01:00`)
  d.setDate(d.getDate() + 7)
  return d
}

export function weekDays(start) {
  const d = new Date(`${start}T12:00`)
  return Array.from({ length: 7 }, (_, i) => { const x = new Date(d); x.setDate(d.getDate() + i); return ymd(x) })
}

// Cotação para estimar reais: a do último saque registrado; sem saque, comercial − R$ 0,18
export function payoutRate(withdrawals, commercial) {
  const last = withdrawals?.[0]
  if (last) return { rate: Number(last.rate_brl), source: 'saque' }
  if (commercial) return { rate: commercial - FALLBACK_RATE_DIFF, source: 'comercial' }
  return null
}

const sum = (rows, key) => rows.reduce((s, r) => s + (Number(r[key]) || 0), 0)

// Saldo disponível = último print + lives registradas depois dele + semanal que já virou − saques depois dele
export function ledger({ snapshots = [], lives = [], withdrawals = [] }, now = new Date()) {
  const current = weekStartOf(now)
  const weekLives = lives.filter(l => l.date >= current)
  const snap = snapshots[0]
  if (!snap) return { snap: null, current, weekLives }

  const taken = new Date(snap.taken_at)
  const snapWeek = snap.week_start || weekStartOf(taken)
  const after = r => new Date(r.created_at) > taken
  // o print já traz as lives feitas até ele (inclusive a do mesmo dia, mesmo registrada depois):
  // só somam as lives de dias depois do print. Uma live no mesmo dia, depois do print, entra no próximo print.
  const newLive = l => after(l) && l.date > ymd(taken)
  const credited = now >= weekEndOf(snapWeek) && taken < weekEndOf(snapWeek)

  // o print vale até a hora em que foi tirado; lives da mesma semana registradas depois somam pela mesma porcentagem
  const pct = Number(snap.weekly_pct) || 0
  const extraGems = sum(lives.filter(l => newLive(l) && l.date >= snapWeek && l.date < ymd(weekEndOf(snapWeek))), 'diamonds')
  const snapWeekUsd = (Number(snap.upcoming_usd) || 0) + extraGems * 0.01 * pct / 100

  let available = Number(snap.available_usd) || 0
  if (credited) available += snapWeekUsd
  available += sum(lives.filter(newLive), 'rewards_usd')
  // saque conta só se foi feito depois do print (pela data do saque, não pela hora em que foi registrado):
  // saques antigos registrados agora entram no relatório, mas não mexem no saldo
  available -= sum(withdrawals.filter(w => after(w) && w.date >= ymd(taken)), 'amount_usd')

  let upcoming
  if (snapWeek === current) {
    upcoming = { usd: snapWeekUsd, gems: (snap.week_diamonds || 0) + extraGems, pct, fromPrint: true }
  } else {
    const gems = sum(weekLives, 'diamonds')
    upcoming = { usd: gems * 0.01 * pct / 100, gems, pct, fromPrint: false }
  }

  return {
    snap, current, weekLives, available: Math.max(available, 0), upcoming,
    credit: credited ? { usd: snapWeekUsd, week: snapWeek, at: weekEndOf(snapWeek) } : null,
  }
}

// Ganho no mês (o que conta para o limite): recompensas das lives + semanais que viraram no mês
export function monthEarned({ snapshots = [], lives = [] }, month, now = new Date()) {
  const perLive = sum(lives.filter(l => l.date?.startsWith(month)), 'rewards_usd')
  const latestByWeek = new Map()
  for (const s of snapshots) if (s.week_start && !latestByWeek.has(s.week_start)) latestByWeek.set(s.week_start, s)
  let weekly = 0
  for (const [start, s] of latestByWeek) {
    const end = weekEndOf(start)
    if (end <= now && ymd(end).startsWith(month)) weekly += Number(s.upcoming_usd) || 0
  }
  return perLive + weekly
}

export function limitFor(earned) {
  const tier = [...LIMIT_TIERS].reverse().find(([min]) => earned >= min)
  const next = LIMIT_TIERS.find(([min]) => min > earned)
  return { tier, next }
}

// Acumulado desde o começo da conta (nov/2023) até 27/09/2026, montado com o "In" de cada mês
// (programa antigo, 50%: US$ × 200) e os extratos semanais desde 04/08/2025 (51%).
// A partir de 28/09/2026 o acumulado soma as lives registradas no app. Ainda faltam os dias 1 a 3 de agosto de 2025.
export const LIFETIME = { until: '2026-09-27', diamonds: 82110873, usd: 414309.89 }

export function lifetime(lives) {
  const recent = lives.filter(l => l.date > LIFETIME.until)
  const gems = sum(recent, 'diamonds')
  return { diamonds: LIFETIME.diamonds + gems, usd: LIFETIME.usd + gems * 0.01 * 0.51, recentGems: gems }
}
