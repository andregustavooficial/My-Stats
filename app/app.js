import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm'
import { parseTikTok, parseWeekly, isWeeklyPrint } from './tiktok.js'
import { readEach } from './ocr.js'
import { WITHDRAW_FEE_USD, livePct, daysPct, weekStartOf, weekEndOf, weekDays, payoutRate, ledger, monthEarned, limitFor, LIMIT_TIERS, lifetime } from './rewards.js'

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
      { key: 'title', label: 'Título da live', type: 'text' },
      { key: 'date', label: 'Data', type: 'date', required: true, default: today, half: true },
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
  { id: 'agenda', label: 'Agenda', icon: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>' },
  { id: 'videos', label: 'Vídeos', icon: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3z"/>' },
  { id: 'rewards', label: 'Recompensas', icon: '<path d="M6 3h12l4 6-10 12L2 9z"/><path d="M2 9h20"/>' },
]

const state = { tab: 'home', rtab: 'saldo', data: {}, rate: readCachedRate() }

function readCachedRate() {
  try { return JSON.parse(localStorage.getItem('usd-brl')) } catch { return null }
}

// Dólar comercial do dia (AwesomeAPI, gratuita e sem chave)
async function loadRate() {
  try {
    const res = await fetch('https://economia.awesomeapi.com.br/json/last/USD-BRL')
    const q = (await res.json()).USDBRL
    state.rate = { commercial: Number(q.bid), at: q.create_date }
    try { localStorage.setItem('usd-brl', JSON.stringify(state.rate)) } catch {}
  } catch {
    // Sem internet: segue com a última cotação salva
  }
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
  document.getElementById('title').textContent = tab === 'home' ? 'Início' : tab === 'rewards' ? 'Recompensas' : ENTITIES[tab].title
  document.getElementById('add').hidden = tab === 'rewards'
  document.getElementById('prints').hidden = !['lives', 'rewards'].includes(tab)
  if (tab !== 'rewards') document.getElementById('add').setAttribute('aria-label', tab === 'home' ? 'Adicionar live' : `Adicionar ${ENTITIES[tab].single}`)
  window.scrollTo(0, 0)
  return tab === 'home' ? renderHome() : tab === 'rewards' ? renderRewards() : renderList(tab)
}

// ---------- Início ----------

async function renderHome() {
  const view = document.getElementById('view')
  view.innerHTML = '<p class="muted center">Carregando…</p>'
  const [lives, videos, agenda, withdrawals] = await Promise.all(['lives', 'videos', 'agenda', 'withdrawals'].map(load))
  await freshRate()
  if (state.tab !== 'home') return

  const month = today().slice(0, 7)
  const ml = lives.filter(l => l.date?.startsWith(month))
  const sum = (arr, k) => arr.reduce((s, r) => s + (Number(r[k]) || 0), 0)
  const saques = withdrawals.filter(w => w.date?.startsWith(month)).length
  const now = Date.now()
  const next = agenda.filter(a => a.status === 'planejada' && new Date(a.scheduled_at) >= now - 3600e3).slice(0, 3)
  const inProgress = videos.filter(v => v.status !== 'postado')
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
      <div class="calc">${payout?.source === 'saque' ? `comercial hoje<br><b>${commercial ? esc(brl(commercial)) : '—'}</b>` : commercial ? `comercial <b>${esc(brl(commercial))}</b><br>− R$ 0,18` : 'sem conexão'}</div>
    </div>
    <section class="lifetime">
      <div class="hero-head"><span>Diamantes desde o começo</span><i class="pill">desde nov/2023</i></div>
      <strong>${esc(int(life.diamonds))}</strong>
      <div class="row"><span>Recebido no total</span><b>${esc(usd(life.usd))}</b></div>
      ${life.recentGems ? `<p class="muted small">Inclui ${esc(int(life.recentGems))} diamantes das lives registradas a partir de 19/10.</p>` : ''}
    </section>
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
    <section>
      <h2>Próximas lives</h2>
      ${next.length ? list('agenda', next) : empty('Nenhuma live planejada.', 'agenda')}
    </section>
    <section>
      <h2>Vídeos em andamento</h2>
      ${inProgress.length ? list('videos', inProgress.slice(0, 5)) : empty('Nenhum vídeo em andamento.', 'videos')}
    </section>
    <button id="logout" class="btn ghost">Sair</button>`
  bindList(view)
  reveal(view)
  document.getElementById('logout').addEventListener('click', () => sb.auth.signOut())
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
  root.querySelectorAll('.hero, .rate, .lifetime, h2, .stat, .list li, .empty').forEach(el => {
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
  else el = `<input id="${id}" name="${f.key}" type="text" value="${esc(v)}" ${req}>`
  return `<label class="field ${f.half ? 'half' : ''}" for="${id}"><span>${esc(f.label)}</span>${el}</label>`
}

function parse(f, raw) {
  const s = String(raw ?? '').trim()
  if (s === '') return null
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
    status.textContent = n ? `${filled.size} campos preenchidos. Confira antes de salvar.` : 'Não encontrei dados da live nesse texto.'
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
      apply((await readEach([...files.files], msg => { status.textContent = msg })).join('\n'))
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

    ${entries.length ? `
    <section>
      <h2>Últimas entradas</h2>
      <ul class="list">${entries.map(e => `
        <li><div class="row-item"><span>${esc(e.label)}</span><b class="pos">+${esc(usd(e.usd))}</b></div></li>`).join('')}</ul>
    </section>` : ''}`
}

function bindSaldo(view, { L }) {
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
    const { error } = await sb.from('withdrawals').insert({ amount_usd: amount, rate_brl: rate, date: form.date.value || today() })
    if (error) return toast('Erro ao registrar: ' + error.message)
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
        <div class="days">${[0, 1, 2, 3, 4, 5, 6].map(i => i < (snapThisWeek?.league_days ?? 0) ? `<i class="on">${CHECK}</i>` : '<i></i>').join('')}</div>
        <p class="muted small">${snapThisWeek?.league_days != null ? `${snapThisWeek.league_days} de 7 dias, do print de ${esc(shortDate(snapThisWeek.taken_at))}.` : 'Atualiza com o print de domingo.'} Manter A1–A3 a semana toda = 1%, superar a melhor liga = 3%.</p>
      </div>
    </div>

    <div class="card">
      <h2>Simulador</h2>
      <label class="field" for="sim-gems"><span>Se a próxima live fizer quantos diamantes?</span><input id="sim-gems" type="number" inputmode="numeric" min="0" placeholder="80000"></label>
      <div class="row"><span>Na live (40%)</span><b id="sim-live">US$ 0,00</b></div>
      <div class="row"><span>A mais no semanal</span><b id="sim-week">US$ 0,00</b></div>
      <div class="row"><span>Total em reais</span><b class="gold" id="sim-brl">${rate ? 'R$ 0,00' : '—'}</b></div>
    </div>`
}

function bindMissoes(view, { L, rate }) {
  view.querySelector('#sim-gems').addEventListener('input', ev => {
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
    ['Liga', data.league ? `${data.league}${data.league_days != null ? ` · ${data.league_days} de 7 dias` : ''}` : null],
    ['Dias válidos', data.valid_days_done ? 'concluída' : null],
    ['Fãs ativos', data.fans_done ? 'concluída' : null],
  ].filter(([, v]) => v)
  result.insertAdjacentHTML('beforeend', `
    <div class="card"><b>Upcoming rewards</b>
      ${rows.map(([k, v]) => `<div class="row"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}
      ${data.available_usd == null ? '<p class="muted small">Não achei o saldo disponível nesse print.</p>' : ''}
      <button class="btn primary" type="button" data-save-week ${data.available_usd == null ? 'disabled' : ''}>Salvar semana</button></div>`)
  result.querySelector('[data-save-week]').addEventListener('click', async ev => {
    ev.target.disabled = true
    const { error } = await sb.from('reward_snapshots').insert(data)
    if (error) { ev.target.disabled = false; return toast('Erro ao salvar: ' + error.message) }
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
