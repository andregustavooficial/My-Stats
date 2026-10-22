import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm'
import { parseTikTok, parseWeekly, isWeeklyPrint } from './tiktok.js?v=__V__'
import { readEach } from './ocr.js?v=__V__'
import { WITHDRAW_FEE_USD, livePct, daysPct, weekStartOf, weekEndOf, weekDays, payoutRate, ledger, monthEarned, limitFor, LIMIT_TIERS, lifetime } from './rewards.js?v=__V__'

// A chave anon é pública por design; os dados são protegidos pelo RLS (supabase/schema.sql).
const SUPABASE_URL = 'https://tolmprwwnishdohhhuad.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRvbG1wcnd3bmlzaGRvaGhodWFkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI2MzA4NjEsImV4cCI6MjEwODIwNjg2MX0.iOfEVjMH8bIQNr9V6Y8CGJA4xsUWpJ0oomNnzAXtfdA'

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

const app = document.getElementById('app')
const sheet = document.getElementById('sheet')
const toastEl = document.getElementById('toast')

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const brl = v => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v) || 0)
const usd = v => 'US$ ' + new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v) || 0)
const int = v => new Intl.NumberFormat('pt-BR').format(Number(v) || 0)
const today = () => new Date().toLocaleDateString('sv-SE')
const fmtDate = d => d ? new Date(d + 'T12:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }) : ''
const fmtDateTime = d => d ? new Date(d).toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''
const toLocalInput = iso => { const d = new Date(iso); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16) }
const hours = min => { const m = Number(min) || 0; return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}` }

const LIVE_STATUS = { planejada: 'Planejada', feita: 'Feita', cancelada: 'Cancelada' }
const VIDEO_STATUS = { ideia: 'Ideia', roteiro: 'Roteiro', gravado: 'Gravado', postado: 'Postado' }
const PAY_STATUS = { pendente: 'Pendente', pago: 'Pago' }
const PAY_KIND = { entrada: 'Entrada (R$)', saida: 'Saída (R$)', saque: 'Saque TikTok (US$)' }


const ENTITIES = {
  lives: {
    table: 'lives', title: 'Lives', single: 'live', order: ['date', false], importer: true,
    fields: [
      { key: 'title', label: 'Título da live', type: 'text', upper: true },
      { key: 'date', label: 'Data', type: 'date', required: true, half: true },
      { key: 'duration_min', label: 'Duração (min)', type: 'int', half: true },
      { key: 'rewards_usd', label: 'Recompensas (US$)', type: 'money', half: true },
      { key: 'diamonds', label: 'Diamantes', type: 'int', half: true },
      { key: 'views', label: 'Visualizações', type: 'int', half: true },
      { key: 'unique_viewers', label: 'Espectadores únicos', type: 'int', half: true },
      { key: 'active_viewers', label: 'Espectadores ativos', type: 'int', half: true },
      { key: 'avg_watch_sec', label: 'Tempo médio assistido (s)', type: 'int', half: true },
      { key: 'peak_viewers', label: 'Pico simultâneo', type: 'int', half: true },
      { key: 'avg_viewers', label: 'Média simultânea', type: 'int', half: true },
      { key: 'new_followers', label: 'Novos seguidores', type: 'int', half: true },
      { key: 'gifters', label: 'Presenteadores', type: 'int', half: true },
      { key: 'comments', label: 'Comentários', type: 'int', half: true },
      { key: 'shares', label: 'Compartilhamentos', type: 'int', half: true },
      { key: 'likes', label: 'Curtidas', type: 'int' },
      { key: 'notes', label: 'Observações', type: 'textarea' },
    ],
    item: r => ({
      title: r.title || fmtDate(r.date),
      meta: [r.title && fmtDate(r.date), r.duration_min && hours(r.duration_min), r.new_followers != null && `+${int(r.new_followers)} seg.`].filter(Boolean).join(' · '),
      value: r.rewards_usd != null ? usd(r.rewards_usd) : '',
    }),
  },
  payments: {
    table: 'payments', title: 'Pagamentos', single: 'pagamento', order: ['date', false],
    fields: [
      { key: 'description', label: 'Descrição', type: 'text', required: true },
      { key: 'amount', label: 'Valor', type: 'money', required: true, half: true },
      { key: 'date', label: 'Data', type: 'date', required: true, default: today, half: true },
      { key: 'kind', label: 'Tipo', type: 'select', options: PAY_KIND, default: () => 'entrada', half: true },
      { key: 'status', label: 'Status', type: 'select', options: PAY_STATUS, default: () => 'pendente', half: true },
      { key: 'notes', label: 'Observações', type: 'textarea' },
    ],
    item: r => ({
      title: r.description,
      meta: `${fmtDate(r.date)} · ${r.kind === 'saque' ? 'Saque TikTok · ' : ''}${PAY_STATUS[r.status]}`,
      value: r.kind === 'saque' ? usd(r.amount) : `${r.kind === 'saida' ? '−' : '+'}${brl(r.amount)}`,
      tone: r.status === 'pendente' ? 'warn' : r.kind === 'saida' ? 'neg' : 'pos',
    }),
  },
  videos: {
    table: 'video_plans', title: 'Vídeos', single: 'plano de vídeo', order: ['created_at', false],
    fields: [
      { key: 'title', label: 'Título', type: 'text', required: true },
      { key: 'status', label: 'Status', type: 'select', options: VIDEO_STATUS, default: () => 'ideia', half: true },
      { key: 'due_date', label: 'Prazo', type: 'date', half: true },
      { key: 'idea', label: 'Ideia / gancho', type: 'textarea' },
      { key: 'plan', label: 'Plano de ação', type: 'textarea', rows: 6 },
    ],
    item: r => ({
      title: r.title,
      meta: [VIDEO_STATUS[r.status], r.due_date && `prazo ${fmtDate(r.due_date)}`].filter(Boolean).join(' · '),
      tag: r.status,
    }),
  },
  agenda: {
    table: 'live_plans', title: 'Agenda', single: 'live planejada', order: ['scheduled_at', true],
    fields: [
      { key: 'theme', label: 'Tema', type: 'text', required: true },
      { key: 'scheduled_at', label: 'Quando', type: 'datetime', required: true },
      { key: 'status', label: 'Status', type: 'select', options: LIVE_STATUS, default: () => 'planejada', half: true },
      { key: 'goal', label: 'Meta', type: 'text', half: true },
      { key: 'checklist', label: 'Checklist / roteiro', type: 'textarea', rows: 6 },
      { key: 'notes', label: 'Observações', type: 'textarea' },
    ],
    item: r => ({
      title: r.theme,
      meta: [fmtDateTime(r.scheduled_at), r.goal && `meta: ${r.goal}`].filter(Boolean).join(' · '),
      tag: r.status,
    }),
  },
}

// Tabelas usadas só pela aba Recompensas (sem formulário genérico)
ENTITIES.withdrawals = { table: 'withdrawals', order: ['created_at', false] }
ENTITIES.snapshots = { table: 'reward_snapshots', order: ['taken_at', false] }

const TABS = [
  { id: 'home', label: 'Início', icon: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>' },
  { id: 'lives', label: 'Lives', icon: '<circle cx="12" cy="12" r="3"/><path d="M6.3 6.3a8 8 0 0 0 0 11.4M17.7 6.3a8 8 0 0 1 0 11.4"/>' },
  { id: 'stats', label: 'Estatísticas', icon: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>' },
  { id: 'rewards', label: 'Recompensas', icon: '<path d="M6 3h12l4 6-10 12L2 9z"/><path d="M2 9h20"/>' },
]

const state = { tab: 'home', rtab: 'saldo', lmonth: null, lsort: 'data', wmonth: null, smonth: null, data: {}, rate: readCachedRate() }

function readCachedRate() {
  try { return JSON.parse(localStorage.getItem('usd-brl')) } catch { return null }
}

// Dólar comercial do dia: AwesomeAPI (gratuita, sem chave, atualiza o dia todo).
// Se ela falhar, a reserva é a PTAX do Banco Central, a cotação oficial (só em dias úteis).
const RATE_SOURCES = [
  async () => {
    const res = await fetch('https://economia.awesomeapi.com.br/json/last/USD-BRL')
    const q = (await res.json()).USDBRL
    return { commercial: Number(q.bid), at: q.create_date, source: 'AwesomeAPI' }
  },
  async () => {
    const day = d => `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}-${d.getFullYear()}`
    const end = new Date()
    const start = new Date(end.getTime() - 7 * 864e5)   // fins de semana e feriados não têm PTAX
    const url = 'https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoDolarPeriodo(dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)'
      + `?@dataInicial='${day(start)}'&@dataFinalCotacao='${day(end)}'&$format=json&$orderby=dataHoraCotacao%20desc&$top=1`
    const q = (await (await fetch(url)).json()).value[0]
    return { commercial: Number(q.cotacaoVenda), at: q.dataHoraCotacao, source: 'Banco Central' }
  },
]

async function loadRate() {
  for (const source of RATE_SOURCES) {
    try {
      const rate = await source()
      if (!(rate.commercial > 0)) continue
      state.rate = rate
      try { localStorage.setItem('usd-brl', JSON.stringify(rate)) } catch {}
      return rate
    } catch {
      // tenta a próxima fonte
    }
  }
  // Sem internet: segue com a última cotação salva
  return state.rate
}

function toast(msg) {
  toastEl.textContent = msg
  toastEl.classList.add('show')
  clearTimeout(toast.t)
  toast.t = setTimeout(() => toastEl.classList.remove('show'), 2600)
}

async function load(name) {
  const e = ENTITIES[name]
  const { data, error } = await sb.from(e.table).select('*').order(e.order[0], { ascending: e.order[1] })
  if (error) { toast('Erro ao carregar: ' + error.message); return state.data[name] || [] }
  // títulos de lives sempre em maiúsculas, inclusive os salvos antes dessa regra
  if (name === 'lives') for (const l of data) if (l.title) l.title = l.title.toLocaleUpperCase('pt-BR')
  return (state.data[name] = data)
}

// ---------- Login ----------

function renderLogin() {
  app.innerHTML = `
    <main class="login">
      <h1>My <span class="gold">Stats</span></h1>
      <p class="muted">Entre com o seu usuário do Supabase.</p>
      <form id="login" class="stack">
        <label class="field"><span>E-mail</span><input name="email" type="email" autocomplete="username" required></label>
        <label class="field"><span>Senha</span><input name="password" type="password" autocomplete="current-password" required></label>
        <button class="btn primary" type="submit">Entrar</button>
      </form>
    </main>`
  document.getElementById('login').addEventListener('submit', async ev => {
    ev.preventDefault()
    const f = new FormData(ev.target)
    const btn = ev.target.querySelector('button')
    btn.disabled = true
    const { error } = await sb.auth.signInWithPassword({ email: f.get('email'), password: f.get('password') })
    btn.disabled = false
    if (error) toast('Não foi possível entrar: ' + error.message)
  })
}

// ---------- Shell ----------

function renderShell() {
  app.innerHTML = `
    <header class="top"><h1 id="title"></h1>
      <div class="top-actions">
        <button id="prints" class="prints-btn" aria-label="Mandar prints">
          <svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="15" rx="3"/><circle cx="12" cy="12.5" r="3.5"/><path d="M8 5l1.5-2h5L16 5"/></svg>
          <span>Prints</span><i class="due" hidden></i>
        </button>
        <button id="add" class="icon-btn" aria-label="Adicionar"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></button>
      </div></header>
    <main id="view"></main>
    <nav class="tabs">${TABS.map(t => `
      <button data-tab="${t.id}"><svg viewBox="0 0 24 24">${t.icon}</svg><span>${t.label}</span></button>`).join('')}
    </nav>`
  app.querySelector('.tabs').addEventListener('click', ev => {
    const b = ev.target.closest('button[data-tab]')
    if (b) go(b.dataset.tab)
  })
  document.getElementById('add').addEventListener('click', () => openForm(state.tab === 'home' ? 'lives' : state.tab))
  document.getElementById('prints').addEventListener('click', openPrints)
  go(state.tab)
}

function go(tab) {
  state.tab = tab
  app.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab))
  document.getElementById('title').textContent = { home: 'Início', rewards: 'Recompensas', stats: 'Estatísticas' }[tab] ?? ENTITIES[tab].title
  document.getElementById('add').hidden = tab === 'rewards' || tab === 'stats'
  document.getElementById('prints').hidden = !['lives', 'rewards'].includes(tab)
  if (tab !== 'rewards' && tab !== 'stats') document.getElementById('add').setAttribute('aria-label', tab === 'home' ? 'Adicionar live' : `Adicionar ${ENTITIES[tab].single}`)
  window.scrollTo(0, 0)
  return tab === 'home' ? renderHome() : tab === 'rewards' ? renderRewards() : tab === 'lives' ? renderLives() : tab === 'stats' ? renderStats() : renderList(tab)
}

// ---------- Início ----------

async function renderHome() {
  const view = document.getElementById('view')
  view.innerHTML = '<p class="muted center">Carregando…</p>'
  const [lives, withdrawals] = await Promise.all(['lives', 'withdrawals'].map(load))
  await freshRate()
  if (state.tab !== 'home') return

  const month = today().slice(0, 7)
  const ml = lives.filter(l => l.date?.startsWith(month))
  const sum = (arr, k) => arr.reduce((s, r) => s + (Number(r[k]) || 0), 0)
  const saques = withdrawals.filter(w => w.date?.startsWith(month)).length
  const monthName = new Date().toLocaleDateString('pt-BR', { month: 'long' })
  const monthLabel = monthName[0].toUpperCase() + monthName.slice(1)

  const rewards = sum(ml, 'rewards_usd')
  const fees = saques * WITHDRAW_FEE_USD
  const net = Math.max(rewards - fees, 0)
  const commercial = state.rate?.commercial
  const payout = payoutRate(withdrawals, commercial)
  const rate = payout?.rate ?? null
  const perLive = ml.length ? rewards / ml.length : 0
  const life = lifetime(lives)

  view.innerHTML = `
    <div class="lifetime">
      <div class="gem"><span>Diamantes acumulados</span><b>${esc(int(life.diamonds))}</b></div>
      <div><span>Valor estimado</span><b>${esc(usd0(Math.round(life.usd)))}</b></div>
      <small>desde nov/2023</small>
    </div>
    <section class="hero">
      <div class="hero-head"><span>Saldo estimado do mês</span><i class="pill">${esc(monthLabel)}</i></div>
      <strong>${rate ? esc(brl(net * rate)) : esc(usd(net))}</strong>
      <div class="usd">${rate ? `${esc(usd(net))} × ${esc(brl(rate))}` : 'Sem cotação do dólar no momento'}</div>
      ${fees ? `<div class="fee">${esc(usd(rewards))} em recompensas − ${esc(usd(fees))} de taxa (${saques} ${saques === 1 ? 'saque' : 'saques'} × US$ 3)</div>` : ''}
      <div class="gems">
        <svg viewBox="0 0 24 24"><path d="M6 3h12l4 6-10 12L2 9z"/><path d="M2 9h20M12 21L8 9l4-6 4 6z"/></svg>
        <b>${esc(int(sum(ml, 'diamonds')))}</b><span>diamantes registrados</span>
      </div>
    </section>
    <div class="rate">
      <div class="flag">US$</div>
      <div class="txt"><span>${payout?.source === 'saque' ? 'Dólar do último saque' : 'Dólar estimado para saque'}</span><strong>${rate ? esc(brlRate(rate)) : '—'}</strong></div>
      <div class="calc">${payout?.source === 'saque' ? `comercial hoje<br><b>${commercial ? esc(brl(commercial)) : '—'}</b>` : commercial ? `comercial <b>${esc(brl(commercial))}</b><br>− R$ 0,18` : 'sem conexão'}${state.rate?.source === 'Banco Central' ? '<br>(Banco Central)' : ''}</div>
    </div>
    <section>
      <h2>Lives em ${esc(monthName)}</h2>
      <div class="grid">
        ${stat('Lives registradas', int(ml.length))}
        ${stat('Horas ao vivo', hours(sum(ml, 'duration_min')))}
        ${stat('Novos seguidores', int(sum(ml, 'new_followers')))}
        ${stat('Média por live', rate ? brl(perLive * rate) : usd(perLive), '', rate ? usd(perLive) : '')}
        ${stat('Pico médio', int(ml.length ? Math.round(sum(ml, 'peak_viewers') / ml.length) : 0))}
        ${stat('Curtidas', int(sum(ml, 'likes')))}
      </div>
    </section>
    <section>
      <h2>Últimas lives</h2>
      ${lives.length ? liveList(lives.slice(0, 5), rate) : empty('Nenhuma live registrada.', 'lives')}
    </section>
    <button id="logout" class="btn ghost">Sair</button>`
  bindList(view)
  reveal(view)
  document.getElementById('logout').addEventListener('click', () => sb.auth.signOut())
}

// Dias seguidos com live (hoje ainda pode ter live, então a conta começa ontem se hoje não teve)
function streakCard(lives) {
  const days = new Set(lives.map(l => l.date))
  if (!days.size) return ''
  const ymd = d => d.toLocaleDateString('sv-SE')
  const d = new Date()
  const liveToday = days.has(ymd(d))
  if (!liveToday) d.setDate(d.getDate() - 1)
  let streak = 0
  while (days.has(ymd(d))) { streak++; d.setDate(d.getDate() - 1) }
  let best = 0, run = 0
  const all = [...days].sort()
  for (let i = 0; i < all.length; i++) {
    const gap = i ? (new Date(`${all[i]}T12:00`) - new Date(`${all[i - 1]}T12:00`)) / 864e5 : 1
    run = gap === 1 ? run + 1 : 1
    best = Math.max(best, run)
  }
  const dots = Array.from({ length: 14 }, (_, i) => {
    const x = new Date(); x.setDate(x.getDate() - 13 + i)
    return `<i class="${days.has(ymd(x)) ? 'on' : ''} ${i === 13 ? 'today' : ''}"></i>`
  }).join('')
  return `
    <section class="streak">
      <span class="n">${streak}</span>
      <b>${streak === 1 ? 'dia seguido com live' : 'dias seguidos com live'}</b>
      <span class="muted small">Sua maior sequência: ${best} ${best === 1 ? 'dia' : 'dias'}${liveToday ? '' : ' · hoje ainda não teve live'}</span>
      <div class="dots">${dots}</div>
    </section>`
}

// Mês passado: como fechou
function closedCard(ml, rate, monthName) {
  const gems = ml.reduce((s, l) => s + (Number(l.diamonds) || 0), 0)
  if (!gems) return ''
  const total = gems * 0.01 * 0.51
  return `
    <section class="proj">
      <span class="lead">${esc(monthName[0].toUpperCase() + monthName.slice(1))} fechou com</span>
      <b class="big">${esc(int(gems))} diamantes</b>
      <div class="row"><span>Lives</span><b>${ml.length}</b></div>
      <div class="row"><span>Em dólares (51%)</span><b>${esc(usd(total))}</b></div>
      ${rate ? `<div class="row"><span>Em reais (cotação de hoje)</span><b>${esc(brl(total * rate))}</b></div>` : ''}
      <div class="row"><span>Limite de saque no mês seguinte</span><b class="gold">${esc(usd0(limitFor(total).tier[1]))} por dia</b></div>
    </section>`
}

// No ritmo do mês até hoje, quanto o mês fecha
function projectionCard(ml, rate, monthName) {
  const gems = ml.reduce((s, l) => s + (Number(l.diamonds) || 0), 0)
  if (!gems) return ''
  const now = new Date()
  const nDays = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const projected = gems / now.getDate() * nDays
  const projUsd = projected * 0.01 * 0.51
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1).toLocaleDateString('pt-BR', { month: 'long' })
  return `
    <section class="proj">
      <span class="lead">No ritmo atual, ${esc(monthName)} fecha com</span>
      <b class="big">${esc(int(Math.round(projected)))} diamantes</b>
      <div class="pbar"><i style="transform:scaleX(${(gems / projected).toFixed(3)})"></i></div>
      <div class="row"><span>Até hoje (dia ${now.getDate()} de ${nDays})</span><b>${esc(int(gems))}</b></div>
      <div class="row"><span>Em dólares (51%)</span><b>${esc(usd(projUsd))}</b></div>
      ${rate ? `<div class="row"><span>Em reais</span><b>${esc(brl(projUsd * rate))}</b></div>` : ''}
      <div class="row"><span>Limite de saque em ${esc(nextMonth)}</span><b class="gold">${esc(usd0(limitFor(projUsd).tier[1]))} por dia</b></div>
    </section>`
}

const brlRate = r => 'R$ ' + new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 }).format(r)

async function freshRate() {
  if (state.rate && Date.now() - (state.rateFetched || 0) < 30 * 60e3) return
  await loadRate()
  state.rateFetched = Date.now()
}

function liveList(rows, rate) {
  return `<ul class="list">${rows.map(r => `
    <li><button data-edit="lives" data-id="${r.id}">
      <div class="txt"><strong>${esc(r.title || fmtDate(r.date))}</strong>
        <span>${esc([r.title && fmtDate(r.date), r.duration_min && hours(r.duration_min), r.new_followers != null && `+${int(r.new_followers)} seg.`, r.diamonds != null && `${int(r.diamonds)} diamantes`].filter(Boolean).join(' · '))}</span></div>
      ${r.rewards_usd != null ? `<div class="val"><b>${esc(rate ? brl(r.rewards_usd * rate) : usd(r.rewards_usd))}</b>${rate ? `<span>${esc(usd(r.rewards_usd))}</span>` : ''}</div>` : ''}
    </button></li>`).join('')}</ul>`
}

// ---------- Animação ao rolar ----------

const revealer = new IntersectionObserver(entries => {
  for (const e of entries) {
    if (!e.isIntersecting) continue
    e.target.classList.add('in')
    revealer.unobserve(e.target)
  }
}, { rootMargin: '0px 0px -6% 0px' })

function reveal(root) {
  root.querySelectorAll('.hero, .rate, .lifetime, .streak, .proj, .card, .records, h2, .stat, .list li, .empty').forEach(el => {
    const i = [...el.parentElement.children].indexOf(el)
    el.classList.add('reveal')
    el.style.transitionDelay = `${Math.min(i, 5) * 50}ms`
    revealer.observe(el)
  })
}

const stat = (label, value, tone = '', sub = '') => `<div class="stat ${tone}"><span>${esc(label)}</span><strong>${esc(value)}</strong>${sub ? `<small>${esc(sub)}</small>` : ''}</div>`
const empty = (msg, name) => `<div class="empty"><p class="muted">${esc(msg)}</p><button class="btn" data-new="${name}">Adicionar</button></div>`

function list(name, rows) {
  const e = ENTITIES[name]
  return `<ul class="list">${rows.map(r => {
    const it = e.item(r)
    return `<li><button data-edit="${name}" data-id="${r.id}">
      <div class="txt"><strong>${esc(it.title)}</strong>${it.meta ? `<span>${esc(it.meta)}</span>` : ''}</div>
      ${it.value ? `<em class="${it.tone || ''}">${esc(it.value)}</em>` : ''}
      ${it.tag ? `<i class="tag ${esc(it.tag)}">${esc((LIVE_STATUS[it.tag] || VIDEO_STATUS[it.tag]))}</i>` : ''}
    </button></li>`
  }).join('')}</ul>`
}

function bindList(root) {
  root.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => {
    const row = state.data[b.dataset.edit].find(r => r.id === b.dataset.id)
    openForm(b.dataset.edit, row)
  }))
  root.querySelectorAll('[data-new]').forEach(b => b.addEventListener('click', () => openForm(b.dataset.new)))
}

// ---------- Listas ----------

async function renderList(name) {
  const view = document.getElementById('view')
  if (!state.data[name]) view.innerHTML = '<p class="muted center">Carregando…</p>'
  else paint(name)
  await load(name)
  if (state.tab === name) paint(name)
}

function paint(name) {
  const view = document.getElementById('view')
  const rows = state.data[name] || []
  view.innerHTML = rows.length ? list(name, rows) : empty(`Nada por aqui ainda.`, name)
  bindList(view)
  reveal(view)
}

// ---------- Formulário ----------

function input(f, v) {
  const id = `f-${f.key}`
  const req = f.required ? 'required' : ''
  let el
  if (f.type === 'textarea') el = `<textarea id="${id}" name="${f.key}" rows="${f.rows || 3}" ${req}>${esc(v)}</textarea>`
  else if (f.type === 'select') el = `<select id="${id}" name="${f.key}">${Object.entries(f.options).map(([k, l]) => `<option value="${k}" ${k === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`
  else if (f.type === 'int') el = `<input id="${id}" name="${f.key}" type="number" inputmode="numeric" step="1" min="0" value="${esc(v)}" ${req}>`
  else if (f.type === 'money') el = `<input id="${id}" name="${f.key}" type="text" inputmode="decimal" placeholder="0,00" value="${v != null && v !== '' ? esc(String(v).replace('.', ',')) : ''}" ${req}>`
  else if (f.type === 'date') el = `<input id="${id}" name="${f.key}" type="date" value="${esc(v)}" ${req}>`
  else if (f.type === 'datetime') el = `<input id="${id}" name="${f.key}" type="datetime-local" value="${v ? esc(toLocalInput(v)) : ''}" ${req}>`
  else el = `<input id="${id}" name="${f.key}" type="text" value="${esc(v)}" ${f.upper ? 'autocapitalize="characters" class="upper"' : ''} ${req}>`
  return `<label class="field ${f.half ? 'half' : ''}" for="${id}"><span>${esc(f.label)}</span>${el}</label>`
}

function parse(f, raw) {
  const s = String(raw ?? '').trim()
  if (s === '') return null
  if (f.upper) return s.toLocaleUpperCase('pt-BR')
  if (f.type === 'int') return parseInt(s, 10)
  if (f.type === 'money') {
    // "1.500,50" e "1500.50" viram 1500.5
    const n = Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s)
    if (Number.isNaN(n)) throw new Error(`Valor inválido em "${f.label}"`)
    return n
  }
  if (f.type === 'datetime') return new Date(s).toISOString()
  return s
}

function openForm(name, row, prefill) {
  const e = ENTITIES[name]
  const editing = !!row
  sheet.innerHTML = `
    <form method="dialog" class="sheet-body">
      <div class="sheet-head">
        <button type="button" class="link" data-close>Cancelar</button>
        <strong>${editing ? 'Editar' : 'Nova'} ${esc(e.single)}</strong>
        <button type="submit" class="link strong">Salvar</button>
      </div>
      ${e.importer ? `
      <div class="importer">
        <label class="btn primary file-btn" for="import-files">Escolher prints</label>
        <input id="import-files" type="file" accept="image/*" multiple hidden>
        <p class="muted">Selecione os 3 prints da live (Viewership, Engagement e Rewards) de uma vez.</p>
        <details>
          <summary>Colar texto em vez disso</summary>
          <button type="button" class="btn" data-paste>Colar dados do print</button>
          <textarea id="import-text" rows="3" placeholder="Ou cole o texto aqui…" aria-label="Texto do print"></textarea>
        </details>
        <span id="import-status" class="muted" role="status"></span>
        <details class="raw-box" hidden><summary>Ver texto lido</summary><pre id="import-raw"></pre></details>
      </div>` : ''}
      <div class="fields">${e.fields.map(f => input(f, editing ? row[f.key] : f.default?.() ?? '')).join('')}</div>
      ${editing ? '<button type="button" class="btn danger" data-delete>Excluir</button>' : ''}
    </form>`
  const form = sheet.querySelector('form')
  if (e.importer) {
    const apply = bindImporter(form, e)
    if (prefill) apply(prefill)
  }
  sheet.querySelector('[data-close]').addEventListener('click', () => closeSheet())
  sheet.querySelector('[data-delete]')?.addEventListener('click', async () => {
    if (!confirm('Excluir este registro?')) return
    const { error } = await sb.from(e.table).delete().eq('id', row.id)
    if (error) return toast('Erro ao excluir: ' + error.message)
    closeSheet(); toast('Excluído'); go(state.tab)
  })
  form.addEventListener('submit', async ev => {
    ev.preventDefault()
    let values
    try {
      const fd = new FormData(form)
      values = Object.fromEntries(e.fields.map(f => [f.key, parse(f, fd.get(f.key))]))
    } catch (err) { return toast(err.message) }
    const q = editing ? sb.from(e.table).update(values).eq('id', row.id) : sb.from(e.table).insert(values)
    const { error } = await q
    if (error) return toast('Erro ao salvar: ' + error.message)
    closeSheet(); toast('Salvo'); go(state.tab)
  })
  sheet.showModal()
  // o iPhone foca o primeiro botão ao abrir (o "Cancelar") e desenha um contorno nele
  document.activeElement?.blur()
}

function bindImporter(form, e) {
  const box = form.querySelector('#import-text')
  const status = form.querySelector('#import-status')
  const filled = new Set()
  const apply = text => {
    const data = parseTikTok(text)
    let n = 0
    for (const f of e.fields) {
      if (data[f.key] == null) continue
      const el = form.elements[f.key]
      el.value = f.type === 'money' ? String(data[f.key]).replace('.', ',') : data[f.key]
      el.closest('.field').classList.add('auto')
      filled.add(f.key); n++
    }
    // Sem a recompensa no print, calcula: diamantes × US$ 0,01 × porcentagem da live (duração e seguidores)
    let calculated = false
    const rewardsEl = form.elements.rewards_usd
    if (data.rewards_usd == null && !rewardsEl.value && num(form.elements.diamonds.value)) {
      const pctLive = livePct(num(form.elements.duration_min.value), num(form.elements.new_followers.value))
      rewardsEl.value = (num(form.elements.diamonds.value) * pctLive / 10000).toFixed(2).replace('.', ',')
      rewardsEl.closest('.field').classList.add('auto', 'calc')
      calculated = true
    }
    status.textContent = n
      ? `${filled.size} campos preenchidos.${calculated ? ' Recompensa calculada pelos diamantes: confira no print.' : ''} Confira antes de salvar.`
      : 'Não encontrei dados da live nesse texto.'
  }
  form.querySelector('[data-paste]').addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (text) return apply(text)
    } catch {}
    box.focus()
    status.textContent = 'Cole o texto na caixa abaixo.'
  })
  box.addEventListener('input', () => { if (box.value.trim()) { apply(box.value); box.value = '' } })
  const files = form.querySelector('#import-files')
  const pick = form.querySelector('.file-btn')
  files.addEventListener('change', async () => {
    if (!files.files.length) return
    pick.classList.add('busy')
    try {
      const text = (await readEach([...files.files], msg => { status.textContent = msg })).join('\n')
      form.querySelector('#import-raw').textContent = text
      form.querySelector('.raw-box').hidden = false
      apply(text)
    } catch (err) {
      status.textContent = err.message || 'Não consegui ler os prints. Tente colar o texto.'
    } finally {
      pick.classList.remove('busy')
      files.value = ''
    }
  })
  return apply
}

function closeSheet() {
  sheet.classList.add('closing')
  setTimeout(() => { sheet.close(); sheet.classList.remove('closing') }, 200)
}
sheet.addEventListener('click', ev => { if (ev.target === sheet) closeSheet() })
sheet.addEventListener('cancel', ev => { ev.preventDefault(); closeSheet() })

// ---------- Lives: mês a mês ----------

const shortDay = d => new Date(`${d}T12:00`).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' })

function monthStats(lives, month) {
  const ls = lives.filter(l => l.date?.startsWith(month))
  const total = k => ls.reduce((s, l) => s + (Number(l[k]) || 0), 0)
  const days = new Set(ls.map(l => l.date)).size
  const gems = total('diamonds')
  const min = total('duration_min')
  return { ls, days, gems, min, usd: total('rewards_usd'),
    perDay: days ? gems / days : 0, perHour: min ? gems / (min / 60) : 0, perLive: ls.length ? gems / ls.length : 0 }
}

function funnelCard(s, prev) {
  const f = st => {
    const t = k => st.ls.reduce((a, l) => a + (Number(l[k]) || 0), 0)
    const views = t('views'), unique = t('unique_viewers'), gifters = t('gifters'), followers = t('new_followers'), gems = t('diamonds')
    return { views, unique, gifters, followers,
      fol: unique ? followers / unique * 1000 : null, gif: unique ? gifters / unique * 100 : null, tick: gifters ? gems / gifters : null }
  }
  const F = f(s)
  if (!F.views || !F.unique) return ''
  const P = prev ? f(prev) : null
  const change = (cur, before) => (cur != null && before ? `<small class="${cur >= before ? 'pos' : 'neg'}">${cur >= before ? '↑' : '↓'} ${int(Math.round(Math.abs((cur - before) / before * 100)))}%</small>` : '')
  const dec1 = v => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(v)
  return `
    <section class="card">
      <h2>Funil do mês</h2>
      <div class="funnel">${[['Visualizações', F.views], ['Espectadores únicos', F.unique], ['Presenteadores', F.gifters], ['Novos seguidores', F.followers]].map(([n, v]) =>
        `<div class="step"><span>${n}</span><b>${esc(int(v))}</b><i style="transform:scaleX(${Math.max(v / F.views, 0.015).toFixed(3)})"></i></div>`).join('')}</div>
      <div class="kpis">
        <div><span>Seguidores a cada 1.000 espectadores</span><b>${F.fol != null ? dec1(F.fol) : '—'}</b>${change(F.fol, P?.fol)}</div>
        <div><span>Espectadores que presenteiam</span><b>${F.gif != null ? dec1(F.gif) + '%' : '—'}</b>${change(F.gif, P?.gif)}</div>
        <div><span>Diamantes por presenteador</span><b>${F.tick != null ? esc(int(Math.round(F.tick))) : '—'}</b>${change(F.tick, P?.tick)}</div>
      </div>
      <p class="muted small">Somando todas as lives do mês. A variação é contra o mês anterior.</p>
    </section>`
}

function retentionCard(lives, months) {
  const avg = (ls, k) => { const v = ls.map(l => Number(l[k])).filter(n => n > 0); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null }
  const rows = months.map(m => { const ls = lives.filter(l => l.date?.startsWith(m)); return { m, watch: avg(ls, 'avg_watch_sec'), peak: avg(ls, 'peak_viewers') } })
    .filter(r => r.watch != null)
  if (!rows.length) return ''
  const cur = rows.at(-1), before = rows.at(-2)
  const label = m => new Date(`${m}-15T12:00`).toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '')
  let chart = ''
  if (rows.length > 1) {
    const lo = Math.min(...rows.map(r => r.watch)) - 3, hi = Math.max(...rows.map(r => r.watch)) + 3
    const pts = rows.map((r, i) => [i / (rows.length - 1) * 300, 76 - (r.watch - lo) / (hi - lo) * 70].map(n => n.toFixed(1)))
    const line = pts.map(p => p.join(' ')).join(' L')
    chart = `
      <svg class="spark" viewBox="0 0 300 80" preserveAspectRatio="none" role="img" aria-label="Tempo médio assistido por mês">
        <path d="M${line} L300 80 L0 80 Z" fill="rgb(227 182 90 / 0.12)" stroke="none"/>
        <path d="M${line}" fill="none" stroke="var(--accent)" stroke-width="2"/>
        ${pts.map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${i === pts.length - 1 ? 4 : 3}" fill="${i === pts.length - 1 ? 'var(--accent-2)' : 'var(--accent)'}"/>`).join('')}
      </svg>
      <div class="legend">${rows.map(r => `<span>${esc(label(r.m))} · ${Math.round(r.watch)} s</span>`).join('')}</div>`
  }
  const d = before ? Math.round(cur.watch - before.watch) : null
  return `
    <section class="card">
      <h2>Retenção</h2>
      <div class="row"><span>Tempo médio assistido</span><b>${Math.round(cur.watch)} s${d != null ? ` <small class="${d >= 0 ? 'pos' : 'neg'}">${d >= 0 ? '+' : '−'}${Math.abs(d)} s</small>` : ''}</b></div>
      ${chart}
      ${cur.peak != null ? `<div class="row"><span>Pico médio por live</span><b>${esc(int(Math.round(cur.peak)))}${before?.peak != null ? ` <small class="muted">(${esc(label(before.m))}: ${esc(int(Math.round(before.peak)))})</small>` : ''}</b></div>` : ''}
    </section>`
}

function recordsCard(lives) {
  const withField = k => lives.filter(l => Number(l[k]) > 0)
  const top = k => withField(k).reduce((a, l) => (!a || Number(l[k]) > Number(a[k]) ? l : a), null)
  const byMonth = {}
  for (const l of lives) if (l.date) byMonth[l.date.slice(0, 7)] = (byMonth[l.date.slice(0, 7)] || 0) + (Number(l.diamonds) || 0)
  const bestMonth = Object.entries(byMonth).sort((a, b) => b[1] - a[1])[0]
  const days = [...new Set(lives.map(l => l.date).filter(Boolean))].sort()
  let best = 0, run = 0, bestEnd = null
  days.forEach((d, i) => {
    run = i && (new Date(`${d}T12:00`) - new Date(`${days[i - 1]}T12:00`)) / 864e5 === 1 ? run + 1 : 1
    if (run > best) { best = run; bestEnd = d }
  })
  const fresh = d => d && (Date.now() - new Date(`${d}T12:00`)) / 864e5 <= 7
  const dmy = d => new Date(`${d}T12:00`).toLocaleDateString('pt-BR')
  const items = [
    top('diamonds') && ['Maior live em diamantes', int(top('diamonds').diamonds), dmy(top('diamonds').date), top('diamonds').date],
    top('new_followers') && ['Mais seguidores numa live', '+' + int(top('new_followers').new_followers), dmy(top('new_followers').date), top('new_followers').date],
    top('peak_viewers') && ['Maior pico de espectadores', int(top('peak_viewers').peak_viewers), dmy(top('peak_viewers').date), top('peak_viewers').date],
    bestMonth && bestMonth[1] && ['Melhor mês', `${int(bestMonth[1])} diamantes`, new Date(`${bestMonth[0]}-15T12:00`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }), null],
    best > 1 && ['Maior sequência de dias com live', `${best} dias`, `até ${dmy(bestEnd)}`, bestEnd],
  ].filter(Boolean)
  if (!items.length) return ''
  return `
    <section>
      <h2>Recordes</h2>
      <ul class="records">${items.map(([label, value, when, date]) => `
        <li class="${fresh(date) ? 'fresh' : ''}"><span>${esc(label)}</span><b>${esc(value)}</b><small>${esc(when)}</small></li>`).join('')}</ul>
    </section>`
}

const perHour = l => (l.duration_min ? (Number(l.diamonds) || 0) / (l.duration_min / 60) : 0)

async function renderLives() {
  const view = document.getElementById('view')
  if (!state.data.lives) view.innerHTML = '<p class="muted center">Carregando…</p>'
  const lives = await load('lives')
  if (state.tab !== 'lives') return
  const months = [...new Set([today().slice(0, 7), ...lives.map(l => l.date?.slice(0, 7)).filter(Boolean)])].sort()
  if (!months.includes(state.lmonth)) state.lmonth = months.at(-1)
  const i = months.indexOf(state.lmonth)
  const s = monthStats(lives, state.lmonth)
  const prev = i > 0 ? monthStats(lives, months[i - 1]) : null
  const name = new Date(`${state.lmonth}-15T12:00`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })

  const delta = (cur, before) => {
    if (!before) return ''
    const p = (cur - before) / before * 100
    return `<span class="${p >= 0 ? 'pos' : 'neg'}">${p >= 0 ? '↑' : '↓'} ${int(Math.round(Math.abs(p)))}% vs. mês anterior</span>`
  }
  const card = (label, value, cur, before, tone = '') =>
    `<div class="stat ${tone}"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${delta(cur, before)}</small></div>`

  let body
  if (!s.ls.length) {
    body = empty('Nenhuma live neste mês.', 'lives')
  } else {
    const best = [...s.ls].sort((a, b) => (b.diamonds || 0) - (a.diamonds || 0))[0]
    const max = Number(best.diamonds) || 1
    const sorted = state.lsort === 'diamantes' ? [...s.ls].sort((a, b) => (b.diamonds || 0) - (a.diamonds || 0))
      : state.lsort === 'hora' ? [...s.ls].sort((a, b) => perHour(b) - perHour(a))
      : s.ls
    const [y, m] = state.lmonth.split('-').map(Number)
    const nDays = new Date(y, m, 0).getDate()
    const byDay = Array.from({ length: nDays }, (_, d) => s.ls.filter(l => +l.date.slice(8) === d + 1).reduce((a, l) => a + (Number(l.diamonds) || 0), 0))
    const top = Math.max(...byDay, 1)
    const W = 300, H = 110, bw = W / nDays
    const bars = byDay.map((g, d) => g ? `<rect x="${(d * bw + bw * 0.15).toFixed(1)}" y="${(H - g / top * H).toFixed(1)}" width="${(bw * 0.7).toFixed(1)}" height="${(g / top * H).toFixed(1)}" rx="2" fill="${g === top ? 'var(--accent-2)' : 'var(--accent)'}" opacity="${g === top ? 1 : 0.65}"/>` : '').join('')
    const avgY = (H - s.perDay / top * H).toFixed(1)
    body = `
      <section>
        <h2>Comparativo do mês</h2>
        <div class="grid">
          ${card('Diamantes no mês', int(s.gems), s.gems, prev?.gems, 'gemv')}
          ${card('Recompensas', usd(s.usd), s.usd, prev?.usd)}
          ${card('Média por dia de live', int(Math.round(s.perDay)), s.perDay, prev?.perDay)}
          ${card('Média por hora', int(Math.round(s.perHour)), s.perHour, prev?.perHour)}
          ${card('Média por live', int(Math.round(s.perLive)), s.perLive, prev?.perLive)}
          ${card('Horas ao vivo', hours(s.min), s.min, prev?.min)}
        </div>
      </section>
      <section class="best">
        <div class="hero-head"><span>Melhor live do mês</span><i class="pill">${esc(shortDay(best.date))}</i></div>
        <b class="best-title">${esc(best.title || fmtDate(best.date))}</b>
        <div class="best-nums"><span><b>${esc(int(best.diamonds))}</b> diamantes</span>${best.duration_min ? `<span>${esc(hours(best.duration_min))}</span><span><b>${esc(int(Math.round(perHour(best))))}</b> por hora</span>` : ''}${best.new_followers != null ? `<span>+${esc(int(best.new_followers))} seguidores</span>` : ''}</div>
      </section>
      <section class="card chart">
        <h2>Diamantes por dia</h2>
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Diamantes por dia do mês">
          <line x1="0" x2="${W}" y1="${H}" y2="${H}" stroke="var(--line)"/>${bars}
          <line x1="0" x2="${W}" y1="${avgY}" y2="${avgY}" stroke="#8fe3ff" stroke-dasharray="4 4" stroke-width="1"/>
        </svg>
        <div class="legend"><span>dia 1</span><span class="gem-txt">média por dia de live: ${esc(int(Math.round(s.perDay)))}</span><span>dia ${nDays}</span></div>
      </section>
      <section>
        <div class="sort-row"><h2>Lives</h2>
          <div class="chips" role="group" aria-label="Ordenar">${[['data', 'Data'], ['diamantes', 'Diamantes'], ['hora', 'Por hora']].map(([k, l]) =>
            `<button type="button" data-lsort="${k}" aria-pressed="${state.lsort === k}">${l}</button>`).join('')}</div>
        </div>
        <ul class="list live-rank">${sorted.map(l => `
          <li><button data-edit="lives" data-id="${l.id}">
            <div class="txt"><strong>${esc(l.title || fmtDate(l.date))}</strong>
              <span>${l === best ? '<b class="gold">Melhor do mês</b> · ' : ''}${esc([shortDay(l.date), l.duration_min && hours(l.duration_min), l.duration_min && l.diamonds != null && `${int(Math.round(perHour(l)))}/h`].filter(Boolean).join(' · '))}</span></div>
            <div class="val"><b class="gem-txt">${l.diamonds != null ? esc(int(l.diamonds)) : '—'}</b>${l.rewards_usd != null ? `<span>${esc(usd(l.rewards_usd))}</span>` : ''}</div>
            <i class="rank-bar"><i style="transform:scaleX(${(Number(l.diamonds) || 0) / max})"></i></i>
          </button></li>`).join('')}</ul>
      </section>`
  }

  view.innerHTML = `
    <div class="month-pick">
      <button type="button" data-month="-1" aria-label="Mês anterior" ${i === 0 ? 'disabled' : ''}><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button>
      <div><strong>${esc(name[0].toUpperCase() + name.slice(1))}</strong><span>${s.ls.length} ${s.ls.length === 1 ? 'live' : 'lives'} · ${s.days} ${s.days === 1 ? 'dia' : 'dias'} de live</span></div>
      <button type="button" data-month="1" aria-label="Próximo mês" ${i === months.length - 1 ? 'disabled' : ''}><svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg></button>
    </div>
    ${body}`
  view.querySelectorAll('[data-month]').forEach(b => b.addEventListener('click', () => {
    state.lmonth = months[i + Number(b.dataset.month)]
    renderLives()
  }))
  view.querySelectorAll('[data-lsort]').forEach(b => b.addEventListener('click', () => { state.lsort = b.dataset.lsort; renderLives() }))
  bindList(view)
  reveal(view)
}

// ---------- Estatísticas ----------

async function renderStats() {
  const view = document.getElementById('view')
  if (!state.data.lives) view.innerHTML = '<p class="muted center">Carregando…</p>'
  const [lives, withdrawals] = await Promise.all(['lives', 'withdrawals'].map(load))
  await freshRate()
  if (state.tab !== 'stats') return
  const current = today().slice(0, 7)
  const months = [...new Set([current, ...lives.map(l => l.date?.slice(0, 7)).filter(Boolean)])].sort()
  if (!months.includes(state.smonth)) state.smonth = current
  const i = months.indexOf(state.smonth)
  const s = monthStats(lives, state.smonth)
  const prev = i > 0 ? monthStats(lives, months[i - 1]) : null
  const rate = payoutRate(withdrawals, state.rate?.commercial)?.rate ?? null
  const name = new Date(`${state.smonth}-15T12:00`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
  const monthOnly = new Date(`${state.smonth}-15T12:00`).toLocaleDateString('pt-BR', { month: 'long' })
  const parts = [
    streakCard(lives),
    state.smonth === current ? projectionCard(s.ls, rate, monthOnly) : closedCard(s.ls, rate, monthOnly),
    funnelCard(s, prev),
    retentionCard(lives, months.slice(Math.max(0, i - 5), i + 1)),
    recordsCard(lives),
  ].filter(Boolean)
  view.innerHTML = `
    <div class="month-pick">
      <button type="button" data-smonth="-1" aria-label="Mês anterior" ${i === 0 ? 'disabled' : ''}><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button>
      <div><strong>${esc(name[0].toUpperCase() + name.slice(1))}</strong><span>${s.ls.length} ${s.ls.length === 1 ? 'live' : 'lives'} no mês</span></div>
      <button type="button" data-smonth="1" aria-label="Próximo mês" ${i === months.length - 1 ? 'disabled' : ''}><svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg></button>
    </div>
    ${parts.length ? parts.join('') : empty('Registre lives pelos prints para ver as estatísticas.', 'lives')}`
  view.querySelectorAll('[data-smonth]').forEach(b => b.addEventListener('click', () => {
    state.smonth = months[i + Number(b.dataset.smonth)]
    renderStats()
  }))
  bindList(view)
  reveal(view)
}

// ---------- Recompensas ----------

const CHECK = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>'
const pct = v => `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(v)}%`
const usd0 = v => 'US$ ' + new Intl.NumberFormat('pt-BR').format(v)
const num = v => Number(String(v ?? '').replace(/\./g, '').replace(',', '.')) || 0
const shortDate = d => new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
const SUB_TABS = { saldo: 'Saldo', missoes: 'Missões', limite: 'Limite', regras: 'Regras' }

async function loadSettings() {
  const { data } = await sb.from('settings').select('*').maybeSingle()
  return (state.data.settings = data || { daily_limit_usd: 5000 })
}

async function renderRewards() {
  const view = document.getElementById('view')
  if (!state.data.snapshots) view.innerHTML = '<p class="muted center">Carregando…</p>'
  await Promise.all([...['lives', 'withdrawals', 'snapshots'].map(load), loadSettings(), freshRate()])
  if (state.tab !== 'rewards') return
  updateDue()

  const L = ledger(state.data)
  const payout = payoutRate(state.data.withdrawals, state.rate?.commercial)
  const ctx = { L, payout, rate: payout?.rate }
  view.innerHTML = `
    <div class="seg" role="tablist">${Object.entries(SUB_TABS).map(([id, label]) =>
      `<button role="tab" data-rtab="${id}" aria-selected="${state.rtab === id}">${label}</button>`).join('')}</div>
    <div id="rpanel" class="panel">${{ saldo: saldoPanel, missoes: missoesPanel, limite: limitePanel, regras: regrasPanel }[state.rtab](ctx)}</div>`
  view.querySelector('.seg').addEventListener('click', ev => {
    const b = ev.target.closest('[data-rtab]')
    if (!b || b.dataset.rtab === state.rtab) return
    state.rtab = b.dataset.rtab
    renderRewards()
  })
  ;({ saldo: bindSaldo, missoes: bindMissoes, limite: bindLimite, regras: () => {} })[state.rtab](view, ctx)
  reveal(view)
}

const noPrint = () => `
  <div class="empty"><p class="muted">Mande o print de <b>Upcoming rewards</b> (Content rewards) para o app saber o seu saldo.</p>
  <button class="btn" type="button" data-open-prints>Mandar prints</button></div>`

function saldoPanel({ L, payout, rate }) {
  const wds = state.data.withdrawals
  const lastRate = wds[0]?.rate_brl ?? (rate ? rate.toFixed(4) : '')
  const entries = [
    ...(L.credit ? [{ when: L.credit.at, label: `Semanal ${shortDate(`${L.credit.week}T12:00`)}`, usd: L.credit.usd }] : []),
    ...state.data.lives.filter(l => l.rewards_usd != null).slice(0, 5).map(l => ({ when: new Date(`${l.date}T12:00`), label: `Live · ${shortDate(`${l.date}T12:00`)}`, usd: l.rewards_usd })),
  ].sort((a, b) => b.when - a.when).slice(0, 6)
  const due = weekEndOf(L.current)
  return `
    ${L.snap ? `
    <section class="hero">
      <div class="hero-head"><span>Disponível para sacar</span><i class="pill">print de ${esc(shortDate(L.snap.taken_at))}</i></div>
      <strong>${esc(usd(L.available))}</strong>
      <div class="usd">${rate ? `≈ ${esc(brl(Math.max(L.available - WITHDRAW_FEE_USD, 0) * rate))} num saque (US$ 1 = ${esc(brlRate(rate))}${payout.source === 'saque' ? '' : ', estimado'})` : ''}</div>
    </section>
    <div class="grid">
      ${stat('A receber da semana', usd(L.upcoming.usd), '', `cai seg. ${shortDate(due)} à 1h · ${pct(L.upcoming.pct)}`)}
      ${stat('Ganho no mês', usd(monthEarned(state.data, today().slice(0, 7))), '', rate ? '≈ ' + brl(monthEarned(state.data, today().slice(0, 7)) * rate) : '')}
    </div>` : noPrint()}

    <form class="card" id="w-form">
      <h2>Registrar saque</h2>
      <div class="grid">
        <label class="field" for="w-amount"><span>Valor sacado (US$)</span><input id="w-amount" name="amount" type="text" inputmode="decimal" placeholder="0,00" required></label>
        <label class="field" for="w-rate"><span>Dólar no Payoneer (R$)</span><input id="w-rate" name="rate" type="text" inputmode="decimal" value="${esc(String(lastRate).replace('.', ','))}" required></label>
      </div>
      <label class="field" for="w-date"><span>Data</span><input id="w-date" name="date" type="date" value="${today()}"></label>
      <div class="result">
        <div class="row"><span>Taxa do TikTok</span><b>− US$ 3,00</b></div>
        <div class="row"><span>Cai na sua conta</span><b class="total" id="w-total">R$ 0,00</b></div>
        <p class="muted small" id="w-warn"></p>
      </div>
      <button class="btn primary" type="submit">Registrar saque</button>
    </form>

    <section>
      <h2>Saques</h2>
      ${wds.length ? `<ul class="list">${wds.map(w => `
        <li><button type="button" data-withdrawal="${w.id}">
          <div class="txt"><strong>${esc(fmtDate(w.date))}</strong><span>${esc(usd(w.amount_usd))} − US$ 3 × ${esc(brlRate(Number(w.rate_brl)))}</span></div>
          <div class="val"><b>${esc(brl((w.amount_usd - WITHDRAW_FEE_USD) * w.rate_brl))}</b></div>
        </button></li>`).join('')}</ul>` : '<p class="muted small">Nenhum saque registrado.</p>'}
    </section>

    ${reportCard(wds)}

    ${entries.length ? `
    <section>
      <h2>Últimas entradas</h2>
      <ul class="list">${entries.map(e => `
        <li><div class="row-item"><span>${esc(e.label)}</span><b class="pos">+${esc(usd(e.usd))}</b></div></li>`).join('')}</ul>
    </section>` : ''}`
}

// Relatório do mês, só com os saques (em reais)
function reportData(wds) {
  const months = [...new Set(wds.map(w => w.date?.slice(0, 7)).filter(Boolean))].sort()
  if (!months.length) return null
  if (!months.includes(state.wmonth)) state.wmonth = months.at(-1)
  const ws = wds.filter(w => w.date?.startsWith(state.wmonth)).sort((a, b) => a.date.localeCompare(b.date))
  const got = w => (w.amount_usd - WITHDRAW_FEE_USD) * w.rate_brl
  const total = ws.reduce((s, w) => s + got(w), 0)
  const totalUsd = ws.reduce((s, w) => s + Number(w.amount_usd), 0)
  const name = new Date(`${state.wmonth}-15T12:00`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
  const text = [
    `My Stats · Saques de ${name}`, '',
    ...ws.map(w => `${new Date(`${w.date}T12:00`).toLocaleDateString('pt-BR')}: ${usd(w.amount_usd)} − US$ 3 × ${brlRate(Number(w.rate_brl))} = ${brl(got(w))}`), '',
    `Total sacado: ${usd(totalUsd)} (${ws.length} ${ws.length === 1 ? 'saque' : 'saques'}, ${usd(WITHDRAW_FEE_USD * ws.length)} de taxa)`,
    `Total recebido: ${brl(total)}`,
  ].join('\n')
  return { months, i: months.indexOf(state.wmonth), ws, got, total, totalUsd, name, text }
}

function reportCard(wds) {
  const r = reportData(wds)
  if (!r) return ''
  const label = r.name[0].toUpperCase() + r.name.slice(1)
  const net = r.totalUsd - WITHDRAW_FEE_USD * r.ws.length
  return `
    <section class="card report">
      <h2>Relatório do mês · saques</h2>
      <div class="mini-month">
        <button type="button" data-wmonth="-1" aria-label="Mês anterior" ${r.i === 0 ? 'disabled' : ''}>‹</button>
        <strong>${esc(label)}</strong>
        <button type="button" data-wmonth="1" aria-label="Próximo mês" ${r.i === r.months.length - 1 ? 'disabled' : ''}>›</button>
      </div>
      <div><span class="muted small">Recebido em reais</span><div class="total">${esc(brl(r.total))}</div></div>
      <div class="grid">
        ${stat('Sacado', usd(r.totalUsd), '', `${r.ws.length} ${r.ws.length === 1 ? 'saque' : 'saques'}`)}
        ${stat('Cotação média', net > 0 ? brlRate(r.total / net) : '—', '', `taxas: ${usd(WITHDRAW_FEE_USD * r.ws.length)}`)}
      </div>
      <table><thead><tr><th>Data</th><th>Sacado</th><th>Cotação</th><th>Recebido</th></tr></thead>
        <tbody>${r.ws.map(w => `<tr><td>${esc(shortDate(`${w.date}T12:00`))}</td><td>${esc(usd(w.amount_usd))}</td><td>${esc(brlRate(Number(w.rate_brl)).replace('R$ ', ''))}</td><td>${esc(brl(r.got(w)))}</td></tr>`).join('')}</tbody></table>
      <button class="btn primary" type="button" data-share-report>Compartilhar relatório</button>
    </section>`
}

function bindSaldo(view, { L }) {
  view.querySelectorAll('[data-wmonth]').forEach(b => b.addEventListener('click', () => {
    const r = reportData(state.data.withdrawals)
    state.wmonth = r.months[r.i + Number(b.dataset.wmonth)]
    renderRewards()
  }))
  view.querySelector('[data-share-report]')?.addEventListener('click', async () => {
    const { text, name } = reportData(state.data.withdrawals)
    try {
      if (navigator.share) return await navigator.share({ title: `Saques de ${name}`, text })
      await navigator.clipboard.writeText(text)
      toast('Relatório copiado')
    } catch (err) {
      if (err?.name !== 'AbortError') toast('Não foi possível compartilhar')
    }
  })
  view.querySelector('[data-open-prints]')?.addEventListener('click', openPrints)
  const form = view.querySelector('#w-form')
  const calc = () => {
    const amount = num(form.amount.value)
    const rate = num(form.rate.value)
    view.querySelector('#w-total').textContent = brl(Math.max(amount - WITHDRAW_FEE_USD, 0) * rate)
    const limit = Number(state.data.settings.daily_limit_usd)
    view.querySelector('#w-warn').textContent =
      amount && amount < 9 ? 'O saque mínimo é US$ 9.'
      : amount > limit ? `Seu limite é ${usd0(limit)} por dia.`
      : L.snap && amount > L.available + 0.005 ? `Mais do que o disponível (${usd(L.available)}).` : ''
  }
  form.addEventListener('input', calc)
  calc()
  form.addEventListener('submit', async ev => {
    ev.preventDefault()
    const amount = num(form.amount.value)
    const rate = num(form.rate.value)
    if (amount < 9) return toast('O saque mínimo é US$ 9.')
    if (!rate) return toast('Coloque o dólar do Payoneer.')
    const date = form.date.value || today()
    const { error } = await sb.from('withdrawals').insert({ amount_usd: amount, rate_brl: rate, date })
    if (error) return toast('Erro ao registrar: ' + error.message)
    state.wmonth = date.slice(0, 7)   // o relatório mostra o mês do saque que acabou de entrar
    toast('Saque registrado')
    renderRewards()
  })
  view.querySelectorAll('[data-withdrawal]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Excluir este saque?')) return
    const { error } = await sb.from('withdrawals').delete().eq('id', b.dataset.withdrawal)
    if (error) return toast('Erro ao excluir: ' + error.message)
    toast('Saque excluído')
    renderRewards()
  }))
}

function missoesPanel({ L, rate }) {
  const days = weekDays(L.current)
  const minutesByDay = Object.fromEntries(days.map(d => [d, 0]))
  for (const l of L.weekLives) if (l.date in minutesByDay) minutesByDay[l.date] += Number(l.duration_min) || 0
  const valid = days.filter(d => minutesByDay[d] >= 25).length
  const snapThisWeek = L.snap && (L.snap.week_start || '') === L.current ? L.snap : null
  const last = state.data.lives[0]
  const lp = last ? livePct(last.duration_min, last.new_followers) : 0
  const endLabel = new Date(`${days[6]}T12:00`).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' })
  return `
    <section class="hero">
      <div class="hero-head"><span>Semana de ${esc(shortDate(`${days[0]}T12:00`))} a ${esc(endLabel)}</span><i class="pill">${L.snap ? `${pct(L.upcoming.pct)} de 13%` : 'sem print'}</i></div>
      <strong>${L.snap ? esc(usd(L.upcoming.usd)) : '—'}</strong>
      <div class="usd">${L.snap ? `${esc(int(L.upcoming.gems))} diamantes · ${L.upcoming.fromPrint ? 'do print de domingo' : `estimativa com ${pct(L.upcoming.pct)} da última semana`}` : 'Mande o print de Upcoming rewards'}</div>
    </section>

    ${last ? `
    <div class="card">
      <h2>Última live · ${esc(shortDate(`${last.date}T12:00`))} · ${lp}%</h2>
      <div class="ladder">${[
        ['5 min ou mais', '30%', last.duration_min >= 5],
        ['10 min ou mais', '35%', last.duration_min >= 10],
        ['25 min ou mais', '38%', last.duration_min >= 25],
        [`5 novos seguidores (fez ${int(last.new_followers ?? 0)})`, '+2%', (last.new_followers ?? 0) >= 5],
      ].map(([what, p, done]) => `<div class="step ${done ? 'done' : ''}"><span class="dot">${done ? CHECK : ''}</span><span>${esc(what)}</span><b>${p}</b></div>`).join('')}</div>
      ${last.diamonds ? `<div class="row"><span>${esc(int(last.diamonds))} × US$ 0,01 × ${lp}%</span><b>${esc(usd(last.diamonds * 0.01 * lp / 100))}</b></div>` : ''}
    </div>` : ''}

    <div class="card">
      <h2>Missões da semana</h2>
      <div class="mission">
        <div class="row"><b>Dias válidos de live</b><em>+${daysPct(valid)}%</em></div>
        <div class="days">${days.map(d => `<i class="${minutesByDay[d] >= 25 ? 'on' : ''}" title="${d}">${minutesByDay[d] >= 25 ? CHECK : ''}</i>`).join('')}</div>
        <p class="muted small">Dia com 25 min ou mais de live, pelas lives registradas. 1 dia = 6%, 2 ou mais = 8%.</p>
      </div>
      <div class="mission">
        <div class="row"><b>Fãs ativos</b><em>${snapThisWeek?.fans_done ? 'concluída' : '—'}</em></div>
        <p class="muted small">10+ = 1%, 25+ = 1,5%, 100+ = 2%. Vem do print de domingo.</p>
      </div>
      <div class="mission">
        <div class="row"><b>Manter liga ${esc(L.snap?.league || 'A1')}</b><em>${snapThisWeek?.league_days != null ? '+1%' : '—'}</em></div>
        <div class="days pick-days">${[1, 2, 3, 4, 5, 6, 7].map(d => `<button type="button" data-mld="${d}" class="${d <= (snapThisWeek?.league_days ?? 0) ? 'on' : ''}" aria-label="${d} de 7 dias" ${snapThisWeek ? '' : 'disabled'}>${d <= (snapThisWeek?.league_days ?? 0) ? CHECK : ''}</button>`).join('')}</div>
        <p class="muted small">${snapThisWeek?.league_days != null ? `${snapThisWeek.league_days} de 7 dias. Toque numa bolinha para corrigir.` : snapThisWeek ? 'O print não trouxe os dias: toque na bolinha do último dia mantido.' : 'Atualiza com o print de domingo.'} Manter A1–A3 a semana toda = 1%, superar a melhor liga = 3%.</p>
      </div>
    </div>

    <div class="card">
      <h2>Simulador</h2>
      <label class="field" for="sim-gems"><span>Se a próxima live fizer quantos diamantes?</span><input id="sim-gems" type="number" inputmode="numeric" min="0" value="80000"></label>
      <div class="row"><span>Na live (40%)</span><b id="sim-live">US$ 0,00</b></div>
      <div class="row"><span>A mais no semanal</span><b id="sim-week">US$ 0,00</b></div>
      <div class="row"><span>Total em reais</span><b class="gold" id="sim-brl">${rate ? 'R$ 0,00' : '—'}</b></div>
    </div>`
}

function bindMissoes(view, { L, rate }) {
  view.querySelectorAll('[data-mld]').forEach(b => b.addEventListener('click', async () => {
    const d = Number(b.dataset.mld)
    const days = L.snap.league_days === d ? d - 1 : d
    const { error } = await sb.from('reward_snapshots').update({ league_days: days }).eq('id', L.snap.id)
    if (error) return toast('Erro ao salvar: ' + error.message)
    renderRewards()
  }))
  const sim = view.querySelector('#sim-gems')
  queueMicrotask(() => sim.dispatchEvent(new Event('input')))
  sim.addEventListener('input', ev => {
    const gems = Number(ev.target.value) || 0
    const live = gems * 0.01 * 0.4
    const week = gems * 0.01 * (L.upcoming?.pct || 0) / 100
    view.querySelector('#sim-live').textContent = usd(live)
    view.querySelector('#sim-week').textContent = usd(week)
    if (rate) view.querySelector('#sim-brl').textContent = '≈ ' + brl((live + week) * rate)
  })
}

function limitePanel() {
  const month = today().slice(0, 7)
  const earned = monthEarned(state.data, month)
  const { tier, next } = limitFor(earned)
  const current = Number(state.data.settings.daily_limit_usd)
  const nextName = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).toLocaleDateString('pt-BR', { month: 'long' })
  const progress = next ? (earned - tier[0]) / (next[0] - tier[0]) : 1
  return `
    <section class="hero">
      <div class="hero-head"><span>Limite de saque por dia</span><i class="pill">este mês</i></div>
      <strong>${esc(usd0(current))}</strong>
      <form class="inline-edit" id="lim-form">
        <input name="limit" type="number" inputmode="numeric" min="0" step="1" value="${current}" aria-label="Limite de saque deste mês">
        <button class="btn" type="submit">Corrigir</button>
      </form>
    </section>
    <div class="card">
      <div class="row"><span>Limite de ${esc(nextName)}</span><i class="pill ${tier[1] >= current ? 'ok' : 'down'}">${esc(usd0(tier[1]))} por dia</i></div>
      <div class="row"><span>Ganho neste mês (estimado)</span><b>${esc(usd(earned))}</b></div>
      <div class="bar"><i style="transform:scaleX(${Math.min(Math.max(progress, 0), 1)})"></i></div>
      <p class="muted small">${next ? `Faltam ${esc(usd(next[0] - earned))} este mês para o limite de ${esc(nextName)} subir para ${esc(usd0(next[1]))} por dia.` : 'Você está na faixa mais alta.'} Conta as recompensas das lives registradas e os semanais que já caíram.</p>
    </div>
    <div class="card">
      <h2>Tabela do TikTok</h2>
      <table>
        <thead><tr><th>Ganho no mês</th><th>Limite no mês seguinte</th></tr></thead>
        <tbody>${[...LIMIT_TIERS].reverse().map(([min, lim]) =>
          `<tr class="${min === tier[0] ? 'here' : next && min === next[0] ? 'next' : ''}"><td>${esc(usd0(min))}${min === tier[0] ? ' · você' : ''}</td><td>${esc(usd0(lim))}</td></tr>`).join('')}</tbody>
      </table>
    </div>`
}

function bindLimite(view) {
  view.querySelector('#lim-form').addEventListener('submit', async ev => {
    ev.preventDefault()
    const value = Number(ev.target.limit.value)
    if (!(value > 0)) return
    const { error } = await sb.from('settings').upsert({ daily_limit_usd: value }, { onConflict: 'user_id' })
    if (error) return toast('Erro ao salvar: ' + error.message)
    toast('Limite salvo')
    renderRewards()
  })
}

function regrasPanel() {
  const table = rows => `<table><tbody>${rows.map(([a, b, tone]) => `<tr><td>${a}</td><td${tone ? ` class="${tone}"` : ''}>${b}</td></tr>`).join('')}</tbody></table>`
  return `
    <div class="card">
      <h2>Como vira dinheiro</h2>
      <p>Cada diamante vale US$ 0,01 e você fica com a sua porcentagem. Com 40%, <b>250 diamantes = US$ 1</b>.</p>
      <p class="muted small">Ex.: 104.000 diamantes × US$ 0,01 × 40% = US$ 416,00</p>
    </div>
    <div class="card"><h2>Por live · até 40%</h2>${table([['Menos de 5 min', '20%'], ['5 min ou mais', '30%'], ['10 min ou mais', '35%'], ['25 min ou mais', '38%'], ['+ 5 novos seguidores', '+2%']])}</div>
    <div class="card"><h2>Por semana · até 13%</h2>${table([['1 dia válido (25 min+)', '6%'], ['2 dias válidos ou mais', '8%'], ['10+ fãs ativos', '1%'], ['25+ fãs ativos', '1,5%'], ['100+ fãs ativos', '2%'], ['Manter liga A1–A3', '1%'], ['Superar a melhor liga', '3%']])}
      <p class="muted small">A semana vai de segunda a domingo e vira na segunda à 1h. O semanal cai no saldo nessa hora.</p></div>
    <div class="card"><h2>Liga · fragmentos por dia (liga A)</h2>${table([['Top 1% no fechamento do dia', '+3', 'pos'], ['Top 10%', '+2', 'pos'], ['Top 20%', '+1', 'pos'], ['Top 60%', '0'], ['Abaixo disso ou sem live', '−1', 'neg']])}
      <p class="muted small">+4 fragmentos sobe de liga, −4 cai. Escudos bloqueiam uma perda cada, até 10. O Guardião pode forjar fragmentos (3 chances por semana) e mandar 1 escudo por semana. A posição muda o dia todo: vale a do fechamento.</p></div>
    <div class="card"><h2>Saque</h2>${table([['Taxa', 'US$ 3 por saque'], ['Mínimo', 'US$ 9'], ['Pix', 'até US$ 2.500 por saque'], ['Payoneer', 'até o limite diário']])}</div>`
}

// ---------- Prints ----------

// Domingo a partir das 18h, se ainda não chegou o print de Upcoming rewards do dia
function updateDue() {
  const now = new Date()
  const snap = state.data.snapshots?.[0]
  const sentToday = snap && new Date(snap.taken_at).toDateString() === now.toDateString()
  const due = now.getDay() === 0 && now.getHours() >= 18 && !sentToday
  const dot = document.querySelector('#prints .due')
  if (dot) dot.hidden = !due
  return due
}

function openPrints() {
  const due = updateDue()
  sheet.innerHTML = `
    <div class="sheet-body prints-sheet">
      <div class="sheet-head"><strong>Mandar prints</strong><button type="button" class="link" data-close>Fechar</button></div>
      ${due ? '<i class="pill">domingo: falta o semanal</i>' : ''}
      <label class="btn primary file-btn" for="prints-files">Escolher prints</label>
      <input id="prints-files" type="file" accept="image/*" multiple hidden>
      <p class="muted small">Pode escolher prints de tipos diferentes juntos: o app reconhece cada um sozinho.</p>
      <span class="muted small" id="prints-status" role="status"></span>
      <div id="prints-result"></div>
      <ol class="routine">
        <li><b>Depois de cada live</b><span>3 prints da análise da live: Viewership, Engagement e Rewards.</span><em>registra a live</em></li>
        <li><b>Domingo à noite</b><span>1 print: Content rewards → Upcoming rewards (a tela das missões).</span><em>atualiza saldo, semanal e liga</em></li>
        <li><b>Quando sacar</b><span>Sem print: Recompensas → Saldo → Registrar saque.</span><em>registra o saque</em></li>
      </ol>
    </div>`
  sheet.querySelector('[data-close]').addEventListener('click', closeSheet)
  const input = sheet.querySelector('#prints-files')
  const pick = sheet.querySelector('.file-btn')
  const status = sheet.querySelector('#prints-status')
  const result = sheet.querySelector('#prints-result')
  input.addEventListener('change', async () => {
    if (!input.files.length) return
    pick.classList.add('busy')
    result.innerHTML = ''
    try {
      const texts = await readEach([...input.files], msg => { status.textContent = msg })
      const weekly = texts.filter(isWeeklyPrint)
      const live = texts.filter(t => !isWeeklyPrint(t)).join('\n')
      const liveData = live.trim() ? parseTikTok(live) : {}
      const liveFields = Object.keys(liveData).length
      status.textContent = ''
      if (weekly.length) showWeekly(result, weekly)
      if (liveFields) {
        result.insertAdjacentHTML('beforeend', `
          <div class="card"><div class="row"><b>Live${liveData.date ? ` de ${esc(shortDate(`${liveData.date}T12:00`))}` : ''}</b><span class="muted">${liveFields} campos lidos</span></div>
          <button class="btn primary" type="button" data-open-live>Conferir e salvar a live</button></div>`)
        result.querySelector('[data-open-live]').addEventListener('click', () => {
          sheet.close()
          openForm('lives', null, live)
        })
      }
      if (!weekly.length && !liveFields) status.textContent = 'Não reconheci esses prints. Use os da análise da live ou o de Upcoming rewards.'
    } catch (err) {
      status.textContent = err.message || 'Não consegui ler os prints.'
    } finally {
      pick.classList.remove('busy')
      input.value = ''
    }
  })
  sheet.showModal()
  document.activeElement?.blur()
}

function showWeekly(result, texts) {
  // vários prints da mesma tela (rolada) se completam
  const data = Object.assign({}, ...texts.map(t => Object.fromEntries(Object.entries(parseWeekly(t)).filter(([, v]) => v != null))))
  data.week_start ??= weekStartOf()
  const rows = [
    ['Disponível para sacar', data.available_usd != null ? usd(data.available_usd) : null],
    ['A receber da semana', data.upcoming_usd != null ? usd(data.upcoming_usd) : null],
    ['Semana', shortDate(`${data.week_start}T12:00`) + ' a ' + shortDate(new Date(weekEndOf(data.week_start) - 2 * 3600e3))],
    ['Diamantes da semana', data.week_diamonds ? int(data.week_diamonds) : null],
    ['Porcentagem semanal', data.weekly_pct != null ? pct(data.weekly_pct) : null],
    ['Liga', data.league || null],
    ['Dias válidos', data.valid_days_done ? 'concluída' : null],
    ['Fãs ativos', data.fans_done ? 'concluída' : null],
  ].filter(([, v]) => v)
  result.insertAdjacentHTML('beforeend', `
    <div class="card"><b>Upcoming rewards</b>
      ${rows.map(([k, v]) => `<div class="row"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}
      <div class="row"><span>Dias mantidos na liga</span><b class="muted small">${data.league_days != null ? 'lido do print' : 'toque para marcar'}</b></div>
      <div class="days pick-days">${[1, 2, 3, 4, 5, 6, 7].map(d => `<button type="button" data-ld="${d}" aria-label="${d} de 7 dias"></button>`).join('')}</div>
      ${data.available_usd == null ? '<p class="muted small">Não achei o saldo disponível nesse print.</p>' : ''}
      <details class="raw-box"><summary class="muted small">Ver texto lido</summary><pre>${esc(texts.join('\n=====\n'))}</pre></details>
      <button class="btn primary" type="button" data-save-week ${data.available_usd == null ? 'disabled' : ''}>Salvar semana</button></div>`)
  // dias mantidos: vem da leitura, mas dá para corrigir tocando nas bolinhas
  const paint = () => result.querySelectorAll('[data-ld]').forEach(b => {
    const on = Number(b.dataset.ld) <= (data.league_days ?? 0)
    b.classList.toggle('on', on)
    b.innerHTML = on ? CHECK : ''
  })
  result.querySelectorAll('[data-ld]').forEach(b => b.addEventListener('click', () => {
    const d = Number(b.dataset.ld)
    data.league_days = data.league_days === d ? d - 1 : d
    paint()
  }))
  paint()
  result.querySelector('[data-save-week]').addEventListener('click', async ev => {
    ev.target.disabled = true
    const { error } = await sb.from('reward_snapshots').insert(data)
    if (error) {
      ev.target.disabled = false
      // o aviso comum fica atrás da janela aberta: mostra o erro dentro dela
      return result.insertAdjacentHTML('beforeend', `<p class="small neg">Não salvou: ${esc(error.message)}</p>`)
    }
    closeSheet()
    toast('Semana atualizada')
    if (state.tab === 'rewards') renderRewards()
    else updateDue()
  })
}

// ---------- Início da sessão ----------

let signedIn = null
sb.auth.onAuthStateChange((_event, session) => {
  const now = !!session
  if (now === signedIn) return
  signedIn = now
  state.data = {}
  now ? renderShell() : renderLogin()
})

// ---------- Atualização automática ----------

// O GitHub Pages deixa o iPhone guardar a página por 10 minutos. Ao abrir ou voltar para o app,
// pergunta ao servidor (sem cache) qual é a versão publicada e, se mudou, abre a nova na hora.
const VERSION = '__V__'   // trocado pelo commit na publicação

async function checkUpdate() {
  if (VERSION === '__' + 'V__') return   // rodando localmente, sem versão
  try {
    const html = await (await fetch(`./?check=${Date.now()}`, { cache: 'no-store' })).text()
    const latest = html.match(/app\.js\?v=(\w+)/)?.[1]
    if (latest && latest !== VERSION) {
      try { sessionStorage.setItem('updated', '1') } catch {}
      location.replace(`./?v=${latest}`)
    }
  } catch {
    // sem internet: segue com a versão atual
  }
}

checkUpdate()
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkUpdate() })
try {
  if (sessionStorage.getItem('updated')) { sessionStorage.removeItem('updated'); setTimeout(() => toast('App atualizado'), 600) }
} catch {}
