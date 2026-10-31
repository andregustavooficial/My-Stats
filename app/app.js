import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm'
import { parseTikTok, parseWeekly, isWeeklyPrint, isMonthPrint, parseMonth, fixMonth } from './tiktok.js?v=__V__'
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
ENTITIES.summaries = { table: 'month_summaries', order: ['month', false], optional: true }   // resumo do mês (migração 005)
ENTITIES.goals = { table: 'goals', order: ['month', false], optional: true }   // meta de diamantes do mês (migração 004)

// Ícones (traço) usados nas telas
const IC = {
  text: '<rect class="d" x="5" y="3" width="14" height="18" rx="4"/><rect x="5" y="3" width="14" height="18" rx="4"/><path d="M8.5 8h7M8.5 12h7M8.5 16h4"/>',
  copy: '<rect class="d" x="8" y="8" width="12" height="12" rx="4"/><rect x="8" y="8" width="12" height="12" rx="4"/><path d="M16 8V6.5A2.5 2.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.5v7A2.5 2.5 0 0 0 6.5 16H8"/>',
  target: '<circle class="d" cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>',
  pen: '<path class="d" d="M4 19v-2.5L15.5 5a2.1 2.1 0 0 1 3 3L7.5 20H5a1 1 0 0 1-1-1z"/><path d="M4 19v-2.5L15.5 5a2.1 2.1 0 0 1 3 3L7.5 20H5a1 1 0 0 1-1-1zM13.5 7l3 3"/>',
  home: '<path class="d" d="M5 10.5l5.6-4.6a2.2 2.2 0 0 1 2.8 0L19 10.5V19a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19z"/><path d="M3.5 11.7l7.1-5.8a2.2 2.2 0 0 1 2.8 0l7.1 5.8M5 10.5V19a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19v-8.5M10 20.5v-4.5a2 2 0 0 1 4 0v4.5"/>',
  live: '<rect class="d" x="9" y="3" width="6" height="11" rx="4.5"/><rect x="9" y="3" width="6" height="11" rx="4.5"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M9 21h6"/>',
  stats: '<rect x="4" y="12" width="4" height="8" rx="2"/><rect class="d" x="10" y="4" width="4" height="16" rx="2"/><rect x="10" y="4" width="4" height="16" rx="2"/><rect x="16" y="9" width="4" height="11" rx="2"/>',
  gem: '<path class="d" d="M7.6 4.5h8.8a1.5 1.5 0 0 1 1.2.6l2.7 3.5a1.2 1.2 0 0 1-.05 1.5l-7.1 8.6a1.5 1.5 0 0 1-2.3 0L3.75 10.1a1.2 1.2 0 0 1-.05-1.5l2.7-3.5a1.5 1.5 0 0 1 1.2-.6z"/><path d="M7.6 4.5h8.8a1.5 1.5 0 0 1 1.2.6l2.7 3.5a1.2 1.2 0 0 1-.05 1.5l-7.1 8.6a1.5 1.5 0 0 1-2.3 0L3.75 10.1a1.2 1.2 0 0 1-.05-1.5l2.7-3.5a1.5 1.5 0 0 1 1.2-.6zM3.6 9.3h16.8M10.3 4.5 8.7 9.3 12 18.6l3.3-9.3-1.6-4.8"/>',
  cam: '<path class="d" d="M4 8.5A2.5 2.5 0 0 1 6.5 6H8l1.5-2h5L16 6h1.5A2.5 2.5 0 0 1 20 8.5v9a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5z"/><path d="M4 8.5A2.5 2.5 0 0 1 6.5 6H8l1.5-2h5L16 6h1.5A2.5 2.5 0 0 1 20 8.5v9a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5z"/><circle cx="12" cy="13" r="3.5"/>',
  plus: '<path d="M12 5.5v13M5.5 12h13"/>',
  usd: '<circle class="d" cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="9"/><path d="M14.6 9.3c-.5-.8-1.4-1.3-2.6-1.3-1.5 0-2.6.8-2.6 1.9 0 2.7 5.2 1.3 5.2 4.2 0 1.1-1.1 1.9-2.6 1.9-1.2 0-2.2-.5-2.7-1.3M12 6.5V8M12 16v1.5"/>',
  clock: '<circle class="d" cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/>',
  user: '<circle class="d" cx="12" cy="8" r="4"/><circle cx="12" cy="8" r="4"/><path d="M4.5 20c1.2-3.6 4-5.5 7.5-5.5s6.3 1.9 7.5 5.5"/>',
  eye: '<path class="d" d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  heart: '<path class="d" d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7a4.3 4.3 0 0 1 7.5 2.8C19.5 15.4 12 20 12 20z"/><path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7a4.3 4.3 0 0 1 7.5 2.8C19.5 15.4 12 20 12 20z"/>',
  flame: '<path class="d" d="M12 21c-3.9 0-6.5-2.7-6.5-6.2 0-3.9 3.3-5.8 4.3-9.8 2.4 1.6 3.2 3.9 3.2 3.9s1.1-1 1.5-2.6c2.3 1.9 4 4.7 4 8.5 0 3.5-2.6 6.2-6.5 6.2z"/><path d="M12 21c-3.9 0-6.5-2.7-6.5-6.2 0-3.9 3.3-5.8 4.3-9.8 2.4 1.6 3.2 3.9 3.2 3.9s1.1-1 1.5-2.6c2.3 1.9 4 4.7 4 8.5 0 3.5-2.6 6.2-6.5 6.2zM12 21c-1.6 0-2.7-1.1-2.7-2.6 0-1.7 1.5-2.5 2.7-4.1 1.2 1.6 2.7 2.4 2.7 4.1 0 1.5-1.1 2.6-2.7 2.6z"/>',
  trophy: '<path class="d" d="M8.5 4h7a1 1 0 0 1 1 1v4.5a4.5 4.5 0 0 1-9 0V5a1 1 0 0 1 1-1z"/><path d="M8.5 4h7a1 1 0 0 1 1 1v4.5a4.5 4.5 0 0 1-9 0V5a1 1 0 0 1 1-1zM7.5 6H5.5a2.5 2.5 0 0 0 2.4 3.6M16.5 6h2a2.5 2.5 0 0 1-2.4 3.6M12 14v3M10 17h4a1 1 0 0 1 1 .9l.3 1.6a.8.8 0 0 1-.8 1H9.5a.8.8 0 0 1-.8-1l.3-1.6a1 1 0 0 1 1-.9z"/>',
  cal: '<rect class="d" x="3.5" y="5" width="17" height="15.5" rx="4.5"/><rect x="3.5" y="5" width="17" height="15.5" rx="4.5"/><path d="M3.5 10h17M8 3v4M16 3v4M8 14h.01M12 14h.01M16 14h.01"/>',
  shield: '<path class="d" d="M11.3 3.8a2 2 0 0 1 1.4 0L18 5.7a1.5 1.5 0 0 1 1 1.4v4.4c0 4.6-3 7.9-7 9-4-1.1-7-4.4-7-9V6z"/><path d="M11.3 3.8a2 2 0 0 1 1.4 0L18 5.7a1.5 1.5 0 0 1 1 1.4v4.4c0 4.6-3 7.9-7 9-4-1.1-7-4.4-7-9V6zM9 12l2 2 4-4"/>',
  chev: '<path d="M9.5 6l6 6-6 6"/>',
  back: '<path d="M14.5 6 8.5 12l6 6"/>',
  bank: '<rect class="d" x="3" y="6.5" width="18" height="13.5" rx="4.5"/><rect x="3" y="6.5" width="18" height="13.5" rx="4.5"/><path d="M6.5 6.5V6a2 2 0 0 1 2.4-2l8.6 1.6M21 11.5h-3.5a1.75 1.75 0 0 0 0 3.5H21"/>',
}
const NOTE = '<rect x="2.5" y="6" width="19" height="12" rx="3.5"/><circle cx="12" cy="12" r="2.6"/><path d="M6.2 9.6h.01M17.8 14.4h.01"/>'
const ic = k => `<svg viewBox="0 0 24 24">${IC[k]}</svg>`

const TABS = [
  { id: 'home', label: 'Início', icon: 'home' },
  { id: 'lives', label: 'Lives', icon: 'live' },
  { id: 'stats', label: 'Estatísticas', icon: 'stats' },
  { id: 'rewards', label: 'Recompensas', icon: 'gem' },
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
  // com uma janela aberta, o aviso precisa estar dentro dela para aparecer por cima
  ;(sheet.open && !sheet.classList.contains('closing') ? sheet : document.body).append(toastEl)
  toastEl.textContent = msg
  toastEl.classList.add('show')
  clearTimeout(toast.t)
  toast.t = setTimeout(() => toastEl.classList.remove('show'), 2600)
}

async function load(name) {
  const e = ENTITIES[name]
  const { data, error } = await sb.from(e.table).select('*').order(e.order[0], { ascending: e.order[1] })
  if (error) {
    // tabela opcional ainda não criada no banco (ex.: metas antes da migração 004): segue sem ela
    if (e.optional) return (state.data[name] = state.data[name] || [])
    toast('Erro ao carregar: ' + error.message); return state.data[name] || []
  }
  // títulos de lives sempre em maiúsculas, inclusive os salvos antes dessa regra
  if (name === 'lives') for (const l of data) if (l.title) l.title = l.title.toLocaleUpperCase('pt-BR')
  return (state.data[name] = data)
}

// ---------- Login ----------

function renderLogin() {
  app.innerHTML = `
    <main class="login">
      <h1>My <span>Stats</span></h1>
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
    <header class="top"><div><small id="kicker"></small><h1 id="title"></h1></div>
      <div class="top-actions">
        <button id="prints" class="ibtn" aria-label="Mandar prints">${ic('cam')}<span>Prints</span><i class="due" hidden></i></button>
      </div></header>
    <main id="view"></main>
    <nav class="tabs">${TABS.map(t => `
      <button data-tab="${t.id}" aria-label="${t.label}">${ic(t.icon)}<span>${t.label}</span></button>`).join('')}
    </nav>`
  app.querySelector('.tabs').addEventListener('click', ev => {
    const b = ev.target.closest('button[data-tab]')
    if (b) go(b.dataset.tab)
  })
  document.getElementById('prints').addEventListener('click', openPrints)
  go(state.tab)
}

// Puxar pra atualizar: no topo da tela, arrastar pra baixo mostra um diamante girando e busca os dados de novo
{
  const ptr = document.createElement('div'); ptr.className = 'ptr'
  let y0 = null, dy = 0, busy = false
  const set = d => { ptr.style.opacity = Math.min(d / 70, 1); ptr.style.transform = `translateY(${Math.min(d * 0.5, 50)}px) scale(${0.6 + Math.min(d / 200, 0.4)}) rotate(${d * 3}deg)` }
  addEventListener('touchstart', e => { if (scrollY <= 0 && !sheet.open && !busy && signedIn) { y0 = e.touches[0].clientY; dy = 0 } }, { passive: true })
  addEventListener('touchmove', e => {
    if (y0 == null) return
    dy = Math.max(0, e.touches[0].clientY - y0)
    if (dy > 6) { if (!ptr.isConnected) { ptr.innerHTML = ic('gem'); document.body.append(ptr) } set(dy) }
  }, { passive: true })
  addEventListener('touchend', async () => {
    if (y0 == null) return
    y0 = null
    if (!ptr.isConnected) return
    ptr.style.transition = 'transform .35s var(--ease), opacity .35s'
    if (dy > 90) {
      busy = true; set(90); ptr.classList.add('spin')
      await Promise.all([reload(), new Promise(r => setTimeout(r, 700))])
      ptr.classList.remove('spin'); busy = false
    }
    set(0)
    setTimeout(() => { ptr.style.transition = ''; if (!busy) ptr.remove() }, 380)
  })
}

// Parallax dos doodles do fundo: só mexe enquanto rola, e fica parado com "Reduzir movimento"
{
  const still = matchMedia('(prefers-reduced-motion: reduce)')
  let ticking = false
  addEventListener('scroll', () => {
    if (still.matches || ticking) return
    ticking = true
    requestAnimationFrame(() => {
      const y = scrollY
      document.body.style.setProperty('--dx', `${(-y * 0.18) % 180}px`)
      document.body.style.setProperty('--dy', `${(-y * 0.07) % 180}px`)
      ticking = false
    })
  }, { passive: true })
}

// O que cada aba precisa do banco
const NEEDS = { home: ['lives', 'withdrawals', 'goals'], lives: ['lives', 'summaries'], stats: ['lives', 'withdrawals', 'summaries'], rewards: ['lives', 'withdrawals', 'snapshots', 'summaries'] }
const DRAW = { home: a => renderHome(a), lives: a => renderLives(a), stats: a => renderStats(a), rewards: a => renderRewards(a) }

async function fetchFor(tab) {
  const sig = () => JSON.stringify([...NEEDS[tab].map(n => state.data[n]), state.data.settings, state.rate?.commercial])
  const before = sig()
  await Promise.all([...NEEDS[tab].map(load), tab === 'rewards' && loadSettings(), tab !== 'lives' && freshRate()])
  return sig() !== before
}

// Busca de novo e redesenha só se algo mudou, sem animação (depois de salvar, ao voltar para o app)
async function reload(tab = state.tab) {
  if (!DRAW[tab]) return
  if (await fetchFor(tab) && state.tab === tab) DRAW[tab](false)
}

const TAB_ORDER = ['home', 'lives', 'stats', 'rewards']
function go(tab) {
  const from = TAB_ORDER.indexOf(state.tab), to = TAB_ORDER.indexOf(tab)
  const v = document.getElementById('view')
  v.classList.remove('slide-l', 'slide-r')
  if (from !== to) { void v.offsetWidth; v.classList.add(to > from ? 'slide-r' : 'slide-l') }
  state.tab = tab
  app.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab))
  document.getElementById('title').textContent = { home: 'E aí, Galli!', rewards: 'Recompensas', stats: 'Estatísticas' }[tab] ?? ENTITIES[tab].title
  const kicker = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })
  document.getElementById('kicker').textContent = tab === 'home' ? kicker[0].toUpperCase() + kicker.slice(1).replace('-feira', '') : ''
  window.scrollTo(0, 0)
  if (!DRAW[tab]) return renderList(tab)
  // Com dados na memória, desenha na hora (sem "Carregando…") e atualiza por trás
  const cached = NEEDS[tab].every(n => state.data[n]) && (tab !== 'rewards' || state.data.settings)
  if (cached) DRAW[tab](true)
  else document.getElementById('view').innerHTML = '<p class="muted center">Carregando…</p>'
  fetchFor(tab).then(changed => { if (state.tab === tab && (changed || !cached)) DRAW[tab](!cached) })
}

// ---------- Peças de tela ----------

const sumOf = (rows, k) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0)
const avgOf = (rows, k) => { const v = rows.map(r => Number(r[k])).filter(n => n > 0); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0 }
const brl0 = v => 'R$ ' + new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(Math.round(Number(v) || 0))
const dec = (v, d = 1) => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: d, minimumFractionDigits: d }).format(v)
// 1.963.400 → "1,96 mi"; 536.600 → "537 mil"
const compact = v => (v >= 1e6 ? `${dec(v / 1e6, 2)} mi` : v >= 1e4 ? `${int(Math.round(v / 1e3))} mil` : int(Math.round(v)))
const ymOf = d => d.toLocaleDateString('sv-SE').slice(0, 7)
const prevYm = ym => { const [y, m] = ym.split('-').map(Number); return ymOf(new Date(y, m - 2, 15)) }
const monthWord = ym => new Date(`${ym}-15T12:00`).toLocaleDateString('pt-BR', { month: 'long' })
const cap = t => t ? t[0].toUpperCase() + t.slice(1) : t
const weekday = d => new Date(`${d}T12:00`).toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '')

// "↑ 12%" contra o valor de antes (vazio quando não há com o que comparar)
function delta(cur, before) {
  if (!before || cur == null) return ''
  const p = (cur - before) / before * 100
  return `<em class="${p >= 0 ? 'up' : 'down'}">${p >= 0 ? '↑' : '↓'} ${int(Math.round(Math.abs(p)))}%</em>`
}

// chuva de diamantes (ou notinhas) caindo dentro do card principal
const RAIN = [[6, 34, 14, 0], [22, 24, 11, -6], [38, 38, 17, -3], [54, 28, 12, -9], [70, 32, 15, -1], [86, 26, 10, -5], [14, 30, 16, -11], [62, 22, 13, -8], [94, 34, 18, -13], [46, 26, 12, -14]]
const rain = shape => `<div class="floaters" aria-hidden="true">${RAIN.map(([x, sz, d, dl]) => `<svg viewBox="0 0 24 24" style="left:${x}%;width:${sz}px;height:${sz}px;animation-duration:${d}s;animation-delay:${dl}s">${shape}</svg>`).join('')}</div>`
const GEM_LINE = () => IC.gem.replace(/<path class="d"[^>]*\/>/, '')

// seletores com "polegar" que desliza: --n opções, --i a escolhida
const slideTo = (el, i) => { if (el) requestAnimationFrame(() => requestAnimationFrame(() => el.style.setProperty('--i', i))) }

const sec = (title, body, side = '') => `<section class="sec"><div class="sec-h"><h2>${title}</h2>${side}</div>${body}</section>`

const ring = (pct, big, label) => `<div class="ring"><svg viewBox="0 0 84 84"><circle class="bg" cx="42" cy="42" r="36"/><circle ${pct > 0.5 ? '' : 'hidden '}class="fg" cx="42" cy="42" r="36" pathLength="100" stroke-dasharray="${Math.min(Math.max(pct, 0), 100).toFixed(1)} 100"/></svg><div><b>${big}</b><span>${label}</span></div></div>`

// parte do card dividido (nome com ícone, número, comparação e uma linha de apoio)
const qcell = (icon, label, value, extra = '', rate = '', money = false) =>
  `<div class="q ${money ? 'money' : ''}"><small>${ic(icon)}${esc(label)}</small><span class="vr"><b>${esc(value)}</b>${extra}</span>${rate ? `<i class="rate">${esc(rate)}</i>` : ''}</div>`

function monthPicker(ym, sub, attr, i, n) {
  const [m, y] = new Date(`${ym}-15T12:00`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }).split(' de ')
  return `
    <div class="month">
      <button type="button" ${attr}="-1" aria-label="Mês anterior" ${i === 0 ? 'disabled' : ''}>${ic('back')}</button>
      <div><b>${esc(cap(m))} <em>${esc(y)}</em></b><span>${esc(sub)}</span></div>
      <button type="button" ${attr}="1" aria-label="Próximo mês" ${i === n - 1 ? 'disabled' : ''}>${ic('chev')}</button>
    </div>`
}

// linha de live: data no quadradinho, duração e valor, barrinha contra a melhor do mês
function lvRow(l, max, bestId) {
  const sub = [l.duration_min && `${hours(l.duration_min)} ao vivo`, l.rewards_usd != null && usd(l.rewards_usd)].filter(Boolean).join(' · ')
  return `<button class="lv" data-edit="lives" data-id="${l.id}">
    <span class="dt"><b>${esc(l.date.slice(8))}</b><small>${esc(weekday(l.date))}</small></span>
    <div class="t"><b>${l.id === bestId ? `<i class="crown">${ic('trophy')}</i>` : ''}${esc(l.title || fmtDate(l.date))}</b><span>${esc(sub)}</span><i class="lb"><i style="transform:scaleX(${((Number(l.diamonds) || 0) / (max || 1)).toFixed(3)})"></i></i></div>
    <b class="g">${l.diamonds != null ? esc(int(l.diamonds)) : '—'}</b>
  </button>`
}

// ---------- Início ----------

function renderHome(animate) {
  const view = document.getElementById('view')
  const { lives, withdrawals } = state.data
  const goals = state.data.goals || []

  const ym = today().slice(0, 7)
  const pym = prevYm(ym)
  const day = new Date().getDate()
  const ml = lives.filter(l => l.date?.startsWith(ym))
  const pAll = lives.filter(l => l.date?.startsWith(pym))
  const pSame = pAll.filter(l => +l.date.slice(8) <= day)   // mês passado até o mesmo dia
  const saques = withdrawals.filter(w => w.date?.startsWith(ym)).length

  const gems = sumOf(ml, 'diamonds')
  const mins = sumOf(ml, 'duration_min')
  const rewards = sumOf(ml, 'rewards_usd')
  const net = Math.max(rewards - saques * WITHDRAW_FEE_USD, 0)
  const commercial = state.rate?.commercial
  const payout = payoutRate(withdrawals, commercial)
  const rate = payout?.rate ?? null
  const life = lifetime(lives)
  const pName = monthWord(pym)

  // meta do mês: o anel mostra a meta; sem meta, compara com o mês passado inteiro
  const goal = goals.find(g => g.month === ym)
  const pGems = sumOf(pAll, 'diamonds')
  const ringHtml = goal ? ring(gems / goal.diamonds * 100, `${int(Math.round(gems / goal.diamonds * 100))}%`, 'da meta')
    : pGems ? ring(gems / pGems * 100, `${int(Math.round(gems / pGems * 100))}%`, `de ${esc(pName)}`) : ''
  const nDays = new Date(+ym.slice(0, 4), +ym.slice(5), 0).getDate()
  const left = goal ? goal.diamonds - gems : 0
  const daysLeft = nDays - day + 1
  const goalHtml = goal ? `
      <div class="goal">
        <div class="gh"><span>${ic('target')}Meta de ${esc(monthWord(ym))}</span><button type="button" data-goal aria-label="Editar meta"><b>${esc(int(goal.diamonds))}</b>${ic('pen')}</button></div>
        <div class="gf">${left > 0
          ? `<span>Faltam <b>${esc(int(left))}</b> · ${daysLeft} ${daysLeft === 1 ? 'dia' : 'dias'}</span><span><b>${esc(compact(left / daysLeft))}</b> por dia</span>`
          : `<span>Meta batida! <b>+${esc(int(-left))}</b></span>`}</div>
      </div>` : `
      <div class="goal"><div class="gh"><span>${ic('target')}Meta de ${esc(monthWord(ym))}</span><button type="button" data-goal><b style="font-family:inherit;font-size:13px">Definir meta</b>${ic('pen')}</button></div></div>`

  const sameGems = sumOf(pSame, 'diamonds')
  const vs = sameGems ? (() => { const p = (gems - sameGems) / sameGems * 100; return `<em>${p >= 0 ? '↑' : '↓'} ${int(Math.round(Math.abs(p)))}% vs. ${esc(pName)}</em>` })() : ''
  const last = withdrawals[0]
  const diff = last && commercial ? commercial - Number(last.rate_brl) : null
  const perLive = ml.length ? rewards / ml.length : 0
  const pPerLive = pAll.length ? sumOf(pAll, 'rewards_usd') / pAll.length : 0
  const bestId = [...ml].sort((a, b) => (b.diamonds || 0) - (a.diamonds || 0))[0]?.id
  const recent = lives.slice(0, 3)
  const max = Math.max(...ml.map(l => Number(l.diamonds) || 0), ...recent.map(l => Number(l.diamonds) || 0), 1)

  view.innerHTML = `
    <div class="feature hero">${rain(GEM_LINE())}
      <div class="k"><i>${ic('gem')}</i>Diamantes de ${esc(monthWord(ym))}${vs}</div>
      <div class="ringrow"><div><div class="big num" data-count>${esc(int(gems))}</div><div class="sub">${ml.length ? `${esc(int(Math.round(gems / ml.length)))} por live${mins ? ` · ${esc(int(Math.round(gems / (mins / 60))))} por hora` : ''}` : 'Nenhuma live registrada no mês'}</div></div>${ringHtml}</div>
      <div class="kpis"><div><span>Saldo do mês</span><b>${rate ? esc(brl0(net * rate)) : esc(usd(net))}</b></div><div><span>Lives</span><b>${ml.length}</b></div><div><span>Ao vivo</span><b>${esc(hours(mins))}</b></div></div>
      ${goalHtml}
    </div>
    <div class="life"><span class="lg">${ic('trophy')}</span><div><small>Diamantes desde nov/2023</small><b>${esc(int(life.diamonds))}</b><em>≈ ${esc(usd0(Math.round(life.usd)))}</em></div></div>
    <div class="fxp">
      <div><small>${ic('usd')}${payout?.source === 'saque' ? 'Último saque' : 'Dólar estimado'}</small><b>${rate ? esc(brlRate(rate)) : '—'}</b><em>${last ? `${esc(shortDate(`${last.date}T12:00`))} · ${esc(METHOD[last.method] || 'Payoneer')}` : 'comercial − R$ 0,18'}</em></div>
      <div><small>Comercial hoje${state.rate?.source === 'Banco Central' ? ' (BC)' : ''}</small><b>${commercial ? esc(brlRate(commercial)) : '—'}</b><em>${diff != null ? `${diff >= 0 ? '−' : '+'}R$ ${esc(dec(Math.abs(diff), 2))} no saque` : commercial ? '' : 'sem conexão'}</em></div>
    </div>
    ${sec('Este mês', `<div class="quad">
      ${qcell('user', 'Seguidores', '+' + int(sumOf(ml, 'new_followers')), delta(sumOf(ml, 'new_followers'), sumOf(pSame, 'new_followers')))}
      ${qcell('usd', 'Por live', rate ? brl0(perLive * rate) : usd(perLive), delta(perLive, pPerLive), '', true)}
      ${qcell('eye', 'Pico médio', int(Math.round(avgOf(ml, 'peak_viewers'))), delta(avgOf(ml, 'peak_viewers'), avgOf(pAll, 'peak_viewers')))}
      ${qcell('heart', 'Curtidas', compact(sumOf(ml, 'likes')), delta(sumOf(ml, 'likes'), sumOf(pSame, 'likes')))}
    </div>`, pAll.length ? `<span>vs. ${esc(pName)}</span>` : '')}
    ${sec('Últimas lives', lives.length ? `<div class="group">${recent.map(l => lvRow(l, max, bestId)).join('')}</div>` : empty('Nenhuma live registrada.', 'lives'), '<button type="button" data-go-lives>Ver todas</button>')}
    <button id="logout" class="btn ghost">Sair</button>`
  bindList(view)
  if (animate) reveal(view)
  view.querySelector('[data-goal]').addEventListener('click', () => openGoal(ym))
  if (goal && gems >= goal.diamonds) {
    setTimeout(() => celebrate(goal.diamonds, ym), animate ? 900 : 0)
    view.querySelector('.ring')?.addEventListener('click', () => celebrate(goal.diamonds, ym, true))
  }
  view.querySelector('[data-go-lives]').addEventListener('click', () => go('lives'))
  document.getElementById('logout').addEventListener('click', () => sb.auth.signOut())
}

// Meta de diamantes do mês: definir, mudar e ver as dos meses anteriores
function openGoal(ym) {
  const goals = state.data.goals || []
  const cur = goals.find(g => g.month === ym)
  const done = m => sumOf(state.data.lives.filter(l => l.date?.startsWith(m)), 'diamonds')
  const past = goals.filter(g => g.month !== ym).slice(0, 6)
  sheet.innerHTML = `
    <form method="dialog" class="sheet-body">
      <div class="sheet-head"><button type="button" class="link" data-close>Cancelar</button><strong>Meta de ${esc(monthWord(ym))}</strong><button type="submit" class="link strong">Salvar</button></div>
      <div class="fields"><label class="field" for="goal-v"><span>Diamantes no mês</span><input id="goal-v" name="v" type="text" inputmode="numeric" placeholder="2.500.000" value="${cur ? esc(int(cur.diamonds)) : ''}" required></label></div>
      ${past.length ? `<div class="card"><h3>Metas anteriores</h3>${past.map(g => { const d = done(g.month); return `<div class="row"><span>${esc(cap(monthWord(g.month)))} ${g.month.slice(0, 4)}</span><b class="${d >= g.diamonds ? 'up' : 'down'}">${esc(compact(d))} de ${esc(compact(g.diamonds))}</b></div>` }).join('')}</div>` : ''}
      ${cur ? '<button type="button" class="btn danger" data-delete>Tirar a meta</button>' : ''}
    </form>`
  const form = sheet.querySelector('form')
  sheet.querySelector('[data-close]').addEventListener('click', () => closeSheet())
  sheet.querySelector('[data-delete]')?.addEventListener('click', async () => {
    const { error } = await sb.from('goals').delete().eq('month', ym)
    if (error) return toast('Erro ao tirar: ' + error.message)
    closeSheet(); toast('Meta removida'); reload()
  })
  form.addEventListener('submit', async ev => {
    ev.preventDefault()
    const diamonds = parseInt(form.v.value.replace(/\D/g, ''), 10)
    if (!(diamonds > 0)) return toast('Coloque quantos diamantes')
    const save = form.querySelector('[type=submit]')
    if (save.disabled) return
    save.disabled = true
    const { error } = await sb.from('goals').upsert({ month: ym, diamonds }, { onConflict: 'user_id,month' })
    if (error) { save.disabled = false; return toast(/goals/.test(error.message) ? 'Falta criar a tabela de metas no Supabase (migração 004).' : 'Erro ao salvar: ' + error.message) }
    closeSheet(650); toast('Meta salva'); reload()
  })
  sheet.showModal()
  document.activeElement?.blur()
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
  const cells = Array.from({ length: 14 }, (_, i) => {
    const x = new Date(); x.setDate(x.getDate() - 13 + i)
    const letter = x.toLocaleDateString('pt-BR', { weekday: 'narrow' }).toUpperCase()
    return `<span class="${days.has(ymd(x)) ? 'on' : ''} ${i === 13 ? 'today' : ''}"><i></i>${letter}</span>`
  }).join('')
  const sub = streak >= best ? 'seguidos com live · é o seu recorde!' : `seguidos com live · faltam ${best - streak} pro recorde`
  return `
    <div class="feature">
      <div class="k"><i class="cop flare">${ic('flame')}</i>Sequência<em>maior: ${best} ${best === 1 ? 'dia' : 'dias'}</em></div>
      <div class="big" style="font-size:30px">${streak} ${streak === 1 ? 'dia' : 'dias'}</div>
      <div class="sub">${sub}${liveToday ? '' : ' · hoje ainda não teve live'}</div>
      <div class="streak">${cells}</div>
    </div>`
}

// Projeção (mês atual) ou como o mês fechou (meses passados)
function projCard(ml, rate, ym, current, nLives) {
  const gems = sumOf(ml, 'diamonds')
  if (!gems) return ''
  const now = new Date()
  const [y, m] = ym.split('-').map(Number)
  const nDays = new Date(y, m, 0).getDate()
  const total = current ? gems / now.getDate() * nDays : gems
  const totalUsd = total * 0.01 * 0.51
  const next = monthWord(ymOf(new Date(y, m, 15))).slice(0, 3)
  return sec(current ? 'Projeção' : 'Fechamento', `
    <div class="proj">
      <div class="pc"><small>${esc(cap(monthWord(ym)))} ${current ? 'deve fechar com' : 'fechou com'}</small><b>${esc(compact(total))}</b><span>${current ? `no ritmo de hoje · dia ${now.getDate()} de ${nDays}` : `${nLives != null ? `${nLives} ${nLives === 1 ? 'live' : 'lives'} · ` : 'resumo do TikTok · '}${esc(int(gems))} diamantes`}</span></div>
      <div class="pk"><div><span>Em dólares</span><b>${esc(usd0(Math.round(totalUsd)))}</b></div><div><span>Em reais</span><b>${rate ? esc(brl0(totalUsd * rate)) : '—'}</b></div><div><span>Limite em ${esc(next)}.</span><b>${esc(compactUsd(limitFor(totalUsd).tier[1]))}</b></div></div>
    </div>`)
}
const compactUsd = v => (v >= 1000 && v % 1000 === 0 ? `US$ ${int(v / 1000)} mil` : usd0(v))

const brlRate = r => 'R$ ' + new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 }).format(r)

async function freshRate() {
  if (state.rate && Date.now() - (state.rateFetched || 0) < 30 * 60e3) return
  await loadRate()
  state.rateFetched = Date.now()
}

// ---------- Animação ao rolar ----------

const revealer = new IntersectionObserver(entries => {
  // os que entram juntos na tela aparecem em cascata, de cima pra baixo
  let k = 0
  for (const e of entries.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)) {
    if (!e.isIntersecting) continue
    e.target.style.transitionDelay = `${Math.min(k++, 6) * 70}ms`
    e.target.classList.add('in')
    revealer.unobserve(e.target)
  }
}, { rootMargin: '0px 0px -8% 0px' })

const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches

// contador subindo do zero até o valor (só na primeira vez que a tela aparece)
function countUp(el) {
  const txt = el.textContent, target = Number(txt.replace(/\D/g, ''))
  if (!target || still() || /,\d{2}$/.test(txt)) return
  const pre = txt.match(/^\D*/)[0], t0 = performance.now(), dur = 900
  const step = t => {
    const p = Math.min((t - t0) / dur, 1)
    el.textContent = p < 1 ? pre + int(Math.round(target * (1 - (1 - p) ** 3))) : txt
    if (p < 1) requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}

// meta batida: chuva de diamantes com o fundo desfocado (uma vez por mês)
function celebrate(goal, ym, again = false) {
  const key = `goal-party-${ym}`
  if (!again) try { if (localStorage.getItem(key)) return; localStorage.setItem(key, '1') } catch {}
  if (document.querySelector('.toastx')) return
  if (still()) return toast('Meta batida! 💎')
  const bl = document.createElement('div'); bl.className = 'blurbg'
  const box = document.createElement('div'); box.className = 'party'
  // primeiro uma explosão saindo do meio, depois a chuva
  const burst = Array.from({ length: 16 }, (_, i) => {
    const a = i / 16 * Math.PI * 2, r = 130 + Math.random() * 90, sz = 16 + Math.random() * 16
    return `<svg class="burst" viewBox="0 0 24 24" style="width:${sz}px;height:${sz}px;--bx:${Math.cos(a) * r}px;--by:${Math.sin(a) * r}px;--r:${(Math.random() - 0.5) * 540}deg">${IC.gem}</svg>`
  }).join('')
  box.innerHTML = burst + Array.from({ length: 34 }, () => {
    const sz = 14 + Math.random() * 22
    return `<svg viewBox="0 0 24 24" style="left:${Math.random() * 100}%;width:${sz}px;height:${sz}px;--dx:${(Math.random() - 0.5) * 120}px;--r:${(Math.random() - 0.5) * 720}deg;animation-duration:${2.2 + Math.random() * 1.8}s;animation-delay:${0.35 + Math.random() * 1.2}s">${IC.gem}</svg>`
  }).join('')
  const t = document.createElement('div'); t.className = 'toastx'
  t.innerHTML = `<i class="tg">${IC.trophy ? `<svg viewBox="0 0 24 24">${IC.trophy}</svg>` : ''}</i><b>Meta batida!</b><span>${esc(int(goal))} diamantes em ${esc(monthWord(ym))}</span><small>toque pra fechar</small>`
  document.body.append(bl, box, t)
  let done = false
  const close = () => {
    if (done) return; done = true
    t.classList.add('bye'); bl.classList.add('off'); box.classList.add('off')
    setTimeout(() => { bl.remove(); box.remove(); t.remove() }, 450)
  }
  bl.addEventListener('click', close); t.addEventListener('click', close)
  setTimeout(close, 4500)
}

function reveal(root) {
  root.querySelectorAll('[data-count]').forEach(countUp)
  root.querySelectorAll('.lv .crown, .rec.new .rt svg').forEach(x => x.classList.add('wiggle'))
  root.querySelectorAll('.feature, .life, .fxp, .sec, .month, .seg, .best, .chartcard, .card, .form, .proj, .ret, .rec, .quad, .empty').forEach(el => {
    el.classList.add('reveal')
    revealer.observe(el)
  })
}

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
    const thousands = !s.includes(',') && /^\d{1,3}(\.\d{3})+$/.test(s)   // "1.500" = mil e quinhentos
    const n = Number(s.includes(',') || thousands ? s.replace(/\./g, '').replace(',', '.') : s)
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
    closeSheet(); toast('Excluído'); reload()
  })
  form.addEventListener('submit', async ev => {
    ev.preventDefault()
    let values
    try {
      const fd = new FormData(form)
      values = Object.fromEntries(e.fields.map(f => [f.key, parse(f, fd.get(f.key))]))
    } catch (err) { return toast(err.message) }
    // trava o botão: dois toques rápidos em "Salvar" criavam a live duas vezes
    const save = form.querySelector('[type=submit]')
    if (save.disabled) return
    save.disabled = true
    const q = editing ? sb.from(e.table).update(values).eq('id', row.id) : sb.from(e.table).insert(values)
    const { error } = await q
    if (error) { save.disabled = false; return toast('Erro ao salvar: ' + error.message) }
    closeSheet(650); toast('Salvo'); reload()
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

// botão vira um check desenhando (o formulário fecha logo depois)
function checkmark(btn) {
  if (!btn || still()) return
  btn.style.minWidth = btn.offsetWidth + 'px'
  btn.classList.add('saved')
  btn.innerHTML = '<svg class="ok" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>'
}

function closeSheet(delay = 0) {
  if (delay && !still()) { checkmark(sheet.querySelector('[type=submit]')); return setTimeout(() => closeSheet(), delay) }
  sheet.classList.add('closing')
  setTimeout(() => { sheet.close(); sheet.classList.remove('closing') }, still() ? 0 : 280)
}
sheet.addEventListener('click', ev => { if (ev.target === sheet) closeSheet() })
sheet.addEventListener('cancel', ev => { ev.preventDefault(); closeSheet() })

// ---------- Lives: mês a mês ----------

const shortDay = d => new Date(`${d}T12:00`).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' })

// Totais do mês. Num mês que já fechou e tem o resumo do TikTok (prints do mês inteiro),
// os totais vêm do resumo (as lives registradas podem não cobrir o mês todo); a lista continua sendo a das lives.
function monthStats(lives, month) {
  const ls = lives.filter(l => l.date?.startsWith(month))
  const sum = summaryOf(month)
  const fromSummary = !!sum?.diamonds && sum.diamonds > sumOf(ls, 'diamonds')
  const agg = fromSummary ? [sum] : ls
  const total = k => sumOf(agg, k)
  const days = new Set(ls.map(l => l.date)).size
  const gems = total('diamonds')
  const min = total('duration_min')
  return { ls, agg, fromSummary, days, gems, min, usd: total('rewards_usd'),
    perDay: fromSummary ? null : days ? gems / days : 0, perHour: min ? gems / (min / 60) : null, perLive: fromSummary ? null : ls.length ? gems / ls.length : 0 }
}
const summaryOf = month => (state.data.summaries || []).find(r => r.month === month)?.data

function funnelCard(s, prev) {
  const f = st => {
    const t = k => sumOf(st.agg, k)
    const views = t('views'), unique = t('unique_viewers'), gifters = t('gifters'), followers = t('new_followers'), gems = t('diamonds')
    return { views, unique, gifters, followers, tick: gifters ? gems / gifters : null }
  }
  const F = f(s)
  if (!F.views || !F.unique) return ''
  const P = prev ? f(prev) : null
  return sec('Público', `
    <div class="quad">
      ${qcell('eye', 'Visualizações', int(F.views), '', 'total do mês')}
      ${qcell('user', 'Espectadores', int(F.unique), '', `${dec(F.unique / F.views * 100, 0)}% das views`)}
      ${qcell('gem', 'Presenteadores', int(F.gifters), delta(F.gifters / F.unique, P?.unique ? P.gifters / P.unique : 0), `${dec(F.gifters / F.unique * 100)}% do público`)}
      ${qcell('heart', 'Seguidores', '+' + int(F.followers), delta(F.followers / F.unique, P?.unique ? P.followers / P.unique : 0), `${dec(F.followers / F.unique * 1000)} a cada mil`)}
    </div>
    ${F.tick ? `<div class="fnote">${ic('gem')}Média de <b>${esc(int(Math.round(F.tick)))}</b> diamantes por presenteador</div>` : ''}`)
}

// Seu público: gênero, idade e países do mês, comparados com o mês anterior
const COUNTRY = { Brazil: ['🇧🇷', 'Brasil'], Philippines: ['🇵🇭', 'Filipinas'], Italy: ['🇮🇹', 'Itália'], 'United Kingdom': ['🇬🇧', 'Reino Unido'], 'United States': ['🇺🇸', 'Estados Unidos'], Portugal: ['🇵🇹', 'Portugal'], Spain: ['🇪🇸', 'Espanha'], Mexico: ['🇲🇽', 'México'], Indonesia: ['🇮🇩', 'Indonésia'], Germany: ['🇩🇪', 'Alemanha'], France: ['🇫🇷', 'França'], Argentina: ['🇦🇷', 'Argentina'], Japan: ['🇯🇵', 'Japão'], Others: ['', 'Outros'] }
function audienceCard(ym) {
  const row = (state.data.summaries || []).find(r => r.month === ym)
  const a = row?.data
  if (!a || (a.female_pct == null && !a.ages && !a.countries)) return ''
  const b = summaryOf(prevYm(ym)) || {}
  const pName = monthWord(prevYm(ym))
  const pts = (cur, before) => {
    if (before == null || cur == null) return ''
    const d = cur - before
    return d === 0 ? '<em class="muted">=</em>' : `<em class="${d > 0 ? 'up' : 'down'}">${d > 0 ? '↑' : '↓'} ${Math.abs(d)} pt</em>`
  }
  const ages = AGE_ORDER.filter(k => a.ages?.[k] != null && a.ages[k] <= 100 && (k !== '13-17' || a.ages[k] > 0)).map(k => [k, a.ages[k]])
  const countries = mergeCountries([], (a.countries || []).map(([n, v]) => [n.replace(/^(?:[A-Z][A-Za-z]{0,2}\s)+(?=[A-Z][a-z])/, ''), v]))
  const topAge = Math.max(...ages.map(([, v]) => v), 1)
  const scale = Math.max(topAge, ...Object.values(b.ages || {})) * 1.08
  const bc = Object.fromEntries(b.countries || [])
  return sec('Seu público', `
    <div class="aud">
      ${a.female_pct != null ? `
      <div class="ah"><small>Gênero</small><span class="lg2"><i class="f"></i>Mulheres <i class="m"></i>Homens</span></div>
      <div class="gbar"><i style="width:${a.female_pct}%">${a.female_pct}%</i><i style="width:${a.male_pct}%">${a.male_pct}%</i></div>
      ${b.female_pct != null ? `<div class="gcmp">${esc(pName)}: ${b.female_pct}% · ${b.male_pct}% ${a.female_pct !== b.female_pct ? `<em class="${a.female_pct > b.female_pct ? 'up' : 'down'}">${a.female_pct > b.female_pct ? '↑' : '↓'} ${Math.abs(a.female_pct - b.female_pct)} ${Math.abs(a.female_pct - b.female_pct) === 1 ? 'pt' : 'pts'} mulheres</em>` : ''}</div>` : ''}` : ''}
      ${ages.length ? `
      <div class="ah"><small>Idade</small><span class="lg2"><i class="cur"></i>${esc(monthWord(ym).slice(0, 3))}${b.ages ? ` <i class="prv"></i>${esc(pName.slice(0, 3))}` : ''}</span></div>
      ${ages.map(([k, v]) => `<div class="ab ${v === topAge ? 'top' : ''}"><span>${k.replace('-', '–')}</span><div><i style="width:${(v / scale * 100).toFixed(1)}%"></i>${b.ages?.[k] != null ? `<u style="width:${(b.ages[k] / scale * 100).toFixed(1)}%"></u>` : ''}</div><b class="num">${v}%</b></div>`).join('')}` : ''}
      ${countries.length ? `
      <div class="ah"><small>Países</small><span class="lg2">${b.countries ? `vs. ${esc(pName)}` : ''}</span></div>
      ${countries.map(([n, v]) => { const [flag, name] = COUNTRY[n] || ['', n]; return `<div class="ac"><span>${flag ? flag + ' ' : ''}${esc(name)}</span><b class="num">${v}%</b>${n === 'Others' ? '<em></em>' : pts(v, bc[n])}</div>` }).join('')}` : ''}
      <div class="afoot">${ic('cal')}${ym === today().slice(0, 7) ? `Print de ${esc(shortDate(row.updated_at))} · atualize toda semana` : `Resumo de ${esc(monthWord(ym))}`}</div>
    </div>`)
}

function retentionCard(s, prev, ym) {
  const cur = avgOf(s.agg, 'avg_watch_sec')
  if (!cur) return ''
  // resumo do mês e média das lives medem de jeitos diferentes: só compara igual com igual
  const before = prev ? avgOf(prev.agg, 'avg_watch_sec') : 0
  const mixed = prev && before && prev.fromSummary !== s.fromSummary
  const d = before && !mixed ? Math.round(cur - before) : null
  const pName = monthWord(prevYm(ym))
  const top = Math.max(cur, before) * 1.15
  const bar = (label, v, on) => `<div class="rb ${on ? 'cur' : ''}"><span>${esc(label)}</span><i><i style="width:${(v / top * 100).toFixed(1)}%"></i></i><b>${Math.round(v)}s</b></div>`
  const peak = avgOf(s.agg, 'peak_viewers'), pPeak = prev && !mixed ? avgOf(prev.agg, 'peak_viewers') : 0
  return sec('Retenção', `
    <div class="ret">
      <div class="rh"><div><small>Tempo médio assistido</small><b>${Math.round(cur)}s</b></div>${d != null ? `<em class="${d >= 0 ? 'up' : 'down'}">${d >= 0 ? '↑' : '↓'} ${Math.abs(d)} s vs. ${esc(pName)}</em>` : ''}</div>
      ${before ? bar(pName, before, false) : ''}${bar(monthWord(ym), cur, true)}
      ${mixed ? `<p class="muted small">${esc(cap(monthWord(s.fromSummary ? ym : prevYm(ym))))} vem do resumo do mês do TikTok, que mede o tempo médio de um jeito diferente da média das lives.</p>` : s.fromSummary ? '<p class="muted small">Do resumo do mês do TikTok.</p>' : ''}
      ${peak ? `<div class="row"><span>Pico médio por live</span><b class="num">${esc(int(Math.round(peak)))}${pPeak ? ` <span class="muted">(${esc(pName.slice(0, 3))}.: ${esc(int(Math.round(pPeak)))})</span>` : ''}</b></div>` : ''}
    </div>`)
}

// ---------- Estatísticas novas ----------

// a cada mil views, por espectador e quanto vale cada mil views (mês contra o anterior)
function engagementCard(s, prev, rate) {
  const f = st => {
    const t = k => sumOf(st.agg, k)
    const views = t('views'), unique = t('unique_viewers')
    return { views, com: views ? t('comments') / views * 1000 : null, sha: views ? t('shares') / views * 1000 : null,
      per: unique ? t('diamonds') / unique : null, mil: views && rate ? t('rewards_usd') * rate / views * 1000 : null }
  }
  const F = f(s)
  if (!F.views) return ''
  const P = prev ? f(prev) : {}
  const cell = (icon, label, v, fmt, before, rateTxt, money) => v == null ? '' : qcell(icon, label, fmt(v), delta(v, before), rateTxt, money)
  return sec('Engajamento e valor', `<div class="quad">
    ${cell('heart', 'Comentários', F.com, v => dec(v, 0), P.com, 'a cada mil views')}
    ${cell('live', 'Compartilh.', F.sha, v => dec(v, 0), P.sha, 'a cada mil views')}
    ${cell('gem', 'Por espectador', F.per, v => dec(v, 2), P.per, 'diamantes')}
    ${cell('usd', 'Mil views', F.mil, v => brl0(v), P.mil, 'em reais', true)}
  </div>`, prev ? `<span>vs. ${esc(monthWord(prevYm(state.smonth)))}</span>` : '')
}

const hint = (icon, html) => `<p class="hint2">${ic(icon)}<span>${html}</span></p>`

// média de diamantes por live em cada dia da semana (todas as lives)
function weekdayCard(lives) {
  const ls = lives.filter(l => l.date && Number(l.diamonds) > 0)
  if (ls.length < 5) return ''
  const names = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']
  const avg = [1, 2, 3, 4, 5, 6, 0].map(d => {
    const g = ls.filter(l => new Date(`${l.date}T12:00`).getDay() === d)
    return { d, n: g.length, v: g.length ? sumOf(g, 'diamonds') / g.length : 0 }
  })
  const best = avg.reduce((a, b) => (b.v > a.v ? b : a))
  return sec('Melhor dia da semana', `<div class="chartcard">
    <div class="wk">${avg.map(a => `<div class="${a === best ? 'best1' : ''}"><b>${a.v ? esc(compactK(a.v)) : ''}</b><i style="height:${(a.v / best.v * 100).toFixed(1)}%"></i><span>${names[a.d][0]}</span></div>`).join('')}</div>
    ${hint('trophy', `<b>${names[best.d]}</b> rende mais: média de <b class="num">${esc(compact(best.v))}</b> diamantes por live`)}
  </div>`, '<span>todas as lives</span>')
}
const compactK = v => (v >= 1e6 ? `${dec(v / 1e6, 1)}mi` : `${int(Math.round(v / 1e3))}k`)

// diamantes por hora de acordo com o tamanho da live
function durationCard(lives) {
  const ls = lives.filter(l => Number(l.duration_min) > 0 && Number(l.diamonds) > 0)
  if (ls.length < 5) return ''
  const groups = [['Até 1h', 0, 60], ['1h a 2h', 60, 120], ['2h a 3h', 120, 180], ['Mais de 3h', 180, 1e9]].map(([label, a, b]) => {
    const g = ls.filter(l => l.duration_min > a && l.duration_min <= b)
    const h = sumOf(g, 'duration_min') / 60
    return { label, n: g.length, v: h ? sumOf(g, 'diamonds') / h : 0 }
  }).filter(g => g.n)
  const best = groups.reduce((a, b) => (b.v > a.v ? b : a))
  return sec('Duração ideal', `<div class="chartcard">
    ${groups.map(g => `<div class="dur ${g === best ? 'best1' : ''}"><span>${g.label}<small>${g.n} ${g.n === 1 ? 'live' : 'lives'}</small></span><div><i style="width:${(g.v / best.v * 100).toFixed(1)}%"></i></div><b class="num">${esc(dec(g.v / 1e3, 1))}k/h</b></div>`).join('')}
    ${hint('clock', `Lives de <b>${best.label.toLowerCase()}</b> rendem mais diamantes por hora`)}
  </div>`, '<span>todas as lives</span>')
}

// calendário do mês: quanto mais forte, mais diamantes no dia
function calendarCard(lives, ym) {
  const [y, m] = ym.split('-').map(Number)
  const n = new Date(y, m, 0).getDate()
  const byDay = Array.from({ length: n }, (_, d) => sumOf(lives.filter(l => l.date === `${ym}-${String(d + 1).padStart(2, '0')}`), 'diamonds'))
  const top = Math.max(...byDay)
  if (!top) return ''
  const lead = (new Date(y, m - 1, 1).getDay() + 6) % 7
  const now = today()
  return sec(`Calendário de ${esc(monthWord(ym))}`, `<div class="chartcard">
    <div class="cal">${['S', 'T', 'Q', 'Q', 'S', 'S', 'D'].map(d => `<span class="h">${d}</span>`).join('')}${'<i class="x"></i>'.repeat(lead)}${byDay.map((v, d) => {
      const day = `${ym}-${String(d + 1).padStart(2, '0')}`
      return `<i class="${day > now ? 'fut' : v ? 'on' : ''}" style="--a:${v ? (0.25 + v / top * 0.75).toFixed(2) : 0}" title="${v ? esc(int(v)) : ''}"><b>${d + 1}</b></i>`
    }).join('')}</div>
    <div class="legend2"><span>menos</span>${[0.25, 0.45, 0.65, 0.85, 1].map(a => `<i style="--a:${a}"></i>`).join('')}<span>mais</span></div>
  </div>`)
}

// títulos usados mais de uma vez, pela média de diamantes por live
function titlesCard(lives) {
  const by = new Map()
  for (const l of lives) if (l.title && Number(l.diamonds) > 0) by.set(l.title, [...(by.get(l.title) || []), l])
  const rows = [...by].filter(([, g]) => g.length > 1).map(([t, g]) => ({ t, n: g.length, avg: sumOf(g, 'diamonds') / g.length, best: Math.max(...g.map(l => Number(l.diamonds))) }))
    .sort((a, b) => b.avg - a.avg).slice(0, 5)
  if (rows.length < 2) return ''
  return sec('Títulos campeões', `<div class="group">${rows.map((r, i) => `
    <div class="rk"><span class="pos ${i === 0 ? 'g' : ''}">${i + 1}º</span><div class="t"><b>${esc(r.t)}</b><span>${r.n} lives · melhor <span class="num">${esc(int(r.best))}</span></span></div><b class="num">${esc(compact(r.avg))}</b></div>`).join('')}</div>`, '<span>média por live</span>')
}

// diamantes dos últimos 6 meses (até o mês escolhido); usa o resumo do TikTok quando ele é maior
function monthsCard(lives, ym) {
  const months = []
  let m = ym
  for (let i = 0; i < 6; i++) { months.unshift(m); m = prevYm(m) }
  const vals = months.map(mm => Math.max(sumOf(lives.filter(l => l.date?.startsWith(mm)), 'diamonds'), Number(summaryOf(mm)?.diamonds) || 0))
  const withData = vals.filter(Boolean)
  if (withData.length < 2) return ''
  const top = Math.max(...vals)
  const cur = today().slice(0, 7)
  const done = months.map((mm, i) => (mm < cur ? vals[i] : 0)).filter(Boolean)
  return sec('Últimos 6 meses', `<div class="chartcard">
    <div class="wk mo">${months.map((mm, i) => `<div class="${mm === cur ? 'cur' : vals[i] === top ? 'best1' : ''}"><b>${vals[i] ? esc(dec(vals[i] / 1e6, 2)) : ''}</b><i style="height:${(vals[i] / top * 100).toFixed(1)}%"></i><span>${esc(monthWord(mm).slice(0, 3))}</span></div>`).join('')}</div>
    ${done.length ? hint('stats', `Média de <b class="num">${esc(compact(sumOf(done.map(v => ({ v })), 'v') / done.length))}</b> por mês${months.includes(cur) ? ` · ${esc(monthWord(cur))} ainda em andamento` : ''}`) : ''}
  </div>`, '<span>milhões de diamantes</span>')
}

function recordsCard(lives) {
  const top = k => lives.filter(l => Number(l[k]) > 0).reduce((a, l) => (!a || Number(l[k]) > Number(a[k]) ? l : a), null)
  const byMonth = {}
  for (const l of lives) if (l.date) byMonth[l.date.slice(0, 7)] = (byMonth[l.date.slice(0, 7)] || 0) + (Number(l.diamonds) || 0)
  for (const r of state.data.summaries || []) if (r.data?.diamonds) byMonth[r.month] = Math.max(byMonth[r.month] || 0, r.data.diamonds)
  const bestMonth = Object.entries(byMonth).sort((a, b) => b[1] - a[1])[0]
  const days = [...new Set(lives.map(l => l.date).filter(Boolean))].sort()
  let best = 0, run = 0, bestEnd = null
  days.forEach((d, i) => {
    run = i && (new Date(`${d}T12:00`) - new Date(`${days[i - 1]}T12:00`)) / 864e5 === 1 ? run + 1 : 1
    if (run > best) { best = run; bestEnd = d }
  })
  const fresh = d => d && (Date.now() - new Date(`${d}T12:00`)) / 864e5 <= 7
  const dm = d => shortDate(`${d}T12:00`)
  const gem = top('diamonds'), fol = top('new_followers'), peak = top('peak_viewers')
  const items = [
    gem && ['Maior live', int(gem.diamonds), `diamantes · ${dm(gem.date)}`, gem.date],
    fol && ['Mais seguidores', '+' + int(fol.new_followers), `numa live · ${dm(fol.date)}`, fol.date],
    peak && ['Maior pico', int(peak.peak_viewers), `espectadores · ${dm(peak.date)}`, peak.date],
    bestMonth && bestMonth[1] && ['Melhor mês', compact(bestMonth[1]), new Date(`${bestMonth[0]}-15T12:00`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }), null],
    best > 1 && ['Maior sequência', `${best} dias`, `até ${new Date(`${bestEnd}T12:00`).toLocaleDateString('pt-BR')}`, null],
  ].filter(Boolean)
  if (!items.length) return ''
  return sec('Recordes', `<div class="recs">${items.map(([label, value, when, date]) => `
    <div class="rec ${fresh(date) ? 'new' : ''}"><i class="rt">${ic('trophy')}</i><div><small>${esc(label)}</small><span>${fresh(date) ? `<u>Novo recorde</u> · ${esc(dm(date))}` : esc(when)}</span></div><b>${esc(value)}</b></div>`).join('')}</div>`)
}

const perHour = l => (l.duration_min ? (Number(l.diamonds) || 0) / (l.duration_min / 60) : 0)

const LSORT = ['data', 'diamantes', 'hora']
function renderLives(animate) {
  const view = document.getElementById('view')
  const { lives } = state.data
  const months = [...new Set([today().slice(0, 7), ...lives.map(l => l.date?.slice(0, 7)).filter(Boolean)])].sort()
  if (!months.includes(state.lmonth)) state.lmonth = months.at(-1)
  const i = months.indexOf(state.lmonth)
  const s = monthStats(lives, state.lmonth)
  const prev = i > 0 ? monthStats(lives, months[i - 1]) : null

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
    const byDay = Array.from({ length: nDays }, (_, d) => sumOf(s.ls.filter(l => +l.date.slice(8) === d + 1), 'diamonds'))
    const top = Math.max(...byDay, 1)
    const W = 300, H = 110, bw = W / nDays
    const bars = byDay.map((g, d) => g ? `<rect style="--i:${d}" x="${(d * bw + bw * 0.15).toFixed(1)}" y="${(H - g / top * H).toFixed(1)}" width="${(bw * 0.7).toFixed(1)}" height="${(g / top * H).toFixed(1)}" rx="2" fill="${g === top ? 'var(--copper)' : '#8fd3a4'}"/>` : '').join('')
    const realAvg = s.days ? sumOf(s.ls, 'diamonds') / s.days : 0
    const avgY = (H - realAvg / top * H).toFixed(1)
    const pName = prev ? monthWord(months[i - 1]) : ''
    body = `
      ${sec(prev ? `Comparado a ${esc(pName)}` : 'O mês', `<div class="quad">
        ${qcell('gem', 'Diamantes', compact(s.gems), delta(s.gems, prev?.gems))}
        ${qcell('usd', 'Recompensas', s.usd >= 1e4 ? `US$ ${dec(s.usd / 1e3)} mil` : usd0(Math.round(s.usd)), delta(s.usd, prev?.usd), '', true)}
        ${qcell('cal', 'Por dia de live', s.perDay == null ? '—' : int(Math.round(s.perDay)), delta(s.perDay, prev?.perDay))}
        ${qcell('clock', 'Por hora', s.perHour == null ? '—' : int(Math.round(s.perHour)), delta(s.perHour, prev?.perHour))}
        ${qcell('live', 'Por live', s.perLive == null ? '—' : int(Math.round(s.perLive)), delta(s.perLive, prev?.perLive))}
        ${qcell('clock', 'Ao vivo', hours(s.min), delta(s.min, prev?.min))}
      </div>`)}
      <div class="best"><span class="tr">${ic('trophy')}</span><div><small>Melhor live do mês · ${esc(weekday(best.date))}. ${esc(shortDate(`${best.date}T12:00`))}</small><b>${esc(best.title || fmtDate(best.date))}</b>
        <p><span>${esc(int(best.diamonds))}</span> diam.${best.duration_min ? ` · <span>${esc(int(Math.round(perHour(best))))}</span>/h` : ''}${best.new_followers != null ? ` · <span>+${esc(int(best.new_followers))}</span> seg.` : ''}</p></div></div>
      <div class="chartcard"><div class="hd"><b>Diamantes por dia</b><span>média <span class="num">${esc(int(Math.round(realAvg)))}</span></span></div>
        <svg class="grow" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Diamantes por dia do mês">
          <line x1="0" x2="${W}" y1="${H}" y2="${H}" stroke="var(--line)"/>${bars}
          <line x1="0" x2="${W}" y1="${avgY}" y2="${avgY}" stroke="var(--muted)" stroke-dasharray="4 4" stroke-width="1" opacity=".6"/>
        </svg>
        <div class="axis"><span>1</span><span>8</span><span>15</span><span>22</span><span>${nDays}</span></div></div>
      <section class="sec">
        <div class="sort-row"><h2>Lives</h2>
          <div class="pillbar slider" role="group" aria-label="Ordenar" style="--n:3;--i:${state.lsortPrev ?? LSORT.indexOf(state.lsort)}">${[['data', 'Data'], ['diamantes', 'Diamantes'], ['hora', 'Por hora']].map(([k, l]) =>
            `<button type="button" data-lsort="${k}" aria-pressed="${state.lsort === k}">${l}</button>`).join('')}</div>
        </div>
        <div class="group">${sorted.map(l => lvRow(l, max, best.id)).join('')}</div>
      </section>`
  }

  view.innerHTML = `
    ${monthPicker(state.lmonth, `${s.ls.length} ${s.ls.length === 1 ? 'live' : 'lives'} · ${s.days} ${s.days === 1 ? 'dia' : 'dias'} de live`, 'data-month', i, months.length)}
    ${body}`
  view.querySelectorAll('[data-month]').forEach(b => b.addEventListener('click', () => {
    state.lmonth = months[i + Number(b.dataset.month)]
    renderLives()
  }))
  slideTo(view.querySelector('.pillbar.slider'), LSORT.indexOf(state.lsort)); state.lsortPrev = null
  view.querySelectorAll('[data-lsort]').forEach(b => b.addEventListener('click', () => { state.lsortPrev = LSORT.indexOf(state.lsort); state.lsort = b.dataset.lsort; renderLives() }))
  bindList(view)
  if (animate) reveal(view)
}

// ---------- Estatísticas ----------

function renderStats(animate) {
  const view = document.getElementById('view')
  const { lives, withdrawals } = state.data
  const current = today().slice(0, 7)
  const months = [...new Set([current, ...lives.map(l => l.date?.slice(0, 7)).filter(Boolean)])].sort()
  if (!months.includes(state.smonth)) state.smonth = current
  const i = months.indexOf(state.smonth)
  const s = monthStats(lives, state.smonth)
  const prev = i > 0 ? monthStats(lives, months[i - 1]) : null
  const rate = payoutRate(withdrawals, state.rate?.commercial)?.rate ?? null
  const parts = [
    streakCard(lives),
    projCard(s.agg, rate, state.smonth, state.smonth === current, s.fromSummary ? null : s.ls.length),
    funnelCard(s, prev),
    engagementCard(s, prev, rate),
    audienceCard(state.smonth),
    retentionCard(s, prev, state.smonth),
    weekdayCard(lives),
    durationCard(lives),
    calendarCard(lives, state.smonth),
    titlesCard(lives),
    monthsCard(lives, state.smonth),
    recordsCard(lives),
  ].filter(Boolean)
  view.innerHTML = `
    ${monthPicker(state.smonth, `${s.ls.length} ${s.ls.length === 1 ? 'live' : 'lives'} · ${s.days} ${s.days === 1 ? 'dia' : 'dias'} de live`, 'data-smonth', i, months.length)}
    ${parts.length ? parts.join('') : empty('Registre lives pelos prints para ver as estatísticas.', 'lives')}`
  view.querySelectorAll('[data-smonth]').forEach(b => b.addEventListener('click', () => {
    state.smonth = months[i + Number(b.dataset.smonth)]
    renderStats()
  }))
  bindList(view)
  if (animate) reveal(view)
}

// ---------- Recompensas ----------

const CHECK = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>'
const pct = v => `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(v)}%`
const usd0 = v => 'US$ ' + new Intl.NumberFormat('pt-BR').format(v)
const num = v => Number(String(v ?? '').replace(/\./g, '').replace(',', '.')) || 0
const shortDate = d => new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
const METHOD = { payoneer: 'Payoneer', pix: 'Pix' }
const BANK = { inter: 'Inter', nubank: 'Nubank' }
const SUB_TABS = { saldo: 'Saldo', missoes: 'Missões', limite: 'Limite', regras: 'Regras' }

async function loadSettings() {
  const { data } = await sb.from('settings').select('*').maybeSingle()
  return (state.data.settings = data || { daily_limit_usd: 5000 })
}

function renderRewards(animate) {
  const view = document.getElementById('view')
  updateDue()

  const L = ledger(state.data)
  const payout = payoutRate(state.data.withdrawals, state.rate?.commercial)
  const ctx = { L, payout, rate: payout?.rate }
  view.innerHTML = `
    <div class="seg slider" role="tablist" style="--n:4;--i:${state.rtabPrev ?? Object.keys(SUB_TABS).indexOf(state.rtab)}">${Object.entries(SUB_TABS).map(([id, label]) =>
      `<button role="tab" data-rtab="${id}" aria-selected="${state.rtab === id}">${label}</button>`).join('')}</div>
    <div id="rpanel" class="panel">${{ saldo: saldoPanel, missoes: missoesPanel, limite: limitePanel, regras: regrasPanel }[state.rtab](ctx)}</div>`
  view.querySelector('.seg').addEventListener('click', ev => {
    const b = ev.target.closest('[data-rtab]')
    if (!b || b.dataset.rtab === state.rtab) return
    state.rtabPrev = Object.keys(SUB_TABS).indexOf(state.rtab)
    state.rtab = b.dataset.rtab
    renderRewards(true)
  })
  slideTo(view.querySelector('.seg.slider'), Object.keys(SUB_TABS).indexOf(state.rtab)); state.rtabPrev = null
  ;({ saldo: bindSaldo, missoes: bindMissoes, limite: bindLimite, regras: () => {} })[state.rtab](view, ctx)
  if (animate) reveal(view)
}

const noPrint = () => `
  <div class="empty"><p class="muted">Mande o print de <b>Upcoming rewards</b> (Content rewards) para o app saber o seu saldo.</p>
  <button class="btn primary" type="button" data-open-prints>Mandar prints</button></div>`

const got = w => (w.amount_usd - WITHDRAW_FEE_USD) * w.rate_brl

function saldoPanel({ L, payout, rate }) {
  const wds = state.data.withdrawals
  const ym = today().slice(0, 7)
  const earned = monthEarned(state.data, ym)
  const fromLives = sumOf(state.data.lives.filter(l => l.date?.startsWith(ym)), 'rewards_usd')
  const received = wds.filter(w => w.date?.startsWith(ym)).reduce((a, w) => a + got(w), 0)
  const last = wds[0]
  const lastRate = last?.rate_brl ?? (rate ? rate.toFixed(4) : '')
  const via = last?.method || 'payoneer', bank = last?.bank || 'inter'
  const entries = [
    ...(L.credit ? [{ when: L.credit.at, label: `Semanal ${shortDate(`${L.credit.week}T12:00`)}`, usd: L.credit.usd }] : []),
    ...state.data.lives.filter(l => l.rewards_usd != null).slice(0, 5).map(l => ({ when: new Date(`${l.date}T12:00`), label: `Live · ${shortDate(`${l.date}T12:00`)}`, usd: l.rewards_usd })),
  ].sort((a, b) => b.when - a.when).slice(0, 6)
  const r = reportData(wds)
  const seg = (name, opts, on) => `<div class="seg2 slider" data-pick="${name}" style="--n:2;--i:${Object.keys(opts).indexOf(on)}">${Object.entries(opts).map(([k, l]) => `<button type="button" data-v="${k}" aria-pressed="${k === on}">${l}</button>`).join('')}</div>`
  return `
    <div class="feature hero">${rain(NOTE)}
      <div class="k"><i>${ic('usd')}</i>Saldo de ${esc(monthWord(ym))}${rate ? `<em>US$ 1 = ${esc(brlRate(rate))}</em>` : ''}</div>
      <div class="big num" data-count>${rate ? esc(brl0(earned * rate)) : esc(usd(earned))}</div>
      <div class="sub"><span class="num">${esc(usd(earned))}</span> em recompensas no mês${rate ? ' · estimado em reais' : ''}</div>
      <div class="kpis"><div><span>Nas lives</span><b>${esc(usd0(Math.round(fromLives)))}</b></div><div><span>Semanais</span><b>${esc(usd0(Math.round(earned - fromLives)))}</b></div><div><span>Já sacado</span><b>${esc(brl0(received))}</b></div></div>
    </div>

    ${L.snap ? sec('Na conta agora', `<div class="quad">
      ${qcell('usd', 'Disponível', usd(L.available), '', rate ? `≈ ${brl(Math.max(L.available - WITHDRAW_FEE_USD, 0) * rate)}` : '', true)}
      ${qcell('cal', 'A receber', usd(L.upcoming.usd), '', `cai seg. ${shortDate(weekEndOf(L.current))} à 1h · ${pct(L.upcoming.pct)}`)}
    </div>`, `<span>print de ${esc(shortDate(L.snap.taken_at))}</span>`) : noPrint()}

    ${sec('Registrar saque', `
    <form class="form" id="w-form">
      <div class="opt"><span>Saque via</span>${seg('method', METHOD, via)}</div>
      <div class="opt"><span>Caiu no</span>${seg('bank', BANK, bank)}</div>
      <input type="hidden" name="method" value="${via}"><input type="hidden" name="bank" value="${bank}">
      <div class="grid">
        <label class="field" for="w-amount"><span>Sacado no TikTok (US$)</span><input id="w-amount" name="amount" type="text" inputmode="decimal" placeholder="0,00" required></label>
        <label class="field" for="w-rate"><span id="w-rate-lbl">${via === 'pix' ? 'Cotação do Pix' : 'Dólar no Payoneer'}</span><input id="w-rate" name="rate" type="text" inputmode="decimal" value="${esc(String(lastRate).replace('.', ','))}" required></label>
      </div>
      <label class="field" for="w-date"><span>Data</span><input id="w-date" name="date" type="date" value="${today()}"></label>
      <div class="sum"><div><span>Taxa do TikTok</span><b>− US$ 3,00</b></div><div><span>Cai na sua conta</span><b class="acc" id="w-total">R$ 0,00</b></div></div>
      <p class="hint" id="w-warn"></p>
      <button class="btn primary" type="submit">Registrar saque</button>
    </form>`)}

    ${sec(r ? `Saques de ${esc(monthWord(r.ym))}` : 'Saques', r ? `<div class="group">
      ${r.ws.slice().reverse().map(w => `<button type="button" class="lv" data-withdrawal="${w.id}">
        <span class="dt"><b>${esc(w.date.slice(8))}</b><small>${esc(weekday(w.date))}</small></span>
        <div class="t"><b>${esc(METHOD[w.method] || 'Payoneer')} <span class="bk" style="display:inline">→ ${esc(BANK[w.bank] || 'Inter')}</span></b><span class="num">${esc(usd0(Math.round(w.amount_usd)))} × ${esc(dec(Number(w.rate_brl), 4))}</span></div>
        <b class="g">${esc(brl0(got(w)))}</b></button>`).join('')}
      <div class="wfoot"><div><span>Recebido no mês</span><b>${esc(brl(r.total))}</b><small>${r.ws.length} ${r.ws.length === 1 ? 'saque' : 'saques'}</small></div><button type="button" data-report>${ic('text')}Relatório</button></div>
    </div>` : '<p class="muted small" style="padding:0 6px">Nenhum saque registrado.</p>',
      r && r.months.length > 1 ? `<span class="wmonth"><button type="button" data-wmonth="-1" aria-label="Mês anterior" ${r.i === 0 ? 'disabled' : ''}>${ic('back')}</button><button type="button" data-wmonth="1" aria-label="Próximo mês" ${r.i === r.months.length - 1 ? 'disabled' : ''}>${ic('chev')}</button></span>` : '')}

    ${entries.length ? sec('Últimas entradas', `<div class="card">${entries.map(e => `<div class="row"><span>${esc(e.label)}</span><b class="up num">+${esc(usd(e.usd))}</b></div>`).join('')}</div>`) : ''}`
}

// Relatório do mês: só os rendimentos, em reais (para o contador fazer o DAS)
function reportData(wds) {
  const months = [...new Set(wds.map(w => w.date?.slice(0, 7)).filter(Boolean))].sort()
  if (!months.length) return null
  if (!months.includes(state.wmonth)) state.wmonth = months.at(-1)
  const ws = wds.filter(w => w.date?.startsWith(state.wmonth)).sort((a, b) => a.date.localeCompare(b.date))
  const total = ws.reduce((a, w) => a + got(w), 0)
  const text = `Olá, segue o relatório atualizado do mês.\n📊 Rendimentos de ${monthWord(state.wmonth)}: ${brl(total)}`
  return { ym: state.wmonth, months, i: months.indexOf(state.wmonth), ws, total, text }
}

function openReport() {
  const { text, ym } = reportData(state.data.withdrawals)
  sheet.innerHTML = `
    <div class="sheet-body">
      <div class="sheet-head"><span></span><strong>Relatório de ${esc(monthWord(ym))}</strong><button type="button" class="link" data-close>OK</button></div>
      <p class="muted small" style="text-align:center">Texto pronto pra mandar no WhatsApp do contador</p>
      <pre class="wa">${esc(text)}</pre>
      <button class="btn primary" type="button" data-copy>${ic('copy')}Copiar texto</button>
    </div>`
  sheet.querySelector('[data-close]').addEventListener('click', closeSheet)
  sheet.querySelector('[data-copy]').addEventListener('click', async ev => {
    try {
      await navigator.clipboard.writeText(text)
      ev.currentTarget.innerHTML = `${ic('copy')}Copiado!`
    } catch {
      // sem acesso à área de transferência: seleciona o texto para copiar na mão
      getSelection().selectAllChildren(sheet.querySelector('.wa'))
      toast('Toque em Copiar no texto selecionado')
    }
  })
  sheet.showModal()
  document.activeElement?.blur()
}

function bindSaldo(view, { L }) {
  view.querySelectorAll('[data-wmonth]').forEach(b => b.addEventListener('click', () => {
    const r = reportData(state.data.withdrawals)
    state.wmonth = r.months[r.i + Number(b.dataset.wmonth)]
    renderRewards(false)
  }))
  view.querySelector('[data-report]')?.addEventListener('click', openReport)
  view.querySelector('[data-open-prints]')?.addEventListener('click', openPrints)
  const form = view.querySelector('#w-form')
  const calc = () => {
    const amount = num(form.amount.value)
    const rate = num(form.rate.value)
    const pix = form.method.value === 'pix'
    view.querySelector('#w-total').textContent = brl(Math.max(amount - WITHDRAW_FEE_USD, 0) * rate)
    const limit = currentLimit().usd
    view.querySelector('#w-warn').textContent =
      amount && amount < 9 ? 'O saque mínimo é US$ 9.'
      : pix && !amount ? 'Pelo Pix o saque mínimo é US$ 9'
      : amount > limit ? `Seu limite é ${usd0(limit)} por dia.`
      : L.snap && form.date.value >= L.snap.taken_at.slice(0, 10) && amount > L.available + 0.005 ? `Mais do que o disponível (${usd(L.available)}).` : ''
  }
  // Payoneer ou Pix, Inter ou Nubank
  form.querySelectorAll('[data-pick]').forEach(g => g.addEventListener('click', ev => {
    const b = ev.target.closest('[data-v]')
    if (!b) return
    g.querySelectorAll('[data-v]').forEach(x => x.setAttribute('aria-pressed', x === b))
    g.style.setProperty('--i', [...g.querySelectorAll('[data-v]')].indexOf(b))
    form[g.dataset.pick].value = b.dataset.v
    if (g.dataset.pick === 'method') view.querySelector('#w-rate-lbl').textContent = b.dataset.v === 'pix' ? 'Cotação do Pix' : 'Dólar no Payoneer'
    calc()
  }))
  form.addEventListener('input', calc)
  form.date.addEventListener('change', calc)
  calc()
  form.addEventListener('submit', async ev => {
    ev.preventDefault()
    const amount = num(form.amount.value)
    const rate = num(form.rate.value)
    if (amount < 9) return toast('O saque mínimo é US$ 9.')
    if (!rate) return toast('Coloque a cotação do dólar.')
    const date = form.date.value || today()
    const btn = form.querySelector('[type=submit]')
    if (btn.disabled) return
    btn.disabled = true
    const row = { amount_usd: amount, rate_brl: rate, date, method: form.method.value, bank: form.bank.value }
    let { error } = await sb.from('withdrawals').insert(row)
    // banco ainda sem as colunas novas (migração 004): salva sem a forma e o banco
    if (error && /method|bank/.test(error.message)) ({ error } = await sb.from('withdrawals').insert({ amount_usd: amount, rate_brl: rate, date }))
    if (error) { btn.disabled = false; return toast('Erro ao registrar: ' + error.message) }
    state.wmonth = date.slice(0, 7)   // a lista mostra o mês do saque que acabou de entrar
    checkmark(btn)
    toast('Saque registrado')
    setTimeout(() => reload('rewards'), still() ? 0 : 700)
  })
  view.querySelectorAll('[data-withdrawal]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Excluir este saque?')) return
    const { error } = await sb.from('withdrawals').delete().eq('id', b.dataset.withdrawal)
    if (error) return toast('Erro ao excluir: ' + error.message)
    toast('Saque excluído')
    reload('rewards')
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
  const endLabel = shortDate(`${days[6]}T12:00`)
  const letters = days.map(d => new Date(`${d}T12:00`).toLocaleDateString('pt-BR', { weekday: 'narrow' }).toUpperCase())
  const ld = snapThisWeek?.league_days ?? 0
  return `
    <div class="feature">
      <div class="k"><i>${ic('cal')}</i>Semana de ${esc(days[0].slice(8))} a ${esc(endLabel)}<em>${L.snap ? `${pct(L.upcoming.pct)} de 13%` : 'sem print'}</em></div>
      <div class="ringrow"><div><div class="big num">${L.snap ? esc(usd(L.upcoming.usd)) : '—'}</div>
        <div class="sub">${L.snap ? `<span class="num">${esc(int(L.upcoming.gems))}</span> diamantes · ${L.upcoming.fromPrint ? `do print de ${esc(shortDate(L.snap.taken_at))}` : `estimativa com ${pct(L.upcoming.pct)}`}` : 'Mande o print de Upcoming rewards'}</div></div>
        ${L.snap ? ring(L.upcoming.pct / 13 * 100, pct(L.upcoming.pct), 'de 13%') : ''}</div>
    </div>

    ${sec('Dias válidos de live', `<div class="card"><div class="days">${days.map((d, k) => `<i class="${minutesByDay[d] >= 25 ? 'on' : ''}" title="${d}">${letters[k]}</i>`).join('')}</div>
      <div class="row"><span>Dia com 25 min ou mais · 2 dias = 8%</span><em>+${daysPct(valid)}%</em></div></div>`)}

    ${sec(`Manter liga ${esc(L.snap?.league || 'A1')}`, `<div class="card"><div class="days">${[1, 2, 3, 4, 5, 6, 7].map(d => `<button type="button" data-mld="${d}" class="${d <= ld ? 'on' : ''}" aria-label="${d} de 7 dias" ${snapThisWeek ? '' : 'disabled'}>${d}</button>`).join('')}</div>
      <div class="row"><span>${snapThisWeek?.league_days != null ? 'Toque para corrigir os dias' : snapThisWeek ? 'Toque no último dia mantido' : 'Atualiza com o print de domingo'}</span><em>${snapThisWeek?.league_days != null ? '+1%' : '—'}</em></div>
      <p class="muted small">Manter A1–A3 a semana toda = 1%, superar a melhor liga = 3%.</p></div>`)}

    ${sec('Outras', `<div class="card">
      <div class="row"><span>Fãs ativos · 10+ / 25+ / 100+</span><em>${snapThisWeek?.fans_done ? 'concluída' : '—'}</em></div>
      ${last ? `<div class="mission"><div class="row"><b>Última live · ${esc(shortDate(`${last.date}T12:00`))}</b><em>${lp}%</em></div>
        <div class="ladder">${[
          ['5 min ou mais', '30%', last.duration_min >= 5],
          ['10 min ou mais', '35%', last.duration_min >= 10],
          ['25 min ou mais', '38%', last.duration_min >= 25],
          [`5 novos seguidores (fez ${int(last.new_followers ?? 0)})`, '+2%', (last.new_followers ?? 0) >= 5],
        ].map(([what, p, done]) => `<div class="step ${done ? 'done' : ''}"><span class="dot">${done ? CHECK : ''}</span><span>${esc(what)}</span><b>${p}</b></div>`).join('')}</div>
        ${last.diamonds ? `<div class="row"><span class="num">${esc(int(last.diamonds))} × US$ 0,01 × ${lp}%</span><b class="num">${esc(usd(last.diamonds * 0.01 * lp / 100))}</b></div>` : ''}</div>` : ''}
    </div>`)}

    ${sec('Simulador', `<div class="form">
      <label class="field" for="sim-gems"><span>Se a próxima live fizer quantos diamantes?</span><input id="sim-gems" type="number" inputmode="numeric" min="0" value="80000"></label>
      <div class="row"><span>Na live (40%)</span><b class="num" id="sim-live">US$ 0,00</b></div>
      <div class="row"><span>A mais no semanal</span><b class="num" id="sim-week">US$ 0,00</b></div>
      <div class="row"><span>Total em reais</span><b class="num acc" id="sim-brl">${rate ? 'R$ 0,00' : '—'}</b></div>
    </div>`)}`
}

function bindMissoes(view, { L, rate }) {
  view.querySelectorAll('[data-mld]').forEach(b => b.addEventListener('click', async () => {
    const d = Number(b.dataset.mld)
    const days = L.snap.league_days === d ? d - 1 : d
    const { error } = await sb.from('reward_snapshots').update({ league_days: days }).eq('id', L.snap.id)
    if (error) return toast('Erro ao salvar: ' + error.message)
    reload('rewards')
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

// Limite deste mês, pelas regras: sai do ganho do mês passado na tabela do TikTok.
// O ganho do mês passado vem das lives e semanais registrados ou do resumo do mês, o que for maior.
// Sem nenhum dado do mês passado, usa o último limite salvo.
function currentLimit() {
  const prev = prevYm(today().slice(0, 7))
  const earned = Math.max(monthEarned(state.data, prev), Number(summaryOf(prev)?.rewards_usd) || 0)
  return earned > 0 ? { usd: limitFor(earned).tier[1], earned, auto: true } : { usd: Number(state.data.settings?.daily_limit_usd) || 100, earned: 0, auto: false }
}

function limitePanel() {
  const month = today().slice(0, 7)
  const earned = monthEarned(state.data, month)
  const { tier, next } = limitFor(earned)
  const lim = currentLimit()
  const current = lim.usd
  const prevName = monthWord(prevYm(month))
  const nextName = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).toLocaleDateString('pt-BR', { month: 'long' })
  const progress = next ? earned / next[0] : 1
  return `
    <div class="feature">
      <div class="k"><i>${ic('shield')}</i>Limite de saque por dia<em>este mês</em></div>
      <div class="big num">${esc(usd0(current))}</div>
      <div class="sub">${lim.auto ? `pelo ganho de ${esc(prevName)}: <span class="num">${esc(usd(lim.earned))}</span>` : 'sem dados do mês passado: último limite salvo'}</div>
    </div>
    <div class="card">
      <div class="row"><span>Limite de ${esc(nextName)}</span><i class="pill ${tier[1] >= current ? 'ok' : 'down'}">${esc(usd0(tier[1]))} por dia</i></div>
      <div class="row"><span>Ganho neste mês (estimado)</span><b class="num">${esc(usd(earned))}</b></div>
      ${next ? `<div class="row" style="font-size:12px"><span>Rumo aos ${esc(usd0(next[0]))}</span><b class="num">${esc(int(Math.round(progress * 100)))}%</b></div>` : ''}
      <div class="track" style="background:var(--s2);margin-top:-6px"><i style="transform:scaleX(${Math.min(Math.max(progress, 0), 1)});background:linear-gradient(90deg,var(--p1),var(--accent-2))"></i></div>
      <p class="muted small">${next ? `Faltam <b class="num">${esc(usd(next[0] - earned))}</b> este mês para o limite de ${esc(nextName)} subir para ${esc(usd0(next[1]))} por dia.` : 'Você está na faixa mais alta.'} Conta as recompensas das lives registradas e os semanais que já caíram.</p>
    </div>
    ${sec('Tabela do TikTok', `<div class="card">
      <table>
        <thead><tr><th>Ganho no mês</th><th>Limite no mês seguinte</th></tr></thead>
        <tbody>${[...LIMIT_TIERS].reverse().map(([min, lim]) =>
          `<tr class="${min === tier[0] ? 'here' : next && min === next[0] ? 'next' : ''}"><td>${esc(usd0(min))}${min === tier[0] ? ' · você' : ''}</td><td>${esc(usd0(lim))}</td></tr>`).join('')}</tbody>
      </table></div>`)}`
}

function bindLimite() {}

function regrasPanel() {
  const table = rows => `<table><tbody>${rows.map(([a, b, tone]) => `<tr><td>${a}</td><td${tone ? ` class="${tone}"` : ''}>${b}</td></tr>`).join('')}</tbody></table>`
  return `
    <div class="feature">
      <div class="k"><i>${ic('gem')}</i>Como vira dinheiro</div>
      <div class="big" style="font-size:27px">250 diamantes = US$ 1</div>
      <div class="sub">Cada diamante vale US$ 0,01 e você fica com a sua porcentagem (40% por live).<br>Ex.: <span class="num">104.000 × US$ 0,01 × 40% = US$ 416,00</span></div>
    </div>
    ${sec('Por live · até 40%', `<div class="card">${table([['Menos de 5 min', '20%'], ['5 min ou mais', '30%'], ['10 min ou mais', '35%'], ['25 min ou mais', '38%'], ['+ 5 novos seguidores', '+2%']])}</div>`)}
    ${sec('Por semana · até 13%', `<div class="card">${table([['1 dia válido (25 min+)', '6%'], ['2 dias válidos ou mais', '8%'], ['10+ fãs ativos', '1%'], ['25+ fãs ativos', '1,5%'], ['100+ fãs ativos', '2%'], ['Manter liga A1–A3', '1%'], ['Superar a melhor liga', '3%']])}
      <p class="muted small">A semana vai de segunda a domingo e vira na segunda à 1h. O semanal cai no saldo nessa hora.</p></div>`)}
    ${sec('Liga · fragmentos por dia', `<div class="card">${table([['Top 1% no fechamento do dia', '+3', 'pos'], ['Top 10%', '+2', 'pos'], ['Top 20%', '+1', 'pos'], ['Top 60%', '0'], ['Abaixo disso ou sem live', '−1', 'neg']])}
      <p class="muted small">+4 fragmentos sobe de liga, −4 cai. Escudos bloqueiam uma perda cada, até 10. O Guardião pode forjar fragmentos (3 chances por semana) e mandar 1 escudo por semana. A posição muda o dia todo: vale a do fechamento.</p></div>`)}
    ${sec('Saque', `<div class="card">${table([['Taxa (Payoneer e Pix)', 'US$ 3 por saque'], ['Mínimo', 'US$ 9'], ['Pix', 'até US$ 2.500 por saque'], ['Payoneer', 'até o limite diário']])}</div>`)}`
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
      <div class="sheet-head"><span></span><strong>Mandar prints</strong><button type="button" class="link" data-close>Fechar</button></div>
      ${due ? '<i class="pill">domingo: falta o semanal</i>' : ''}
      <label class="btn primary file-btn" for="prints-files">Escolher prints</label>
      <input id="prints-files" type="file" accept="image/*" multiple hidden>
      <p class="muted small">Pode escolher prints de tipos diferentes juntos: o app reconhece cada um sozinho.</p>
      <span class="muted small" id="prints-status" role="status"></span>
      <div id="prints-result"></div>
      <ol class="routine">
        <li><b>Depois de cada live</b><span>3 prints da análise da live: Viewership, Engagement e Rewards.</span><em>registra a live</em></li>
        <li><b>Toda semana e no fim do mês</b><span>LIVE Analytics → Overview (Custom, o mês inteiro): Key metrics e Viewer insights.</span><em>resumo e público do mês</em></li>
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
      const monthly = texts.filter(t => !isWeeklyPrint(t) && isMonthPrint(t))
      const live = texts.filter(t => !isWeeklyPrint(t) && !isMonthPrint(t)).join('\n')
      const liveData = live.trim() ? parseTikTok(live) : {}
      const liveFields = Object.keys(liveData).length
      status.textContent = ''
      if (weekly.length) showWeekly(result, weekly)
      if (monthly.length) showMonth(result, monthly)
      if (liveFields) {
        result.insertAdjacentHTML('beforeend', `
          <div class="card"><div class="row"><b>Live${liveData.date ? ` de ${esc(shortDate(`${liveData.date}T12:00`))}` : ''}</b><span class="muted">${liveFields} campos lidos</span></div>
          <button class="btn primary" type="button" data-open-live>Conferir e salvar a live</button></div>`)
        result.querySelector('[data-open-live]').addEventListener('click', () => {
          sheet.close()
          openForm('lives', null, live)
        })
      }
      if (!weekly.length && !monthly.length && !liveFields) status.textContent = 'Não reconheci esses prints. Use os da análise da live ou o de Upcoming rewards.'
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

// Resumo do mês (Key metrics e Viewer insights do período inteiro): confere e salva no mês escolhido
const MONTH_FIELDS = [
  ['diamonds', 'Diamantes'], ['rewards_usd', 'Recompensas (US$)'], ['duration_min', 'Duração (min)'], ['views', 'Visualizações'],
  ['unique_viewers', 'Espectadores únicos'], ['active_viewers', 'Espectadores ativos'], ['avg_watch_sec', 'Tempo médio (s)'],
  ['peak_viewers', 'Pico simultâneo'], ['avg_viewers', 'Média simultânea'], ['gifters', 'Presenteadores'],
  ['new_followers', 'Novos seguidores'], ['comments', 'Comentários'], ['shares', 'Compartilhamentos'], ['likes', 'Curtidas'],
]
// países de vários prints (a tela rola): o mais novo vale; "Outros" sempre por último
function mergeCountries(a = [], b = [], sameBatch = false) {
  // entre prints da mesma vez, junta (a tela rola); um print novo que já tem "Outros" é a lista inteira e substitui a salva
  const m = new Map(!sameBatch && b.some(([k]) => k === 'Others') ? [] : a)
  for (const [k, v] of b) m.set(k, v)
  return [...m].sort((x, y) => (x[0] === 'Others') - (y[0] === 'Others') || y[1] - x[1])
}
const AGE_ORDER = ['13-17', '18-24', '25-34', '35-44', '45-54', '55+']

function showMonth(result, texts) {
  const parsed = texts.map(t => parseMonth(t))
  const data = {}
  for (const p of parsed) for (const [k, v] of Object.entries(p)) {
    if (k === 'ages') data.ages = { ...data.ages, ...v }   // vários prints da mesma tela rolada se completam
    else if (k === 'countries') data.countries = mergeCountries(data.countries, v, true)
    else if (k !== 'month') data[k] = v
  }
  fixMonth(data)
  // prints de público não têm data: sem o gráfico do mês junto, vão para o mês atual
  const month = parsed.find(p => p.month)?.month || today().slice(0, 7)
  const metrics = MONTH_FIELDS.filter(([k]) => data[k] != null)
  const aud = [data.female_pct != null && `gênero ${data.female_pct}/${data.male_pct}`, data.ages && `${Object.keys(data.ages).length} faixas de idade`, data.countries && `${data.countries.length} países`].filter(Boolean)
  result.insertAdjacentHTML('beforeend', `
    <form class="card" id="m-form"><h3>Resumo do mês</h3>
      <label class="field" for="m-month"><span>Mês</span><input id="m-month" name="month" type="month" value="${month}" required></label>
      ${metrics.length ? `<div class="fields" style="box-shadow:none;padding:0">${metrics.map(([k, l]) => `<label class="field half auto" for="m-${k}"><span>${esc(l)}</span><input id="m-${k}" name="${k}" type="text" inputmode="decimal" value="${esc(int(data[k]))}"></label>`).join('')}</div>
      <p class="muted small">O TikTok arredonda o mês (2.6M, 4.1K). Se a leitura perdeu um ponto (41K no lugar de 4.1K), corrija aqui.</p>` : ''}
      ${aud.length ? `<div class="row"><span>Público</span><b>${esc(aud.join(' · '))}</b></div>` : ''}
      <button class="btn primary" type="submit">Salvar resumo</button></form>`)
  const form = result.querySelector('#m-form')
  form.addEventListener('submit', async ev => {
    ev.preventDefault()
    const btn = form.querySelector('[type=submit]')
    if (btn.disabled) return
    btn.disabled = true
    for (const [k] of metrics) { const v = num(form[k].value); if (v) data[k] = v; else delete data[k] }
    const ym = form.month.value
    // junta com o que já tinha do mês (ex.: números num dia, público no outro); o print novo substitui o antigo
    const before = summaryOf(ym) || {}
    const merged = { ...before, ...data, ...(data.ages ? { ages: { ...before.ages, ...data.ages } } : {}), ...(data.countries ? { countries: mergeCountries(before.countries, data.countries) } : {}) }
    const { error } = await sb.from('month_summaries').upsert({ month: ym, data: merged, updated_at: new Date().toISOString() }, { onConflict: 'user_id,month' })
    if (error) {
      btn.disabled = false
      return result.insertAdjacentHTML('beforeend', `<p class="small neg">Não salvou: ${esc(/month_summaries/.test(error.message) ? 'falta criar a tabela no Supabase (migração 005).' : error.message)}</p>`)
    }
    closeSheet()
    toast(`Resumo de ${monthWord(ym)} salvo`)
    reload()
  })
}

function showWeekly(result, texts) {
  // vários prints da mesma tela (rolada) se completam
  const data = Object.assign({}, ...texts.map(t => Object.fromEntries(Object.entries(parseWeekly(t)).filter(([, v]) => v != null))))
  data.week_start ??= weekStartOf()
  // a leitura não achou a porcentagem: completa com a do último print da mesma semana (dá pra corrigir abaixo)
  if (data.weekly_pct == null) {
    const prev = (state.data.snapshots || []).find(s => s.week_start === data.week_start && Number(s.weekly_pct))
    if (prev) data.weekly_pct = Number(prev.weekly_pct)
    if (data.weekly_pct && data.upcoming_usd && !data.week_diamonds) data.week_diamonds = Math.round(data.upcoming_usd / (data.weekly_pct / 100) / 0.01 / 100) * 100
  }
  const rows = [
    ['Disponível para sacar', data.available_usd != null ? usd(data.available_usd) : null],
    ['A receber da semana', data.upcoming_usd != null ? usd(data.upcoming_usd) : null],
    ['Semana', shortDate(`${data.week_start}T12:00`) + ' a ' + shortDate(new Date(weekEndOf(data.week_start) - 2 * 3600e3))],

    ['Liga', data.league || null],
    ['Dias válidos', data.valid_days_done ? 'concluída' : null],
    ['Fãs ativos', data.fans_done ? 'concluída' : null],
  ].filter(([, v]) => v)
  result.insertAdjacentHTML('beforeend', `
    <div class="card"><h3>Upcoming rewards</h3>
      ${rows.map(([k, v]) => `<div class="row"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}
      <div class="grid">
        <label class="field" for="wk-gems"><span>Diamantes da semana</span><input id="wk-gems" type="text" inputmode="numeric" value="${data.week_diamonds ? esc(int(data.week_diamonds)) : ''}" placeholder="356.900"></label>
        <label class="field" for="wk-pct"><span>Semanal (%)</span><input id="wk-pct" type="text" inputmode="decimal" value="${data.weekly_pct != null ? esc(String(data.weekly_pct).replace('.', ',')) : ''}" placeholder="11"></label>
      </div>
      ${data.weekly_pct == null ? '<p class="small neg">Não consegui ler a porcentagem: confira no print e coloque acima.</p>' : ''}
      <div class="row"><span>Dias mantidos na liga</span><b class="muted small">${data.league_days != null ? 'lido do print' : 'toque para marcar'}</b></div>
      <div class="days">${[1, 2, 3, 4, 5, 6, 7].map(d => `<button type="button" data-ld="${d}" aria-label="${d} de 7 dias">${d}</button>`).join('')}</div>
      ${data.available_usd == null ? '<p class="muted small">Não achei o saldo disponível nesse print.</p>' : ''}
      <details class="raw-box"><summary class="muted small">Ver texto lido</summary><pre>${esc(texts.join('\n=====\n'))}</pre></details>
      <button class="btn primary" type="button" data-save-week ${data.available_usd == null ? 'disabled' : ''}>Salvar semana</button></div>`)
  // dias mantidos: vem da leitura, mas dá para corrigir tocando nas bolinhas
  const paint = () => result.querySelectorAll('[data-ld]').forEach(b => {
    const on = Number(b.dataset.ld) <= (data.league_days ?? 0)
    b.classList.toggle('on', on)
  })
  result.querySelectorAll('[data-ld]').forEach(b => b.addEventListener('click', () => {
    const d = Number(b.dataset.ld)
    data.league_days = data.league_days === d ? d - 1 : d
    paint()
  }))
  paint()
  result.querySelector('[data-save-week]').addEventListener('click', async ev => {
    const g = num(result.querySelector('#wk-gems').value), p = num(result.querySelector('#wk-pct').value)
    if (p && (p < 6 || p > 13)) return toast('O semanal vai de 6% a 13%')
    data.week_diamonds = g || null
    data.weekly_pct = p || null
    if (data.weekly_pct && !data.week_diamonds && data.upcoming_usd) data.week_diamonds = Math.round(data.upcoming_usd / (data.weekly_pct / 100) / 0.01 / 100) * 100
    ev.target.disabled = true
    const { error } = await sb.from('reward_snapshots').insert(data)
    if (error) {
      ev.target.disabled = false
      // o aviso comum fica atrás da janela aberta: mostra o erro dentro dela
      return result.insertAdjacentHTML('beforeend', `<p class="small neg">Não salvou: ${esc(error.message)}</p>`)
    }
    closeSheet()
    toast('Semana atualizada')
    if (state.tab === 'rewards') reload('rewards')
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

// Sem zoom: o iPhone ignora o "user-scalable=no" da página, então o gesto de pinça é cancelado aqui
for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, e => e.preventDefault(), { passive: false })
document.addEventListener('touchmove', e => { if (e.touches.length > 1) e.preventDefault() }, { passive: false })

// ---------- Atualização automática ----------

// O GitHub Pages deixa o iPhone guardar a página por 10 minutos. Ao abrir ou voltar para o app,
// pergunta ao servidor (sem cache) qual é a versão publicada e, se mudou, abre a nova na hora.
const VERSION = '__V__'   // trocado pelo commit na publicação

async function checkUpdate() {
  if (VERSION === '__' + 'V__') return   // rodando localmente, sem versão
  if (sheet.open) return                 // não recarrega com um cadastro aberto (ex.: voltando da galeria de fotos)
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
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return
  checkUpdate()
  if (signedIn && !sheet.open) reload()   // dados frescos ao voltar para o app
})
try {
  if (sessionStorage.getItem('updated')) { sessionStorage.removeItem('updated'); setTimeout(() => toast('App atualizado'), 600) }
} catch {}
