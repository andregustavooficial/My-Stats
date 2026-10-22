import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm'

// A chave anon é pública por design; os dados são protegidos pelo RLS (supabase/schema.sql).
const SUPABASE_URL = 'https://tolmprwwnishdohhhuad.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRvbG1wcnd3bmlzaGRvaGhodWFkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI2MzA4NjEsImV4cCI6MjEwODIwNjg2MX0.iOfEVjMH8bIQNr9V6Y8CGJA4xsUWpJ0oomNnzAXtfdA'

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

const app = document.getElementById('app')
const sheet = document.getElementById('sheet')
const toastEl = document.getElementById('toast')

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const brl = v => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v) || 0)
const int = v => new Intl.NumberFormat('pt-BR').format(Number(v) || 0)
const today = () => new Date().toLocaleDateString('sv-SE')
const fmtDate = d => d ? new Date(d + 'T12:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }) : ''
const fmtDateTime = d => d ? new Date(d).toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''
const toLocalInput = iso => { const d = new Date(iso); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16) }
const hours = min => { const m = Number(min) || 0; return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}` }

const LIVE_STATUS = { planejada: 'Planejada', feita: 'Feita', cancelada: 'Cancelada' }
const VIDEO_STATUS = { ideia: 'Ideia', roteiro: 'Roteiro', gravado: 'Gravado', postado: 'Postado' }
const PAY_STATUS = { pendente: 'Pendente', pago: 'Pago' }
const PAY_KIND = { entrada: 'Entrada', saida: 'Saída' }

const ENTITIES = {
  lives: {
    table: 'lives', title: 'Lives', single: 'live', order: ['date', false],
    fields: [
      { key: 'date', label: 'Data', type: 'date', required: true, default: today },
      { key: 'duration_min', label: 'Duração (min)', type: 'int' },
      { key: 'peak_viewers', label: 'Pico de espectadores', type: 'int', half: true },
      { key: 'avg_viewers', label: 'Média de espectadores', type: 'int', half: true },
      { key: 'new_followers', label: 'Novos seguidores', type: 'int', half: true },
      { key: 'diamonds', label: 'Diamantes', type: 'int', half: true },
      { key: 'earnings', label: 'Ganhos (R$)', type: 'money' },
      { key: 'notes', label: 'Observações', type: 'textarea' },
    ],
    item: r => ({
      title: fmtDate(r.date),
      meta: [r.duration_min && hours(r.duration_min), r.peak_viewers != null && `pico ${int(r.peak_viewers)}`, r.new_followers != null && `+${int(r.new_followers)} seg.`].filter(Boolean).join(' · '),
      value: r.earnings != null ? brl(r.earnings) : '',
    }),
  },
  payments: {
    table: 'payments', title: 'Pagamentos', single: 'pagamento', order: ['date', false],
    fields: [
      { key: 'description', label: 'Descrição', type: 'text', required: true },
      { key: 'amount', label: 'Valor (R$)', type: 'money', required: true, half: true },
      { key: 'date', label: 'Data', type: 'date', required: true, default: today, half: true },
      { key: 'kind', label: 'Tipo', type: 'select', options: PAY_KIND, default: () => 'entrada', half: true },
      { key: 'status', label: 'Status', type: 'select', options: PAY_STATUS, default: () => 'pendente', half: true },
      { key: 'notes', label: 'Observações', type: 'textarea' },
    ],
    item: r => ({
      title: r.description,
      meta: `${fmtDate(r.date)} · ${PAY_STATUS[r.status]}`,
      value: `${r.kind === 'saida' ? '−' : '+'}${brl(r.amount)}`,
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

const TABS = [
  { id: 'home', label: 'Início', icon: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>' },
  { id: 'lives', label: 'Lives', icon: '<circle cx="12" cy="12" r="3"/><path d="M6.3 6.3a8 8 0 0 0 0 11.4M17.7 6.3a8 8 0 0 1 0 11.4"/>' },
  { id: 'agenda', label: 'Agenda', icon: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>' },
  { id: 'videos', label: 'Vídeos', icon: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3z"/>' },
  { id: 'payments', label: 'Grana', icon: '<rect x="2" y="6" width="20" height="13" rx="2"/><circle cx="12" cy="12.5" r="2.5"/>' },
]

const state = { tab: 'home', data: {} }

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
    <header class="top"><h1 id="title"></h1><button id="add" class="icon-btn" aria-label="Adicionar">
      <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></button></header>
    <main id="view"></main>
    <nav class="tabs">${TABS.map(t => `
      <button data-tab="${t.id}"><svg viewBox="0 0 24 24">${t.icon}</svg><span>${t.label}</span></button>`).join('')}
    </nav>`
  app.querySelector('.tabs').addEventListener('click', ev => {
    const b = ev.target.closest('button[data-tab]')
    if (b) go(b.dataset.tab)
  })
  document.getElementById('add').addEventListener('click', () => openForm(state.tab === 'home' ? 'lives' : state.tab))
  go(state.tab)
}

function go(tab) {
  state.tab = tab
  app.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab))
  document.getElementById('title').textContent = tab === 'home' ? 'Início' : ENTITIES[tab].title
  document.getElementById('add').setAttribute('aria-label', tab === 'home' ? 'Adicionar live' : `Adicionar ${ENTITIES[tab].single}`)
  window.scrollTo(0, 0)
  return tab === 'home' ? renderHome() : renderList(tab)
}

// ---------- Início ----------

async function renderHome() {
  const view = document.getElementById('view')
  view.innerHTML = '<p class="muted center">Carregando…</p>'
  const [lives, payments, videos, agenda] = await Promise.all(['lives', 'payments', 'videos', 'agenda'].map(load))
  if (state.tab !== 'home') return

  const month = today().slice(0, 7)
  const ml = lives.filter(l => l.date?.startsWith(month))
  const sum = (arr, k) => arr.reduce((s, r) => s + (Number(r[k]) || 0), 0)
  const mp = payments.filter(p => p.date?.startsWith(month) && p.status === 'pago')
  const received = sum(mp.filter(p => p.kind === 'entrada'), 'amount')
  const spent = sum(mp.filter(p => p.kind === 'saida'), 'amount')
  const pending = sum(payments.filter(p => p.status === 'pendente' && p.kind === 'entrada'), 'amount')
  const now = Date.now()
  const next = agenda.filter(a => a.status === 'planejada' && new Date(a.scheduled_at) >= now - 3600e3).slice(0, 3)
  const inProgress = videos.filter(v => v.status !== 'postado')
  const monthName = new Date().toLocaleDateString('pt-BR', { month: 'long' })

  const monthLabel = monthName[0].toUpperCase() + monthName.slice(1)

  view.innerHTML = `
    <section class="hero">
      <div class="hero-head"><span>Faturamento do mês</span><i class="pill">${esc(monthLabel)}</i></div>
      <strong>${esc(brl(sum(ml, 'earnings')))}</strong>
      <div class="gems">
        <svg viewBox="0 0 24 24"><path d="M6 3h12l4 6-10 12L2 9z"/><path d="M2 9h20M12 21L8 9l4-6 4 6z"/></svg>
        <b>${esc(int(sum(ml, 'diamonds')))}</b><span>diamantes registrados</span>
      </div>
    </section>
    <section>
      <h2>Lives em ${esc(monthName)}</h2>
      <div class="grid">
        ${stat('Lives', int(ml.length))}
        ${stat('Horas ao vivo', hours(sum(ml, 'duration_min')))}
        ${stat('Novos seguidores', int(sum(ml, 'new_followers')))}
        ${stat('Média por live', brl(ml.length ? sum(ml, 'earnings') / ml.length : 0))}
        ${stat('Pico médio', int(ml.length ? Math.round(sum(ml, 'peak_viewers') / ml.length) : 0))}
        ${stat('Público médio', int(ml.length ? Math.round(sum(ml, 'avg_viewers') / ml.length) : 0))}
      </div>
    </section>
    <section>
      <h2>Grana em ${esc(monthName)}</h2>
      <div class="grid">
        ${stat('Recebido', brl(received), 'pos')}
        ${stat('A receber', brl(pending), 'warn')}
        ${stat('Gasto', brl(spent), 'neg')}
        ${stat('Saldo', brl(received - spent), received - spent >= 0 ? 'pos' : 'neg')}
      </div>
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

// ---------- Animação ao rolar ----------

const revealer = new IntersectionObserver(entries => {
  for (const e of entries) {
    if (!e.isIntersecting) continue
    e.target.classList.add('in')
    revealer.unobserve(e.target)
  }
}, { rootMargin: '0px 0px -6% 0px' })

function reveal(root) {
  root.querySelectorAll('.hero, h2, .stat, .list li, .empty').forEach(el => {
    const i = [...el.parentElement.children].indexOf(el)
    el.classList.add('reveal')
    el.style.transitionDelay = `${Math.min(i, 5) * 50}ms`
    revealer.observe(el)
  })
}

const stat = (label, value, tone = '') => `<div class="stat ${tone}"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`
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

function openForm(name, row) {
  const e = ENTITIES[name]
  const editing = !!row
  sheet.innerHTML = `
    <form method="dialog" class="sheet-body">
      <div class="sheet-head">
        <button type="button" class="link" data-close>Cancelar</button>
        <strong>${editing ? 'Editar' : 'Nova'} ${esc(e.single)}</strong>
        <button type="submit" class="link strong">Salvar</button>
      </div>
      <div class="fields">${e.fields.map(f => input(f, editing ? row[f.key] : f.default?.() ?? '')).join('')}</div>
      ${editing ? '<button type="button" class="btn danger" data-delete>Excluir</button>' : ''}
    </form>`
  const form = sheet.querySelector('form')
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

function closeSheet() {
  sheet.classList.add('closing')
  setTimeout(() => { sheet.close(); sheet.classList.remove('closing') }, 200)
}
sheet.addEventListener('click', ev => { if (ev.target === sheet) closeSheet() })
sheet.addEventListener('cancel', ev => { ev.preventDefault(); closeSheet() })

// ---------- Início da sessão ----------

let signedIn = null
sb.auth.onAuthStateChange((_event, session) => {
  const now = !!session
  if (now === signedIn) return
  signedIn = now
  state.data = {}
  now ? renderShell() : renderLogin()
})
