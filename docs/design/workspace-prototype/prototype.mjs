// Static design review only: no worker, transport, storage or network API.
// Live machine values come only through telemetry.mjs (the seam).
import { materials, tools, toolKinds, machine, setup, sampleFixture, operations, opById, toolById, fmtTime, advise, job, progressAt } from './job.mjs';
import { Scene } from './scene.mjs';
import { catalogue, drawMachine } from './machines.mjs';
import { snapshot, plannerHealth, features } from './telemetry.mjs';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const NS = 'http://www.w3.org/2000/svg';
function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (v == null || v === false) continue; if (k === 'class') e.className = v; else if (k === 'style') e.style.cssText = v; else if (k === 'text') e.textContent = v; else e.setAttribute(k, v === true ? '' : v); }
  for (const k of kids.flat()) if (k != null) e.append(typeof k === 'string' ? document.createTextNode(k) : k);
  return e;
}
function s(tag, attrs = {}) { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; }
const nf = (n, d = 0) => n.toLocaleString('en-GB', { minimumFractionDigits: d, maximumFractionDigits: d }).replace(/,/g, ' ');
const mmss = (sec) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;

// ---------- State ----------
const st = {
  scenario: 'idle', loaded: true, f: 1, playing: false, coolant: 'none', advOp: 'pocket',
  opTools: Object.fromEntries(operations.map((o) => [o.id, o.tool])), toolFilter: 'all', tool: 'T1',
  filter: 'all', ctab: 'wiring', against: 'backup', fwOld: false, zero: 'front-left',
};
const LIVE = new Set(['running', 'held', 'toolchange', 'lost']);
const liveF = { running: 0.35, held: 0.35, lost: 0.35, toolchange: (job.changeSeconds * 2 + opById.drill.seconds) / job.seconds - 0.0005 };
const effectiveOp = (op) => ({ ...op, tool: st.opTools[op.id] });

// ---------- Scenes ----------
const sceneState = {
  setup, machine,
  removal: () => (st.loaded ? progressAt(st.f).map(({ op, upto }) => ({ op: effectiveOp(op), upto })) : []),
  paths: () => (st.loaded ? progressAt(st.f).map(({ op, upto }) => ({ op: effectiveOp(op), upto, emphasis: (upto > 0 && upto < 1) || (st.f >= 1 && op.id === st.advOp) })) : []),
  toolAt: () => currentTool()?.pos,
  activeTool: () => currentTool()?.tool,
};
function currentTool() {
  if (!st.loaded || (st.f >= 1 && !LIVE.has(st.scenario))) return null;
  let prev = null;
  for (const { op, upto } of progressAt(st.f)) {
    if (upto > 0 && upto < 1) return { pos: op.moves[Math.floor(upto * (op.moves.length - 1))], tool: st.opTools[op.id] };
    if (upto === 0) { if (!prev) return null; const m = prev.moves.at(-1); return { pos: [m[0], m[1], 5], tool: st.opTools[prev.id] }; }
    prev = op;
  }
  return null;
}
const runScene = new Scene($('#run-canvas'), sceneState); runScene.fitTarget = 'stock';
const setupScene = new Scene($('#setup-canvas'), { ...sceneState, removal: () => [], paths: () => [], toolAt: () => null });
const projectScene = new Scene($('#project-canvas'), { ...sceneState, setup: new Proxy(setup, { get: (t, k) => (k === 'clamps' ? false : t[k]) }), removal: () => progressAt(1).map(({ op }) => ({ op: effectiveOp(op), upto: 1 })), paths: () => [], toolAt: () => null });
projectScene.compact = true; projectScene.fitTarget = 'stock'; projectScene.layers = { bed: false, fixture: false, stock: true, path: false }; projectScene.mode = 'result'; projectScene.zoom = 1.15;
projectScene.drawZero = () => {};
const scenes = [runScene, setupScene, projectScene];
const refreshScenes = (geometry = false) => { for (const sc of scenes) { if (geometry) sc.heights = null; sc.render(); } };

// ---------- Views ----------
const routeNames = ['run', 'setup', 'tools', 'configure', 'machines', 'projects', 'analyze'];
function view(name, push = true) {
  if (scenarios[name]) { setScenario(name); name = 'run'; }
  if (name === 'loaded') { loadFile(); name = 'run'; }
  if (!routeNames.includes(name)) name = 'run';
  for (const el of $$('[data-screen]')) el.hidden = el.dataset.screen !== name;
  for (const el of $$('.rail [data-view]')) el.setAttribute('aria-current', el.dataset.view === name ? 'page' : 'false');
  if (push) history.pushState(null, '', `#${name}`);
  document.title = `${name[0].toUpperCase() + name.slice(1)} — Run design preview`;
  closeMenu();
  requestAnimationFrame(() => { refreshScenes(); renderGcode(); });
}

// ---------- Toast ----------
let toastTimer;
function notify(text) { clearTimeout(toastTimer); $('#toast').textContent = text; toastTimer = setTimeout(() => { $('#toast').textContent = ''; }, 5000); }

// ---------- Scenarios ----------
const scenarios = {
  disconnected: { state: 'Not connected', pill: ['Offline', ''], text: 'Projects, setup and the preview work offline', head: 'Your machine is not connected.', copy: 'Projects, setup and the preview work offline. Connecting is a separate, signed-in step.', action: 'How connecting works' },
  identified: { state: 'Connected · read only', pill: ['Read only', 'live'], text: 'Phase 1: positions and settings are read, nothing is written', head: 'TinyG identified. Inspect before you operate.', copy: 'Phase 1 is read-only: positions and settings are read and nothing is written.', action: 'Open the board' },
  idle: { state: 'Machine idle', pill: ['Needs review', 'warn'], text: '1 setting differs from your profile', head: 'Your machine profile differs from the board.', copy: 'Motor 1 travel: your profile says 20 mm per revolution, the board reads 40. Nothing has been applied.', action: 'Review difference' },
  outdated: { state: 'Firmware out of date', pill: ['Update needed', 'warn'], text: 'Firmware 440.20 · jobs, jogging and settings changes are locked', head: 'This board runs firmware older than Run supports.', copy: 'Firmware 440.20 can connect, be viewed and backed up. Jobs, jogging and settings changes unlock after the update to 450.01.', action: 'Review the update' },
  running: { state: 'Job running', pill: ['Later phase', ''], text: '', head: '', copy: '', action: '' },
  toolchange: { state: 'Waiting for a tool change', pill: ['Job waiting', 'warn'], text: 'Stopped before line 71 · T5 to T1', head: '', copy: '', action: '' },
  held: { state: 'Paused · spindle still on', pill: ['Later phase', ''], text: '', head: '', copy: '', action: '' },
  lost: { state: 'Connection lost', pill: ['Not delivered', 'danger'], text: 'Last report 8 s ago · positions are not live', head: 'Machine state is unknown. Use the physical E-stop if needed.', copy: 'Pause and Stop stay reachable, but delivery cannot be confirmed. The positions shown are from the last report.', action: 'Recovery details' },
  orphaned: { state: 'Motion unconfirmed', pill: ['Orphaned motion', 'danger'], text: 'Position not trusted · use your E-stop if needed', head: 'A connection is not proof of a safe machine.', copy: 'Something may still be running from an earlier session. No job may start; Pause and Stop stay available.', action: 'Recovery details' },
};
function setScenario(name, { autoUpdate = true } = {}) {
  st.scenario = name; stopPlay();
  const sc = scenarios[name];
  $('.app').dataset.scenario = name; $('#scenario').value = name;
  $('#machine-state').textContent = sc.state;
  const pill = $('#state-pill'); pill.textContent = sc.pill[0]; pill.className = `pill ${sc.pill[1]}`;
  $('#state-text').textContent = sc.text;
  st.switchCheck = false;
  $('#scenario-heading').textContent = sc.head; $('#scenario-copy').textContent = sc.copy; $('#scenario-action').textContent = sc.action;
  st.fwOld = name === 'outdated'; $('.app').dataset.fw = st.fwOld ? 'old' : 'ok';
  st.loaded = name !== 'disconnected' && name !== 'orphaned';
  st.f = liveF[name] ?? 1;
  selectTab(['running', 'toolchange', 'held', 'lost'].includes(name) ? 'live' : 'gcode'); setDock(['running', 'toolchange'].includes(name));
  renderAll();
  clearTimeout(toastTimer); $('#toast').textContent = '';
  if (!$('#dialog-wrap').hidden) closeDialog();
  if (name === 'outdated' && autoUpdate) setTimeout(() => openUpdate(), 0);
}
function loadFile() { st.loaded = true; if (!LIVE.has(st.scenario)) st.f = 1; renderAll(); }

// ---------- Machine strip and Run inspector ----------
function renderStrip() {
  const sc = scenarios[st.scenario]; const pill = $('#state-pill');
  if (st.switchCheck) {
    $('#machine-state').textContent = 'Check limit switches'; pill.textContent = 'Locked'; pill.className = 'pill warn'; $('#state-text').textContent = 'The update changed the switch settings';
    $('#scenario-heading').textContent = 'Check your limit switches. The update changed the switch settings.'; $('#scenario-copy').textContent = 'Jobs and jogging stay locked until your backup is restored and every setting is read back and checked.'; $('#scenario-action').textContent = 'Restore my settings';
  } else { $('#machine-state').textContent = sc.state; pill.textContent = sc.pill[0]; pill.className = `pill ${sc.pill[1]}`; $('#state-text').textContent = sc.text; $('#scenario-heading').textContent = sc.head; $('#scenario-copy').textContent = sc.copy; $('#scenario-action').textContent = sc.action; }
  const snap = snapshot(st.scenario); const s0 = snap.status;
  $('#ro-feed').replaceChildren(s0?.vel != null ? nf(s0.vel) : '—', h('small', { text: ` / ${s0?.feed ? nf(s0.feed) : '—'}` }));
  $('#ro-spindle').replaceChildren(snap.spindle ? nf(snap.spindle.commanded) : '—', h('small', { text: ' rpm' }));
  $('#ro-coolant').textContent = snap.coolant.mist ? 'Mist' : snap.coolant.flood ? 'Flood' : 'Off';
  $('#ro-progress').textContent = `${Math.round(st.f * 100)} %`;
  const paused = ['running', 'held', 'toolchange'].includes(st.scenario);
  $('#sync-badge').dataset.sync = paused ? 'paused' : 'synced';
  $('#sync-row').dataset.sync = paused ? 'paused' : 'synced';
  $('#sync-title').textContent = paused ? 'Sync paused while a job runs' : 'All changes synced';
  $('#sync-detail').textContent = paused ? 'Your changes are kept and sync when the job ends' : 'Projects, machines, tools and backups · 2 minutes ago';
  $('#account-button').setAttribute('aria-label', `Account: Jamie Doe. ${paused ? 'Sync paused while a job runs' : 'All changes synced'}`);
  const so = $('#sign-out'); so.disabled = paused; so.textContent = paused ? 'Sign out (not while a job runs)' : 'Sign out';
}
function renderPosition() {
  const s0 = snapshot(st.scenario).status;
  const unknown = !s0 || s0.posx == null;
  const tool = currentTool();
  const work = unknown ? null : tool && LIVE.has(st.scenario) ? tool.pos : [s0.posx, s0.posy, s0.posz];
  const g = runScene.geometry(); const off = [g.stock.x, g.stock.y, g.stock.z + g.stock.t - 52];
  $$('.dro-row').forEach((row, i) => {
    row.querySelector('strong').textContent = work ? nf(work[i], 3).replace('-', '−') : '—';
    row.querySelector('span:last-child').textContent = work ? nf(work[i] + off[i], 3).replace('-', '−') : '—';
  });
  $('#pos-source').textContent = !s0 ? 'Not read' : st.scenario === 'lost' ? 'Last report · 8 s ago' : s0.age == null ? 'Not trusted' : `Live · ${s0.age} s`;
  $('#pos-tool').textContent = s0?.tool ? `T${s0.tool}, reported` : '—';
  $('#pos-homing').textContent = st.scenario === 'disconnected' ? '—' : 'Not verified';
}
function toolSelect(opId) {
  const sel = h('select', { class: 'tool-pick', 'aria-label': `Tool for ${opById[opId].name}` });
  for (const t of tools) sel.append(h('option', { value: t.id, text: `${t.id} · ${t.type === 'vbit' ? `${t.angle}° V` : t.diameter}` }));
  sel.value = st.opTools[opId];
  sel.addEventListener('change', () => { st.opTools[opId] = sel.value; renderAll(); notify(`${opById[opId].name} now uses ${toolById(sel.value).name}. The preview and the checks follow.`); });
  return h('span', { class: 'select-wrap' }, sel);
}
function renderJob() {
  const live = LIVE.has(st.scenario);
  $('#job-none').hidden = st.loaded; $('#job-body').hidden = !st.loaded;
  $('#empty-prompt').hidden = st.loaded; $('#viewer-key').hidden = !st.loaded; $('#timeline').hidden = !st.loaded;
  $('#run-title').textContent = st.loaded ? 'Mounting plate' : 'Workshop router';
  $('#run-subtitle').textContent = st.loaded ? 'mounting-plate.nc · version 3 · 3 operations · 2 tools' : 'No file open';
  $('#load-file').textContent = st.loaded ? 'Open another file' : 'Open a file';
  const ol = $('#job-ops'); ol.replaceChildren();
  for (const { op, upto } of progressAt(st.f)) {
    const cls = live && upto >= 1 ? 'done' : live && upto > 0 ? 'now' : '';
    ol.append(h('li', { class: cls }, h('span', { class: 'num', text: op.number }), h('span', { class: 'name' }, op.name, h('small', { text: live && upto > 0 && upto < 1 ? `${Math.round(upto * 100)} % · running` : live && upto >= 1 ? 'Done' : fmtTime(op.seconds) })), toolSelect(op.id)));
  }
  const m = materials[setup.stock.material];
  const sk = setup.stock;
  $('#job-stock').textContent = `${m.name.replace('Hardwood · ', '').replace(' aluminium', '')} · ${sk.shape === 'round' ? `Ø ${sk.diameter} × ${sk.thickness}` : `${sk.width} × ${sk.depth} × ${sk.thickness}`}`;
  $('#job-time').textContent = `${fmtTime(job.seconds)}, estimated`;
  $('#job-progress').hidden = !live; $('#job-start').hidden = live; $('#job-checks').hidden = live;
  $('#job-bar').style.width = `${st.f * 100}%`; $('#job-pct').textContent = `${Math.round(st.f * 100)} %`; $('#job-remaining').textContent = `${fmtTime(Math.round(job.seconds * (1 - st.f)))} left, estimated`;
  const t = { running: ['Running', 'ok'], held: ['Paused', 'warn'], toolchange: ['Waiting', 'warn'], lost: ['State unknown', 'danger'] }[st.scenario] ?? (!st.loaded ? ['No file', ''] : st.switchCheck ? ['Locked', 'warn'] : st.fwOld ? ['Locked until update', 'warn'] : ['Ready to check', '']);
  const tag = $('#job-tag'); tag.textContent = t[0]; tag.className = `tag ${t[1]}`;
  const checks = $('#job-checks'); checks.replaceChildren();
  const worst = operations.findIndex((op) => advise(effectiveOp(op), toolById(st.opTools[op.id]), sk.material, st.coolant).verdict === 'Too aggressive');
  const fits = sk.shape !== 'round' ? sk.width >= 170 && sk.depth >= 110 : sk.diameter >= 190;
  const unknownTools = job.changes.filter((c) => !toolById(c.to));
  const items = [
    ['ok', 'Fits the machine travel', 'Uses 180 × 120 of 750 × 750 mm'],
    fits ? ['ok', 'The part fits inside the stock', '10 mm margin on every side'] : ['warn', 'The part is larger than the stock', 'The cut-out needs 170 × 110 mm'],
    setup.clamps ? ['ok', 'Clears the clamps', 'Closest pass 6.4 mm from a clamp'] : null,
    unknownTools.length ? ['warn', `Tool ${unknownTools[0].to} is not in your library`, ''] : ['ok', '2 tool changes, both tools in your library', 'Run stops before each M6'],
    worst >= 0 ? ['warn', `${operations[worst].name}: too aggressive for ${m.name}`, null, 'analyze'] : ['ok', 'Feeds and speeds look reasonable', ''],
    st.zero !== 'front-left' ? ['warn', 'Work zero differs from the file', 'This file expects the front-left top corner'] : null,
    st.switchCheck ? ['warn', 'Check your limit switches. The update changed the switch settings.', null, 'update'] : null,
    st.fwOld ? ['warn', 'Update the firmware before running jobs', null, 'firmware'] : ['todo', 'Homing not verified', 'Arrives with motion control'],
  ].filter(Boolean);
  for (const [kind, text, small, link] of items) {
    const body = link ? h('button', { class: 'link', text, 'data-go': link }) : h('span', {}, text);
    checks.append(h('li', { class: kind }, h('div', {}, body, small ? h('small', { text: small }) : null)));
  }
  for (const b of $$('[data-go]', checks)) b.addEventListener('click', () => { if (b.dataset.go === 'update') openUpdate(5); else if (b.dataset.go === 'firmware') { view('configure'); selectCtab('firmware'); } else view('analyze'); });
  $('#start-job').textContent = st.fwOld ? 'Update firmware first' : st.switchCheck ? 'Check limit switches first' : 'Start job';
}
function renderSpindle() {
  const snap = snapshot(st.scenario); const sp = snap.spindle;
  // Commanded speed only: TinyG has no spindle speed sensor (MACHINING_ASSISTANT.md §6.1).
  const rpm = sp?.on ? sp.commanded : 0;
  $('#dial-value').setAttribute('stroke-dasharray', `${(rpm / machine.spindle.maxRpm) * 75} 100`);
  $('#spindle-rpm').replaceChildren(sp ? nf(rpm) : '—', h('small', { text: ' rpm commanded' }));
  $('#spindle-line').textContent = !sp ? 'Not reported' : sp.on ? `On · ${sp.dir === 'cw' ? 'clockwise' : 'counter-clockwise'}` : 'Off';
  $('#spindle-cmd').textContent = !sp ? 'No report from the controller' : sp.on ? `M3 S${sp.commanded}, after the speed clamp · no speed sensor, so not measured` : 'Last commanded: M5';
  $('#dial-dir').classList.toggle('ccw', sp?.dir === 'ccw');
  $$('.sec-spindle .seg button').forEach((b, i) => b.classList.toggle('selected', i === (sp?.on ? 1 : 0)));
  $('#mist').setAttribute('aria-pressed', String(snap.coolant.mist)); $('#flood').setAttribute('aria-pressed', String(snap.coolant.flood));
  const live = st.scenario === 'running' || st.scenario === 'held';
  for (const el of $$('.sec-overrides input, .sec-overrides button')) el.disabled = !live;
  $('#ovr-note').textContent = live ? 'Mock: the firmware has no live overrides yet, so nothing is sent. A runtime shape such as {rt:{fo:0.8}} is only under discussion.' : 'Adjust while a job runs. The firmware has no live overrides yet; this is where they will live.';
  $('#jog-note').textContent = st.switchCheck ? 'Check your limit switches. The update changed the switch settings. Jogging stays locked until they are restored and checked.' : st.fwOld ? 'Jogging is locked until this board runs firmware 450.01 or newer.' : LIVE.has(st.scenario) ? 'Jogging is not available while a job is in progress.' : 'Jogging arrives with motion control. These controls show what is coming and send nothing.';
  $('#spindle-note').textContent = st.fwOld ? 'Spindle and coolant control stay locked until the firmware update.' : 'Spindle and coolant control arrive with motion control. Coolant shows the last M7, M8 or M9 sent; the controller does not report it.';
}
function syncOverride(kind, value) { const input = $(`#ovr-${kind}`); input.value = String(value); $(`#ovr-${kind}-val`).textContent = `${input.value} %`; }
for (const kind of ['feed', 'spindle']) $(`#ovr-${kind}`).addEventListener('input', (e) => syncOverride(kind, e.target.value));
for (const b of $$('[data-ovr]')) b.addEventListener('click', () => { const i = $(`#ovr-${b.dataset.ovr}`); syncOverride(b.dataset.ovr, Math.max(+i.min, Math.min(+i.max, +i.value + +b.dataset.step))); notify('Mock override: nothing is sent. The firmware does not support live overrides yet.'); });
for (const b of $$('[data-rapid]')) b.addEventListener('click', () => { for (const x of $$('[data-rapid]')) x.classList.toggle('selected', x === b); });
$('#ovr-reset').addEventListener('click', () => { syncOverride('feed', 100); syncOverride('spindle', 100); for (const x of $$('[data-rapid]')) x.classList.toggle('selected', x.dataset.rapid === '100'); });

// ---------- Timeline, G-code, console, live ----------
function renderTimeline() {
  const track = $('#track'); track.replaceChildren();
  const live = LIVE.has(st.scenario);
  let t = st.f * job.seconds;
  for (const { op, upto, seg } of progressAt(st.f)) {
    const ch = job.changes.find((c) => c.op === op.id);
    if (ch) {
      const now = st.scenario === 'toolchange' && ch.to === 'T1'; const done = t >= job.changeSeconds && !now;
      track.append(h('span', { class: `seg-tc${done ? ' done' : ''}${now ? ' now' : ''}`, style: `flex:${job.changeSeconds}`, title: `Tool change at line ${ch.line}: ${ch.from ?? 'spindle'} to ${ch.to}`, text: ch.to }));
      t -= job.changeSeconds;
    }
    track.append(h('span', { class: 'seg-op', style: `flex:${seg.seconds}`, title: `${op.number} ${op.name}` }, h('i', { class: 'fill', style: `width:${upto * 100}%` }), h('span', { text: `${op.number} ${op.name}` })));
    t -= seg.seconds;
  }
  $('#scrub').value = String(Math.round(st.f * 1000)); $('#scrub').disabled = live;
  $('#play').hidden = live;
  $('#time-label').textContent = live ? `${mmss(st.f * job.seconds)} · live` : `${mmss(st.f * job.seconds)} / ${mmss(job.seconds)}`;
  $('#key-sim').textContent = live ? 'Progress from controller reports' : 'Simulated from the toolpath';
}
function currentLine() {
  if (st.scenario === 'toolchange') return 71;
  for (const { upto, seg } of progressAt(st.f)) if (upto > 0 && upto < 1) return Math.round(seg.start + upto * (seg.end - seg.start));
  return null;
}
const gcodeList = $('#gcode');
job.lines.forEach((text, i) => {
  const n = i + 1; const tc = job.changes.find((c) => c.line === n);
  gcodeList.append(h('li', { class: `${text.startsWith('(') ? 'comment' : ''}${tc ? ' tc' : ''}`, 'data-n': n }, h('span', { class: 'n', text: String(n) }), h('span', { class: 't', text }), tc ? h('span', { class: 'flag', text: 'Tool change: Run stops before this line' }) : h('span')));
});
function renderGcode() {
  const cur = LIVE.has(st.scenario) ? currentLine() : null;
  for (const li of gcodeList.children) { const n = +li.dataset.n; li.classList.toggle('current', n === cur); li.classList.toggle('done', cur != null && n < cur); }
  $('#dock-summary').textContent = cur ? `Line ${cur} of ${job.lines.length}` : `${job.lines.length} lines · ${job.changes.length} tool changes`;
  if (cur) { const li = gcodeList.children[cur - 1]; if (li) gcodeList.parentElement.scrollTop = Math.max(0, li.offsetTop - 60); }
}
for (const [t, text] of [
  ['09:41:02', 'Connected · TinyG · firmware 450.01 · hardware v8'], ['09:41:02', 'Identified the board in 0.4 s'], ['09:41:03', 'Read 112 settings'],
  ['09:41:03', 'Status reports every 250 ms: line, position, feed, velocity, state'], ['09:41:03', 'Planner queue reports on'], ['09:41:04', 'Machine idle · no job running'],
  ['', 'Read-only transcript. This is not a command prompt.'],
]) $('#console').append(h('li', { class: t ? '' : 'dim' }, h('time', { text: t }), h('span', { text })));
function renderLive() {
  const live = LIVE.has(st.scenario); const s0 = snapshot(st.scenario).status;
  $('#live-empty').hidden = live; $('#live-grid').hidden = !live;
  if (!live) return;
  const cur = currentLine() ?? 0; const elapsed = st.f * job.seconds;
  $('#live-pct').textContent = `${Math.round(st.f * 100)} %`;
  const opNow = progressAt(st.f).find((p) => p.upto > 0 && p.upto < 1);
  $('#live-line').textContent = st.scenario === 'toolchange' ? 'Stopped before line 71 · tool change' : `Line ${cur} of ${job.lines.length}${opNow ? ` · ${opNow.op.name}` : ''}`;
  $('#live-bar').style.width = `${st.f * 100}%`;
  $('#live-elapsed').textContent = fmtTime(Math.round(elapsed)); $('#live-remaining').textContent = fmtTime(Math.round(job.seconds - elapsed));
  $('#live-feed-num').textContent = s0?.vel != null ? `${nf(s0.vel)} / ${nf(s0.feed)}` : `— / ${nf(s0?.feed ?? 0)}`;
  const health = plannerHealth(s0?.qr, st.scenario === 'running');
  $('#live-qr').textContent = s0?.qr != null ? `${s0.qr} · ${health.label.toLowerCase()}` : 'Not reported';
  const meter = $('#qr-meter'); meter.replaceChildren(); meter.classList.toggle('starving', health.level === 'warn');
  for (let i = 0; i < 28; i++) meter.append(h('i', { class: s0?.qr != null && i < 28 - s0.qr ? 'used' : '' }));
  const svg = $('#feed-chart'); svg.replaceChildren();
  const pts = [];
  for (let i = 0; i <= 120; i++) { const ph = (i % 9) / 9; let v = ph < 0.15 ? 380 + ph * 4000 : 1390 - Math.abs(Math.sin(i * 1.7)) * 120; if (st.scenario === 'held' && i > 112) v = Math.max(0, v - (i - 112) * 190); if (st.scenario === 'toolchange' && i > 60) v = 0; if (st.scenario === 'lost' && i > 104) v = NaN; pts.push([i / 120 * 300, 70 - v / 1600 * 64]); }
  const ok = pts.filter((p) => !Number.isNaN(p[1]));
  svg.append(s('path', { class: 'area', d: `M0 70${ok.map(([x, y]) => `L${x.toFixed(1)} ${y.toFixed(1)}`).join('')}L${ok.at(-1)[0].toFixed(1)} 70Z` }));
  svg.append(s('path', { class: 'prog', d: `M0 ${70 - 1500 / 1600 * 64}H300` }));
  svg.append(s('path', { class: 'act', d: ok.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('') }));
  const ev = [
    ['05:19', '', `Line ${cur} · feed ${s0?.vel != null ? nf(s0.vel) : '—'} of 1 500 mm/min`],
    ['05:02', 'warn', ['Planner running low: ', h('strong', { text: '19 of 28 buffers free' }), ' while cutting. The 1.3 mm stepover moves finish faster than lines arrive.']],
    ['04:47', '', 'Feed averages 74 % of programmed: the stepovers are too short to reach full speed.'],
    ['04:21', '', 'Pocket started · T1 · S18000 commanded'],
    ['04:20', 'tc', 'Tool change done: T1 fitted, Z touched off. Sent T1 M6.'],
    ['02:51', 'tc', 'Stopped before line 71 for a tool change: T5 to T1.'],
    ['01:30', '', 'Drilling started · T5 · S10000 commanded'],
    ['00:00', 'tc', 'Job started · stopped before line 4 to load T5.'],
  ];
  const list = {
    toolchange: [['02:51', 'tc', 'Stopped before line 71 for a tool change: T5 to T1. Machine idle, queue empty.'], ['02:50', '', 'Drilling done · 4 holes'], ['01:30', '', 'Drilling started · T5 · S10000 commanded'], ['00:00', 'tc', 'Job started · stopped before line 4 to load T5.']],
    lost: [['05:27', 'warn', [h('strong', { text: 'No report for 8 s.' }), ' The connection is lost; the machine may still be moving.']], ...ev.slice(0, 4)],
    held: [['05:21', 'warn', ['Paused: the controller reports a hold. ', h('strong', { text: 'Spindle still on.' })]], ...ev],
  }[st.scenario] ?? ev;
  const stream = $('#live-stream'); stream.replaceChildren();
  for (const [t, cls, text] of list) stream.append(h('li', { class: cls }, h('time', { text: t }), h('span', {}, ...[text].flat())));
}
function selectTab(name) {
  for (const b of $$('.dock-tabs [role="tab"]')) b.setAttribute('aria-selected', String(b.dataset.tab === name));
  for (const p of $$('.dock-pane')) p.hidden = p.dataset.pane !== name;
}
function setDock(open) {
  $('#dock-panel').hidden = !open; $('#dock-toggle').setAttribute('aria-expanded', String(open));
  $('#dock-toggle').setAttribute('aria-label', open ? 'Collapse panel' : 'Expand panel');
  requestAnimationFrame(() => { runScene.render(); renderGcode(); });
}
for (const b of $$('.dock-tabs [role="tab"]')) b.addEventListener('click', () => { selectTab(b.dataset.tab); setDock(true); });
$('#dock-toggle').addEventListener('click', () => setDock($('#dock-panel').hidden));

// Playback of the simulated toolpath (not the machine).
let raf = null;
function stopPlay() { if (raf) cancelAnimationFrame(raf); raf = null; st.playing = false; $('#play').setAttribute('aria-pressed', 'false'); $('#play').setAttribute('aria-label', 'Play the preview'); }
$('#play').addEventListener('click', () => {
  if (st.playing) { stopPlay(); return; }
  if (st.f >= 1) st.f = 0;
  st.playing = true; $('#play').setAttribute('aria-pressed', 'true'); $('#play').setAttribute('aria-label', 'Pause the preview');
  let last = performance.now();
  const tick = (now) => { st.f = Math.min(1, st.f + (now - last) / 16000); last = now; runScene.heights = null; runScene.render(); renderTimeline(); if (st.f >= 1) { stopPlay(); renderAll(); return; } raf = requestAnimationFrame(tick); };
  raf = requestAnimationFrame(tick);
});
$('#scrub').addEventListener('input', (e) => { stopPlay(); st.f = +e.target.value / 1000; runScene.heights = null; runScene.render(); renderTimeline(); });
for (const b of $$('[data-mode]')) b.addEventListener('click', () => { runScene.mode = b.dataset.mode; for (const x of $$('[data-mode]')) x.classList.toggle('selected', x === b); runScene.render(); });
for (const b of $$('[data-camera]')) b.addEventListener('click', () => { runScene.setView(b.dataset.camera); const sel = b.dataset.camera === 'fit' ? 'iso' : b.dataset.camera; for (const x of $$('[data-camera]')) x.classList.toggle('selected', x.dataset.camera === sel); });
for (const b of $$('[data-camera2]')) b.addEventListener('click', () => { setupScene.setView(b.dataset.camera2); for (const x of $$('[data-camera2]')) x.classList.toggle('selected', x === b); });
for (const b of $$('[data-fit]')) b.addEventListener('click', () => { setupScene.fitTarget = b.dataset.fit; for (const x of $$('[data-fit]')) x.classList.toggle('selected', x === b); setupScene.render(); });

// ---------- Setup ----------
const matSelects = [$('#st-material'), $('#adv-material')];
for (const sel of matSelects) for (const [id, m] of Object.entries(materials)) sel.append(h('option', { value: id, text: m.name }));
function swatch(el) { el.style.background = `rgb(${materials[setup.stock.material].color.join(',')})`; }
function renderSetup() {
  const sk = setup.stock; const fx = setup.fixtures[0];
  for (const b of $$('[data-shape]')) b.classList.toggle('selected', b.dataset.shape === sk.shape);
  for (const f of $$('#stock-dims [data-shapes]')) f.hidden = !f.dataset.shapes.split(' ').includes(sk.shape);
  for (const sel of matSelects) sel.value = sk.material;
  swatch($('#st-swatch')); swatch($('#key-material'));
  $('#key-stock').textContent = `${materials[sk.material].name} · ${sk.shape === 'round' ? `Ø ${sk.diameter} × ${sk.thickness} mm` : `${sk.width} × ${sk.depth} × ${sk.thickness} mm`}`;
  const bedTop = setup.bed.thickness, fxTop = bedTop + fx.height, stTop = fxTop + sk.thickness;
  $('#h-bed').textContent = bedTop.toFixed(2); $('#h-fixture').textContent = fxTop.toFixed(2); $('#h-stock').textContent = stTop.toFixed(2);
  $('#z-clear').textContent = `${(machine.travel.z - (stTop - bedTop) - 25).toFixed(1)} mm`;
  const plate = fx.outline ? fx : { ...fx, ...sampleFixture() };
  const w = sk.shape === 'round' ? sk.diameter : sk.width, d = sk.shape === 'round' ? sk.diameter : sk.depth;
  const fits = sk.x >= plate.x && sk.y >= plate.y && sk.x + w <= plate.x + plate.width && sk.y + d <= plate.y + plate.depth;
  const tag = $('#stock-fit'); tag.textContent = fits ? 'Sits on the fixture' : 'Overhangs the fixture'; tag.className = `tag ${fits ? 'ok' : 'warn'}`;
  $('#clamps-toggle').setAttribute('aria-pressed', String(setup.clamps)); $('#clamps-toggle').textContent = setup.clamps ? '4 clamps' : 'No clamps';
  const thumb = $('#fixture-thumb'); thumb.replaceChildren(); thumb.setAttribute('viewBox', `-6 -6 ${plate.width + 12} ${plate.depth + 12}`);
  thumb.append(s('path', { class: 'ol', d: plate.outline.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${(plate.depth - y).toFixed(1)}`).join('') + 'Z' }));
  for (const [x, y, r] of plate.holes) thumb.append(s('circle', { cx: x, cy: plate.depth - y, r: Math.max(r, 2) }));
}
function bindNum(id, apply, allowZero = false) { $(id).addEventListener('input', (e) => { const v = parseFloat(e.target.value); if (!Number.isFinite(v) || (!allowZero && v <= 0)) return; apply(v); renderSetup(); renderJob(); refreshScenes(true); }); }
bindNum('#st-width', (v) => { setup.stock.width = v; }); bindNum('#st-depth', (v) => { setup.stock.depth = v; }); bindNum('#st-diameter', (v) => { setup.stock.diameter = v; });
bindNum('#st-thick', (v) => { setup.stock.thickness = v; }); bindNum('#st-x', (v) => { setup.stock.x = v; }, true); bindNum('#st-y', (v) => { setup.stock.y = v; }, true);
bindNum('#fx-height', (v) => { setup.fixtures[0].height = v; }, true); bindNum('#fx-x', (v) => { setup.fixtures[0].x = v; }, true); bindNum('#fx-y', (v) => { setup.fixtures[0].y = v; }, true);
bindNum('#bed-w', (v) => { setup.bed.width = v; }); bindNum('#bed-d', (v) => { setup.bed.depth = v; }); bindNum('#bed-t', (v) => { setup.bed.thickness = v; });
for (const b of $$('[data-shape]')) b.addEventListener('click', () => { setup.stock.shape = b.dataset.shape; if (b.dataset.shape === 'sheet') { setup.stock.thickness = 3; setup.stock.width = 280; setup.stock.depth = 190; setup.stock.x = 170; setup.stock.y = 125; } else if (b.dataset.shape === 'block') { setup.stock.thickness = 6.35; setup.stock.width = 180; setup.stock.depth = 120; setup.stock.x = 220; setup.stock.y = 160; } else { setup.stock.thickness = 12; setup.stock.x = 235; setup.stock.y = 145; } for (const [id, k] of [['#st-thick', 'thickness'], ['#st-width', 'width'], ['#st-depth', 'depth'], ['#st-x', 'x'], ['#st-y', 'y']]) $(id).value = String(setup.stock[k]); renderSetup(); renderJob(); refreshScenes(true); });
for (const sel of matSelects) sel.addEventListener('change', () => { setup.stock.material = sel.value; renderSetup(); renderJob(); renderAnalyze(); refreshScenes(true); });
for (const b of $$('[data-zero]')) b.addEventListener('click', () => { st.zero = b.dataset.zero; for (const x of $$('[data-zero]')) x.setAttribute('aria-checked', String(x === b)); renderJob(); });
for (const b of $$('.zero-pick .seg button')) b.addEventListener('click', () => { for (const x of $$('.zero-pick .seg button')) x.classList.toggle('selected', x === b); });
$('#clamps-toggle').addEventListener('click', () => { setup.clamps = !setup.clamps; renderSetup(); renderJob(); refreshScenes(); });

// DXF / SVG fixture import: a small local parser (no HTML parsing sinks).
function parseDXF(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()); const polys = []; const circles = [];
  for (let i = 0; i < lines.length - 1; i += 2) {
    const val = lines[i + 1];
    if (lines[i] === '0' && (val === 'LWPOLYLINE' || val === 'CIRCLE')) {
      const ent = { pts: [], x: 0, y: 0, r: 0 }; let j = i + 2; let px = null;
      while (j < lines.length - 1 && lines[j] !== '0') { const c = lines[j], v = parseFloat(lines[j + 1]); if (val === 'LWPOLYLINE') { if (c === '10') px = v; if (c === '20' && px != null) { ent.pts.push([px, v]); px = null; } } else { if (c === '10') ent.x = v; if (c === '20') ent.y = v; if (c === '40') ent.r = v; } j += 2; }
      if (val === 'LWPOLYLINE' && ent.pts.length > 2) polys.push(ent.pts); if (val === 'CIRCLE' && ent.r > 0) circles.push([ent.x, ent.y, ent.r]);
      i = j - 2;
    }
  }
  return { polys, circles };
}
function parseSVG(text) {
  const polys = []; const circles = [];
  const num = (tag, a) => { const m = new RegExp(`\\s${a}="([-\\d.]+)`).exec(tag); return m ? parseFloat(m[1]) : 0; };
  for (const m of text.matchAll(/<rect\b[^>]*>/g)) { const x = num(m[0], 'x'), y = num(m[0], 'y'), w = num(m[0], 'width'), hh = num(m[0], 'height'); if (w && hh) polys.push([[x, y], [x + w, y], [x + w, y + hh], [x, y + hh]]); }
  for (const m of text.matchAll(/<circle\b[^>]*>/g)) circles.push([num(m[0], 'cx'), num(m[0], 'cy'), num(m[0], 'r')]);
  for (const m of text.matchAll(/<(?:polygon|polyline)\b[^>]*points="([^"]+)"/g)) { const v = m[1].trim().split(/[\s,]+/).map(Number); const pts = []; for (let i = 0; i + 1 < v.length; i += 2) pts.push([v[i], v[i + 1]]); if (pts.length > 2) polys.push(pts); }
  for (const m of text.matchAll(/<path\b[^>]*\sd="([^"]+)"/g)) {
    const pts = []; let cx = 0, cy = 0;
    for (const c of m[1].matchAll(/([MLHVZmlhvz])([^MLHVZmlhvz]*)/g)) {
      const v = c[2].trim().split(/[\s,]+/).filter(Boolean).map(Number); const k = c[1];
      if (k === 'M' || k === 'L') for (let i = 0; i + 1 < v.length; i += 2) { cx = v[i]; cy = v[i + 1]; pts.push([cx, cy]); }
      if (k === 'm' || k === 'l') for (let i = 0; i + 1 < v.length; i += 2) { cx += v[i]; cy += v[i + 1]; pts.push([cx, cy]); }
      if (k === 'H') { cx = v[0]; pts.push([cx, cy]); } if (k === 'V') { cy = v[0]; pts.push([cx, cy]); }
      if (k === 'h') { cx += v[0]; pts.push([cx, cy]); } if (k === 'v') { cy += v[0]; pts.push([cx, cy]); }
    }
    if (pts.length > 2) polys.push(pts);
  }
  const maxY = Math.max(0, ...polys.flat().map((p) => p[1]), ...circles.map((c) => c[1] + c[2]));
  return { polys: polys.map((p) => p.map(([x, y]) => [x, maxY - y])), circles: circles.filter((c) => c[2] > 0).map(([x, y, r]) => [x, maxY - y, r]) };
}
export function importFixture(name, text) {
  const isSvg = /\.svg$/i.test(name) || text.trimStart().startsWith('<');
  const { polys, circles } = isSvg ? parseSVG(text) : parseDXF(text);
  if (!polys.length) { $('#upload-status').textContent = `No closed outline found in ${name}. Supported: polylines, rectangles, polygons and simple paths.`; return false; }
  const area = (p) => Math.abs(p.reduce((a, [x, y], i) => { const [x2, y2] = p[(i + 1) % p.length]; return a + x * y2 - x2 * y; }, 0) / 2);
  const outline = polys.sort((a, b) => area(b) - area(a))[0];
  const minx = Math.min(...outline.map((p) => p[0])), miny = Math.min(...outline.map((p) => p[1]));
  const fx = setup.fixtures[0];
  fx.outline = outline.map(([x, y]) => [x - minx, y - miny]); fx.holes = circles.map(([x, y, r]) => [x - minx, y - miny, r]);
  fx.width = Math.max(...fx.outline.map((p) => p[0])); fx.depth = Math.max(...fx.outline.map((p) => p[1]));
  fx.source = name; fx.name = name.replace(/\.(dxf|svg)$/i, '').replace(/[-_]/g, ' ');
  $('#fixture-name').textContent = fx.name; const holes = `${fx.holes.length} hole${fx.holes.length === 1 ? '' : 's'}`;
  $('#fixture-meta').textContent = `${name} · ${Math.round(fx.width)} × ${Math.round(fx.depth)} mm · ${holes}`;
  $('#upload-status').textContent = `Read ${name}: one outline and ${holes}, at ${fx.height} mm high. Drawing units are taken as millimetres.`;
  renderSetup(); renderJob(); refreshScenes(true); return true;
}
$('#fixture-file').addEventListener('change', async (e) => { const file = e.target.files?.[0]; if (file) importFixture(file.name, await file.text()); });

// ---------- Tools ----------
function drawTool(svg, tool, { dims = false } = {}) {
  svg.replaceChildren(); svg.classList.add('tool-art');
  const D = tool.diameter, sh = tool.shank, FL = tool.fluteLength, OL = tool.overall, r = D / 2, rs = sh / 2;
  const tipLen = tool.type === 'vbit' ? (r - 0.3) / Math.tan(tool.angle / 2 * Math.PI / 180) : tool.type === 'drill' ? r / Math.tan(59 * Math.PI / 180) : tool.type === 'ball' ? r : 0;
  const y0 = OL - FL, y1 = OL;
  svg.append(s('rect', { class: 'shank', x: -rs, y: 0, width: sh, height: y0 + 0.01, rx: 0.3 }));
  const body = tool.type === 'vbit' ? `M${-r} ${y0}H${r}V${y1 - tipLen}L0.3 ${y1}H-0.3L${-r} ${y1 - tipLen}Z`
    : tool.type === 'drill' ? `M${-r} ${y0}H${r}V${y1 - tipLen}L0 ${y1}L${-r} ${y1 - tipLen}Z`
      : tool.type === 'ball' ? `M${-r} ${y0}H${r}V${y1 - r}A${r} ${r} 0 0 1 ${-r} ${y1 - r}Z` : `M${-r} ${y0}H${r}V${y1}H${-r}Z`;
  svg.append(s('path', { class: 'body', d: body }));
  const pitch = Math.max(D * 1.4, 3); const fl = [];
  for (let y = y0 + pitch * 0.3; y < y1 - tipLen - pitch * 0.45; y += pitch / tool.flutes) fl.push(`M${-r} ${y.toFixed(2)}L${r} ${(y + pitch * 0.45).toFixed(2)}`);
  if (tool.type !== 'vbit') svg.append(s('path', { class: 'flute', d: fl.join('') }));
  if (tool.type === 'vbit') svg.append(s('path', { class: 'flute', d: `M${-r * 0.4} ${y0 + 1}L0 ${y1 - 0.6}` }));
  let vb;
  if (dims) {
    // Lay the tool on its side for the detail drawing: shank left, tip right.
    const inner = [...svg.childNodes]; const g = s('g', { transform: 'rotate(-90)' }); g.append(...inner); svg.append(g);
    const fs = 2.6; const top = -Math.max(D, sh) / 2 - 3.5, bot = Math.max(D, sh) / 2 + 3.5;
    const tx = (t, x, y, anchor = 'middle') => { const e = s('text', { x, y, 'text-anchor': anchor, 'font-size': fs }); e.textContent = t; return e; };
    // In rotated space: length runs along +x from -OL (shank end) to 0 (tip)... compute directly instead.
    svg.replaceChildren();
    const hg = s('g', {});
    hg.append(s('rect', { class: 'shank', x: 0, y: -rs, width: y0 + 0.01, height: sh, rx: 0.3 }));
    const bodyH = tool.type === 'vbit' ? `M${y0} ${-r}V${r}H${y1 - tipLen}L${y1} 0.3V-0.3L${y1 - tipLen} ${-r}Z`
      : tool.type === 'drill' ? `M${y0} ${-r}V${r}H${y1 - tipLen}L${y1} 0L${y1 - tipLen} ${-r}Z`
        : tool.type === 'ball' ? `M${y0} ${-r}V${r}H${y1 - r}A${r} ${r} 0 0 0 ${y1 - r} ${-r}Z` : `M${y0} ${-r}V${r}H${y1}V${-r}Z`;
    hg.append(s('path', { class: 'body', d: bodyH }));
    const flH = []; for (let x = y0 + pitch * 0.3; x < y1 - tipLen - pitch * 0.45; x += pitch / tool.flutes) flH.push(`M${x.toFixed(2)} ${-r}L${(x + pitch * 0.45).toFixed(2)} ${r}`);
    if (tool.type !== 'vbit') hg.append(s('path', { class: 'flute', d: flH.join('') }));
    hg.append(s('path', { class: 'dim', d: `M0 ${top + 1.5}V${top - 1}M${y1} ${top + 1.5}V${top - 1}M0 ${top}H${y1}M${y0} ${bot - 1.5}V${bot + 1}M${y0} ${bot}H${y1}M${y1} ${bot - 1.5}V${bot + 1}M${y1 + 2} ${-r}H${y1 + 5}M${y1 + 2} ${r}H${y1 + 5}M${y1 + 4} ${-r}V${r}` }));
    hg.append(tx(`${OL} mm overall`, y1 / 2, top - 1.6), tx(`${FL} mm cutting length`, (y0 + y1) / 2, bot + 3.6), tx(tool.type === 'vbit' ? `${tool.angle}°, Ø ${D}` : `Ø ${D}`, y1 + 5.6, 1, 'start'));
    svg.append(hg);
    vb = [-3, top - 5.5, y1 + 18, bot - top + 11];
  } else { const W = Math.max(D, sh) / 2 + 0.8; vb = [-W, -0.5, W * 2, OL + 1]; }
  svg.setAttribute('viewBox', vb.map((v) => v.toFixed(2)).join(' '));
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
}
function renderTools() {
  const body = $('#tool-rows'); body.replaceChildren();
  for (const t of tools) {
    if (st.toolFilter !== 'all' && t.type !== st.toolFilter) continue;
    const art = s('svg', { 'aria-hidden': 'true' }); drawTool(art, t);
    const used = operations.filter((o) => st.opTools[o.id] === t.id).map((o) => o.number).join(', ');
    const sync = s('svg', { viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5', 'aria-hidden': 'true' }); sync.append(s('path', { d: 'M4.5 12.5h7a3 3 0 0 0 .4-6A4 4 0 0 0 4.3 7a2.8 2.8 0 0 0 .2 5.5Z' }), s('path', { d: t.synced ? 'm6.2 9.4 1.4 1.4 2.6-2.6' : 'M8 7.5v3' }));
    const tr = h('tr', { 'aria-selected': String(st.tool === t.id), tabindex: '0' },
      h('td', { class: 't-art' }, art),
      h('td', {}, h('strong', { text: `${t.id} · ${t.name}` }), h('small', { text: `${toolKinds[t.type]} · ${t.vendor}` })),
      h('td', { class: 'num', text: t.type === 'vbit' ? `${t.angle}° · ${t.diameter}` : `${t.diameter} mm` }),
      h('td', { class: 'num', text: String(t.flutes) }),
      h('td', {}, t.material, h('small', { text: ` · ${t.coating}` })),
      h('td', { class: 'used', text: used ? `Operation ${used}` : '—' }),
      h('td', { class: `sync${t.synced ? '' : ' pending'}`, title: t.synced ? 'Synced' : 'Waiting to sync' }, sync, h('span', { class: 'sr-only', text: t.synced ? 'Synced' : 'Waiting to sync' })));
    const pick = () => { st.tool = t.id; renderTools(); };
    tr.addEventListener('click', pick); tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
    body.append(tr);
  }
  const t = toolById(st.tool);
  $('#tool-title').textContent = `${t.id} · ${t.name}`;
  drawTool($('#tool-drawing'), t, { dims: true });
  $('#tl-dia').value = t.diameter; $('#tl-flutes').value = t.flutes; $('#tl-flute').value = t.fluteLength; $('#tl-overall').value = t.overall; $('#tl-material').value = t.material; $('#tl-coating').value = t.coating;
  const used = $('#tool-used'); used.replaceChildren();
  const ops = operations.filter((o) => st.opTools[o.id] === t.id);
  used.append(h('div', {}, h('dt', { text: 'Used in' }), h('dd', { text: ops.length ? ops.map((o) => `${o.number} ${o.name}`).join(', ') : 'No operation in this job' })));
  used.append(h('div', {}, h('dt', { text: 'Sync' }), h('dd', { text: t.synced ? 'Synced to your account' : 'Waiting to sync' })));
  const slots = $('#slot-table tbody'); slots.replaceChildren();
  for (const row of snapshot(st.scenario).toolTable) slots.append(h('tr', {}, h('td', { text: String(row.slot) }), h('td', { text: row.tool }), h('td', { text: `${row.length} mm` })));
  for (const svg of $$('.tool-mini')) drawTool(svg, toolById(svg.dataset.tool));
}
for (const b of $$('[data-tool-filter]')) b.addEventListener('click', () => { st.toolFilter = b.dataset.toolFilter; for (const x of $$('[data-tool-filter]')) x.classList.toggle('selected', x === b); renderTools(); });
for (const [id, key, num] of [['#tl-dia', 'diameter', true], ['#tl-flutes', 'flutes', true], ['#tl-flute', 'fluteLength', true], ['#tl-overall', 'overall', true], ['#tl-material', 'material'], ['#tl-coating', 'coating']]) {
  $(id).addEventListener('change', (e) => { const t = toolById(st.tool); const v = num ? parseFloat(e.target.value) : e.target.value; if (num && !(v > 0)) return; t[key] = v; t.synced = false; renderTools(); renderAnalyze(); renderJob(); refreshScenes(true); notify('Changed in this preview’s memory. In the app the library syncs to your account.'); });
}

// ---------- Machines ----------
function renderMachines() {
  const grid = $('#library-grid'); grid.replaceChildren();
  const q = $('#machine-search').value.trim().toLowerCase();
  for (const m of catalogue) {
    if (q && !m.name.toLowerCase().includes(q)) continue;
    if (st.filter !== 'all' && m.drive !== st.filter && m.drive !== 'any') continue;
    const art = s('svg', { 'aria-hidden': 'true' });
    grid.append(h('article', { class: 'machine-card', 'data-machine': m.name },
      h('div', { class: 'machine-art' }, art, h('span', { class: 'tag drive', text: m.drive === 'belt' ? 'Belt drive' : m.drive === 'screw' ? 'Screw drive' : 'Any drive' })),
      h('div', { class: 'card-body' }, h('h3', { text: m.name }), h('p', { text: m.blurb }), h('p', { class: 'meta', text: `${m.size} · ${m.note}` }),
        h('div', { class: 'card-bottom' }, h('span', { class: 'fine', text: m.id === 'custom' ? 'Nothing assumed' : 'Source review pending' }), h('button', { class: `small${m.id === 'custom' ? ' primary' : ''}`, 'data-fork': m.name, text: m.id === 'custom' ? 'Describe your machine' : 'Make a copy' })))));
    drawMachine(art, m.id);
  }
  for (const b of $$('[data-fork]', grid)) b.addEventListener('click', () => dialog(b.dataset.fork === 'Custom machine' ? 'custom' : 'fork', b.dataset.fork));
}
$('#machine-search').addEventListener('input', renderMachines);
for (const b of $$('[data-filter]')) b.addEventListener('click', () => { st.filter = b.dataset.filter; for (const x of $$('[data-filter]')) x.classList.toggle('selected', x === b); renderMachines(); });
drawMachine($('#my-machine-art'), 'xcarve');

// ---------- Projects ----------
function renderProjects() {
  const list = $('#op-list'); list.replaceChildren();
  for (const op of operations) list.append(h('div', { class: 'op-row' }, h('span', { class: 'num', text: op.number }), h('div', {}, h('strong', { text: op.name }), h('small', { text: `${op.gcode.length} lines · ${op.coolant === 'none' ? 'no coolant' : op.coolant}` })), toolSelect(op.id), h('span', { class: 'time', text: fmtTime(op.seconds) }), h('button', { class: 'small', 'data-operation': op.id, text: 'Inspect' })));
  for (const b of $$('[data-operation]', list)) b.addEventListener('click', () => { st.advOp = b.dataset.operation; loadFile(); view('run'); });
}
$('[data-operation="open"]').addEventListener('click', () => { loadFile(); view('run'); });

// ---------- Analyze ----------
function renderAnalyze() {
  const rows = $('#advisor-rows'); rows.replaceChildren();
  $('#m-length').textContent = `${(operations.reduce((a, o) => a + o.length, 0) / 1000).toFixed(1)} m`; $('#m-time').textContent = fmtTime(job.seconds);
  for (const op0 of operations) {
    const op = effectiveOp(op0); const tool = toolById(op.tool); const a = advise(op, tool, setup.stock.material, st.coolant);
    const hot = (w) => (a.findings.some((f) => f.text.startsWith(w)) ? 'hot' : '');
    const tr = h('tr', { 'aria-selected': String(st.advOp === op.id), tabindex: '0' },
      h('td', {}, `${op.number} ${op.name}`), h('td', { text: tool.id }), h('td', { class: hot('Chip'), text: `${nf(op.feed)} mm/min` }), h('td', { text: `${nf(op.rpm)} rpm` }),
      h('td', { class: hot('Depth'), text: `${op.doc} mm` }), h('td', { class: hot('Chip'), text: `${a.fz.toFixed(3)} mm` }), h('td', { class: hot('Removal'), text: `${a.mrr.toFixed(1)} cm³/min` }),
      h('td', {}, h('span', { class: `tag ${a.verdict === 'Too aggressive' ? 'warn' : a.verdict === 'Check' ? '' : 'ok'}`, text: a.verdict })));
    const pick = () => { st.advOp = op.id; renderAnalyze(); };
    tr.addEventListener('click', pick); tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') pick(); });
    rows.append(tr);
  }
  const op = effectiveOp(opById[st.advOp]); const tool = toolById(op.tool); const a = advise(op, tool, setup.stock.material, st.coolant);
  const m = materials[setup.stock.material];
  const det = $('#advisor-detail'); det.replaceChildren();
  const ul = h('ul', { class: 'findings' });
  for (const f of a.findings) ul.append(h('li', { class: f.level, text: f.text }));
  if (!a.findings.length) ul.append(h('li', { class: 'medium', text: 'Nothing stands out for this combination. Listen to the cut and check the first pass.' }));
  const left = h('div', {}, h('h3', { text: `${tool.diameter} mm ${toolKinds[tool.type].toLowerCase()} in ${m.name}, ${nf(op.feed)} mm/min, ${op.doc} mm deep, ${st.coolant === 'none' ? 'no coolant' : st.coolant}` }), ul);
  const right = h('div', { class: 'suggest' });
  if (a.suggestion) {
    const sg = a.suggestion;
    right.append(h('h3', { text: 'A safer starting point' }), h('dl', {},
      h('div', {}, h('dt', { text: 'Feed' }), h('dd', {}, h('s', { text: nf(op.feed) }), `${nf(sg.feed)} mm/min`)),
      h('div', {}, h('dt', { text: 'Depth per pass' }), h('dd', {}, h('s', { text: String(op.doc) }), `${sg.doc} mm × ${sg.passes}`)),
      h('div', {}, h('dt', { text: 'Coolant' }), h('dd', { text: sg.coolant })),
      h('div', {}, h('dt', { text: 'Removal rate' }), h('dd', { text: `${sg.mrr.toFixed(1)} cm³/min` }))),
    h('button', { class: 'small', disabled: true, text: 'Make a revised copy' }), h('p', { class: 'fine', text: 'Makes a new file version for you to review; it never edits an armed file. Arrives with the analysis engine.' }));
  } else right.append(h('h3', { text: 'No change suggested' }), h('p', { class: 'fine', text: 'Values are rules of thumb for a hobby router. They are estimates, not a guarantee and not a machining prescription.' }));
  det.append(left, right);
  const cl = $('#change-list'); cl.replaceChildren();
  for (const c of job.changes) cl.append(h('li', {}, h('code', { text: `line ${c.line}` }), h('span', { text: `${c.from ?? 'T1 in the spindle'} to ${c.to} · ${toolById(c.to)?.name ?? 'unknown tool'}` }), h('span', { class: `tag ${c.known ? 'ok' : 'warn'}`, text: c.known ? 'In library' : 'Not in library' })));
  cl.append(h('li', {}, h('code', { text: 'pre-scan' }), h('span', { text: 'Run stops before each M6, waits for idle with an empty queue, then shows the tool-change card' }), h('span')));
  const svg = $('#plan-chart'); svg.replaceChildren(); const W = 600, top = 14, bot = 128;
  for (const y of [top, (top + bot) / 2, bot]) svg.append(s('path', { class: 'grid', d: `M0 ${y}H${W}` }));
  let t = 0; const yv = (f) => bot - f / 1600 * (bot - top); let d = `M0 ${bot}`;
  for (const seg of job.segments) {
    const ch = job.changes.find((c) => c.op === seg.op); const o = opById[seg.op];
    if (ch) { const x = t / job.seconds * W; svg.append(s('path', { class: 'tc', d: `M${x.toFixed(1)} ${top}V${bot}` })); const tx = s('text', { x: x + 4, y: top + 10 }); tx.textContent = `${ch.to} change`; svg.append(tx); t += job.changeSeconds; d += `L${(t / job.seconds * W).toFixed(1)} ${bot}`; }
    const x0 = t / job.seconds * W, x1 = (t + seg.seconds) / job.seconds * W;
    for (let i = 0; i <= 30; i++) { const xx = x0 + (x1 - x0) * i / 30; const v = seg.op === 'drill' ? (i % 4 < 2 ? o.plunge * 3 : 0) : o.feed * (i % 5 === 0 ? 0.55 : 0.92); d += `L${xx.toFixed(1)} ${yv(v).toFixed(1)}`; }
    const lab = s('text', { x: x0 + 4, y: bot + 16 }); lab.textContent = `${o.number} ${o.name}`; svg.append(lab);
    t += seg.seconds;
  }
  d += `L${W} ${bot}`;
  svg.append(s('path', { class: 'feedfill', d: `${d}Z` }), s('path', { class: 'feed', d }));
}
for (const b of $$('[data-coolant]')) b.addEventListener('click', () => { st.coolant = b.dataset.coolant; for (const x of $$('[data-coolant]')) x.classList.toggle('selected', x === b); renderAnalyze(); renderJob(); });

// ---------- Board: wiring, firmware, backups ----------
function selectCtab(name) {
  st.ctab = name;
  for (const b of $$('[data-ctab]')) b.setAttribute('aria-selected', String(b.dataset.ctab === name));
  for (const p of $$('[data-cpane]')) p.hidden = p.dataset.cpane !== name;
}
for (const b of $$('[data-ctab]')) b.addEventListener('click', () => selectCtab(b.dataset.ctab));
for (const g of $$('.pins')) { const x = +g.dataset.x, y = +g.dataset.y, n = +g.dataset.n, r = +g.dataset.r; const step = n === 6 ? 22 : 23; for (let i = 0; i < n; i++) g.append(s('circle', { cx: x + i * step, cy: y, r, class: 'contact' }), s('path', { d: `m${x + i * step - 3} ${y}h6`, stroke: '#4c5d59' })); }

const releases = [
  { v: '450.01', date: '18 Oct 2026', title: 'Planner reports and faster status', notes: ['Planner queue reports on by default', 'Status reports down to every 100 ms', 'Fix: Z soft limit after homing'], rec: true },
  { v: '449.12', date: '2 Aug 2026', title: 'Homing and input fixes', notes: ['Switch debounce is configurable', 'Fix: a limit switch could re-trigger during back-off'] },
  { v: '445.03', date: '9 Jan 2026', title: 'Arc accuracy', notes: ['Smoother small-radius arcs', 'The status report includes the active tool'] },
  { v: '440.20', date: '14 Mar 2025', title: 'Long-term release', notes: ['The last release before the planner report change'] },
];
function renderFirmware() {
  const installed = st.fwOld ? '440.20' : '450.01';
  $('#fw-version').textContent = `Firmware ${installed}`;
  $('#fw-detail').textContent = 'TinyG · hardware version 8 · board TG-8-0412 · read when connected';
  const status = $('#fw-status'); status.textContent = st.fwOld ? 'Older than supported' : 'Up to date'; status.className = `pill ${st.fwOld ? 'warn' : 'ok'}`;
  $('#fw-flag').hidden = !st.fwOld;
  $('#fw-lede').textContent = st.fwOld ? 'Run supports 450.01 and newer. This board can connect, be viewed and backed up; jobs, jogging and settings changes stay locked until it is updated.' : 'This board runs the recommended release. You can still review the steps.';
  $('#open-update').textContent = st.fwOld ? 'Update to 450.01' : 'Review the update steps';
  const ol = $('#releases'); ol.replaceChildren();
  for (const r of releases) {
    const ver = h('div', { class: 'rel-ver' }, h('strong', { text: r.v }), h('small', { text: r.date }));
    if (r.rec) ver.append(h('span', { class: 'tag ok', text: 'Recommended' }));
    if (r.v === installed && !r.rec) ver.append(h('span', { class: 'tag', text: 'On this board' }));
    ol.append(h('li', {}, ver, h('div', { class: 'rel-notes' }, h('h3', { text: r.title }), h('ul', {}, ...r.notes.map((n) => h('li', { text: n }))), h('p', { class: 'installed', text: `Example notes · signed build for hardware v8${r.v === installed ? ' · on this board' : ''}` }))));
  }
}
$('#open-update').addEventListener('click', () => openUpdate());

const backups = [
  { id: 'b4', when: 'Today 09:12', fw: '450.01', why: 'Before update', n: 112 },
  { id: 'b3', when: '12 Oct 18:40', fw: '449.12', why: 'Taken by hand', n: 112 },
  { id: 'b2', when: '3 Aug 10:05', fw: '449.12', why: 'Before update', n: 110 },
  { id: 'b1', when: '14 Mar 2025', fw: '440.20', why: 'First connection', n: 108 },
];
const picked = new Set(['b4', 'b3']);
const diffs = {
  backup: [['X maximum speed', 'xvm', '16000', '12000'], ['Motor 1 travel per rev', '1tr', '40', '40.08'], ['Status report interval', 'si', '250', '100']],
  live: [['Motor 1 travel per rev', '1tr', '40.08', '40'], ['Switch type', 'st', 'NC', 'NO']],
};
function renderBackups() {
  const body = $('#backup-rows'); body.replaceChildren();
  for (const b of backups) {
    const cb = h('input', { type: 'checkbox', class: 'cmp', 'aria-label': `Compare the backup from ${b.when}` }); cb.checked = picked.has(b.id);
    cb.addEventListener('change', () => { if (cb.checked) { picked.add(b.id); if (picked.size > 2) picked.delete([...picked][0]); } else picked.delete(b.id); renderBackups(); });
    body.append(h('tr', { class: picked.has(b.id) ? 'picked' : '' }, h('td', {}, cb), h('td', { text: b.when }), h('td', { class: 'mono', text: b.fw }), h('td', { text: b.why }), h('td', { class: 'mono', text: String(b.n) })));
  }
  const rows = diffs[st.against]; const tb = $('#diff-table tbody'); tb.replaceChildren();
  for (const [name, key, a, b] of rows) tb.append(h('tr', {}, h('td', {}, h('strong', { text: name }), h('small', { text: key })), h('td', { class: 'old', text: a }), h('td', { class: 'new', text: b })));
  $('#diff-count').textContent = `${rows.length} differences`;
  const sel = backups.filter((b) => picked.has(b.id));
  $('#diff-caption').textContent = st.against === 'live' ? `${sel[0]?.when ?? 'Backup'} against the board now` : sel.length === 2 ? `${sel[1].when} against ${sel[0].when}` : 'Pick two backups to compare';
  const th = $$('#diff-table thead th'); th[1].textContent = st.against === 'live' ? 'Backup' : 'Older'; th[2].textContent = st.against === 'live' ? 'Board now' : 'Newer';
}
for (const b of $$('[data-against]')) b.addEventListener('click', () => { st.against = b.dataset.against; for (const x of $$('[data-against]')) x.classList.toggle('selected', x === b); renderBackups(); });
$('#backup-now').addEventListener('click', () => { backups.unshift({ id: `b${backups.length + 1}`, when: 'Just now', fw: st.fwOld ? '440.20' : '450.01', why: 'Taken by hand', n: 112 }); renderBackups(); notify('Example backup added. In the app this reads every setting, read-only, and saves it to your account.'); });
$('#export-json').addEventListener('click', () => {
  const data = JSON.stringify({ board: 'TG-8-0412', hv: 8, fb: st.fwOld ? '440.20' : '450.01', taken: 'example', settings: Object.fromEntries(diffs.backup.map(([, k, a]) => [k, a])) }, null, 2);
  const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
  const a = h('a', { href: url, download: 'tinyg-backup-example.json' }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  notify('Exported an example backup as JSON.');
});
$('#import-json').addEventListener('change', async (e) => {
  const file = e.target.files?.[0]; if (!file) return;
  try { const data = JSON.parse(await file.text()); const n = Object.keys(data.settings ?? data).length; backups.unshift({ id: `b${backups.length + 1}`, when: 'Imported', fw: String(data.fb ?? 'unknown'), why: file.name, n }); renderBackups(); notify(`Imported ${n} settings for review. Nothing is written to the board.`); }
  catch { notify('That file is not valid JSON. Export a backup from Run and import that file.'); }
});

// Board wiring draft (from increment 1).
const drafts = new Map(); const working = new Map();
let selectedConnector = 'xmin'; let contact = 'NC';
const motorDefaults = (id) => ({ axis: { motor1: 'X', motor2: 'Y', motor3: 'Z', motor4: 'Unassigned' }[id], frame: 'NEMA 23', current: '', angle: '1.8', microsteps: '8', travel: '40' });
const defaultInput = { function: 'Homing + limit', contact: 'NC' };
function selectConnector(value) {
  selectedConnector = value; $('#connector-select').value = value;
  for (const el of $$('[data-connector]')) el.setAttribute('aria-pressed', String(el.dataset.connector === value));
  const motor = value.startsWith('motor');
  $('#input-fields').hidden = value !== 'xmin'; $('#motor-fields').hidden = !motor; $('#other-fields').hidden = value === 'xmin' || motor;
  if (motor) { $('#motor-title').textContent = `Motor ${value.slice(-1)}`; const v = working.get(value) ?? drafts.get(value) ?? motorDefaults(value); for (const f of ['axis', 'frame', 'current', 'angle', 'microsteps', 'travel']) $('#motor-' + f).value = v[f]; }
  $('#other-title').textContent = value === 'aux' ? 'Z / A inputs' : 'Spindle / coolant';
  $('#save-draft').disabled = !motor && value !== 'xmin';
  if (value === 'xmin') { const v = working.get(value) ?? drafts.get(value) ?? defaultInput; $('#switch-function').value = v.function; contact = v.contact; paintContact(); }
  updateConfiguration(false);
}
function paintContact() { $('#contact-arm').setAttribute('d', contact === 'NC' ? 'M93 32h63' : 'M93 32l60-12'); for (const b of $$('[data-contact]')) b.classList.toggle('selected', b.dataset.contact === contact); }
function configurationValues() { if (selectedConnector === 'xmin') return { function: $('#switch-function').value, contact }; return Object.fromEntries(['axis', 'frame', 'current', 'angle', 'microsteps', 'travel'].map((f) => [f, $('#motor-' + f).value])); }
function updateConfiguration(changed = true) {
  const motor = selectedConnector.startsWith('motor');
  if (!motor && selectedConnector !== 'xmin') { $('.draft-value').textContent = 'Not configured'; return; }
  const v = configurationValues(); if (changed) working.set(selectedConnector, v);
  const valid = !motor || (Number(v.travel) > 0 && (!v.current || Number(v.current) > 0));
  $('#save-draft').disabled = !valid;
  $('.draft-value').textContent = motor ? `${v.axis} · ${v.travel || '—'} mm/rev` : `${v.function} · ${contact}`;
  $('#controller-value').textContent = motor ? '40 mm/rev · example read' : 'Not read';
  $('#draft-status').textContent = !valid ? 'Enter a positive travel and, if recorded, current.' : JSON.stringify(v) === JSON.stringify(drafts.get(selectedConnector)) ? 'Saved in this example draft' : 'Unsaved proposal · controller unchanged';
  if (motor) {
    const steps = 360 / Number(v.angle) * Number(v.microsteps) / Number(v.travel);
    $('#mechanical-story').textContent = valid ? `One revolution: ${360 / Number(v.angle)} full steps × ${v.microsteps} microsteps → ${v.travel} mm of travel. ${Number(steps.toFixed(3))} steps/mm. A mechanical estimate, not a calibration.` : 'Enter the travel per revolution to see steps per millimetre.';
    const sel = $('[data-connector][aria-pressed="true"]'); if (sel) sel.querySelector('text:last-of-type').textContent = v.axis === 'Unassigned' ? 'Unassigned' : `${v.axis} axis`;
  }
}
function syncDraftCount() { for (const el of $$('.draft-count-label')) el.textContent = `(${drafts.size})`; }
for (const el of $$('[data-connector]')) { const go = () => selectConnector(el.dataset.connector); el.addEventListener('click', go); el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } }); }
$('#connector-select').addEventListener('change', (e) => selectConnector(e.target.value));
$('#switch-function').addEventListener('change', () => updateConfiguration());
for (const b of $$('[data-contact]')) b.addEventListener('click', () => { contact = b.dataset.contact; paintContact(); updateConfiguration(); });
for (const f of $$('#motor-fields input, #motor-fields select')) f.addEventListener('input', () => updateConfiguration());
$('#save-draft').addEventListener('click', () => { drafts.set(selectedConnector, configurationValues()); syncDraftCount(); updateConfiguration(false); notify('Saved to the example draft. Nothing was written to a board.'); });

// ---------- Dialogs ----------
let returnFocus;
const P = (text) => h('p', { text });
const explanations = {
  safety: ['Safety stays with the machine', 'The warning line and the machine strip stay visible in every view. In the app, Pause and Stop job stay usable whenever a port is open: idle, read only, signed out, or with any panel open.', 'Escape pauses even inside a panel. A request sent is not proof that the controller stopped. Your hardwired E-stop is the emergency control.'],
  settings: ['Workspace settings', 'Theme, units and display preferences live here. They never change the controller’s settings.'],
  connection: ['Connecting your machine', 'In the app: sign in, read the safety advisory, confirm, then choose the port. This design preview opens no port.'],
  board: ['Choose the exact board', 'This study follows the public TinyG v8 drawing. Connector positions still need revision-specific verification before it becomes wiring guidance.', 'Other TinyG revisions and g2core boards use their own reviewed definitions. No private hardware files or images are included.'],
  account: ['Account and devices', 'Signed in with GitHub as @jdoe. Projects, machine profiles, tools and settings backups sync to your Synthetos account once the account service exists. This preview saves nothing.', 'Homing, local safety facts, confirmations and permission to resume never come from the cloud. Sign-out is disabled while a job runs.'],
  optimization: ['Compare, then choose', 'Original file, candidate version, side-by-side comparison, sanitiser and preflight, then your review. Arc fitting and segment merging always make a new version and never change an armed job.'],
  recovery: ['Recovery stays visible', 'Use the physical E-stop if motion is uncertain. A disconnected interface cannot stop a machine.', 'No automatic reconnect or resume. Reset stays subject to the existing safety rules and confirmations.'],
  'add-tool': ['Add a tool', 'Choose the type, then enter the diameter, flutes, lengths, material and coating. Tools sync to your account and live on the host: the controller has no tool table.'],
  open: ['Open a G-code file', 'In the app: choose a file from this computer or a project. It is checked by the sanitiser and pre-scanned for tool changes before anything else. This preview uses the sample file.'],
};
function closeDialog() { clearInterval(flashTimer); $('#dialog-wrap').hidden = true; $('.dialog').classList.remove('wide'); $('#dialog-action').disabled = false; returnFocus?.focus?.(); }
function dialog(kind, value) {
  returnFocus = document.activeElement; closeMenu(); clearInterval(flashTimer);
  $('.dialog').classList.remove('wide');
  const content = $('#dialog-content'); const action = $('#dialog-action');
  content.replaceChildren(); action.hidden = true; action.disabled = false; action.onclick = null; $('#dialog-cancel').textContent = 'Close';
  if (kind === 'fork' || kind === 'custom' || kind === 'new-project') {
    const project = kind === 'new-project';
    const title = project ? 'Create a project' : kind === 'fork' ? `Make ${value} your own` : 'Describe your machine';
    $('#dialog-title').textContent = title;
    content.append(P(project ? 'An example project in this session. No account storage is connected.' : 'This template is an example, not a validated preset. Its source, revision and controller compatibility need review before a usable template ships.'));
    const input = h('input', { maxlength: '60' }); input.value = project ? 'New workshop project' : kind === 'fork' ? `My ${value}` : 'My custom router';
    content.append(h('label', { class: 'field' }, h('span', { text: project ? 'Project name' : 'Your machine name' }), input));
    content.append(P('No settings, homing or safety confirmations are copied.'));
    action.hidden = false; action.textContent = project ? 'Create example project' : 'Create example copy';
    action.onclick = () => {
      const name = input.value.trim(); if (!name) { input.focus(); return; }
      if (project) $('.project-name').textContent = name; else { $('#my-machine-name').textContent = name; $('#editing-context').textContent = `Editing ${name}, connected to Workshop router. Drafts never retarget the connection.`; }
      closeDialog(); notify('Example created. No controller or cloud data changed.');
    };
  } else if (kind === 'changes') {
    $('#dialog-title').textContent = 'Review draft changes';
    content.append(P('One reviewable changeset, in this preview’s memory only. There is no Apply in Phase 1.'));
    if (!drafts.size) content.append(P('No saved draft entries. Select an input or motor and save its proposed settings.'));
    for (const [id, v] of drafts) {
      const card = h('section', { class: 'change-card' }, h('h3', { text: id === 'xmin' ? 'X-min and the shared switch contact' : `Motor ${id.slice(-1)} · ${v.axis}` }));
      if (id === 'xmin') card.append(P(`On controller: not read. Proposed: ${v.function} · ${v.contact}`), P('Affected inputs: X-min, X-max, Y-min, Y-max, Z-min, Z-max, A-min, A-max. All eight need wiring review.'));
      else card.append(P(`Example controller snapshot: 40 mm/rev. Draft: ${v.travel} mm/rev · ${v.angle}° · ${v.microsteps} microsteps.`), P(`${v.frame} · nameplate current ${v.current ? `${v.current} A` : 'not recorded'}.`));
      content.append(card);
    }
    if (drafts.size) { action.hidden = false; action.textContent = 'Clear example draft'; action.onclick = () => { drafts.clear(); working.clear(); syncDraftCount(); selectConnector(selectedConnector); closeDialog(); notify('Example draft cleared. Controller data is unchanged.'); }; }
  } else {
    const texts = explanations[kind] ?? ['Coming in a later increment', 'This is a static interaction study.'];
    $('#dialog-title').textContent = texts[0]; content.append(...texts.slice(1).map(P));
  }
  $('#dialog-wrap').hidden = false; $('#close-dialog').focus();
}

// Firmware update: a guided, simulated flow. Flashing is its own reviewed
// phase (a confined AVR109 flasher beside the serial transport).
const updateSteps = ['Back up', 'Update mode', 'Write', 'Verify', 'Reconnect', 'Compare', 'Restore'];
const postUpdateDiff = [['Switch type', 'st', 'NC', 'NO', true], ['Z-min switch', 'zsn', 'Homing + limit', 'Disabled', true], ['X maximum speed', 'xvm', '12000', '16000', false]];
let flashTimer = null;
function openUpdate(step = 0, mode = '') {
  if ($('#dialog-wrap').hidden) returnFocus = document.activeElement;
  clearInterval(flashTimer); closeMenu();
  $('.dialog').classList.add('wide');
  $('#dialog-title').textContent = st.fwOld || st.switchCheck || st.scenario === 'outdated' ? 'Update this board’s firmware' : 'Firmware update steps';
  const content = $('#dialog-content'); content.replaceChildren();
  const steps = h('ol', { class: 'update-steps', 'aria-label': 'Update steps' }, ...updateSteps.map((n, i) => h('li', { class: i < step ? 'done' : i === step ? 'now' : '', text: `${i + 1}  ${n}`, 'aria-current': i === step ? 'step' : null })));
  const icon = () => { const e = s('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.7', 'aria-hidden': 'true' }); e.append(s('path', { d: 'm12 3 10 18H2Z M12 9v5m0 3v1' })); return e; };
  const callout = (strong, rest, danger = false) => h('div', { class: `callout${danger ? ' danger' : ''}` }, icon(), h('div', {}, h('strong', { text: strong }), ` ${rest}`));
  const facts = (a, b, c, la = 'On the board', lb = 'Installing') => h('div', { class: 'update-facts' }, h('div', {}, h('span', { text: la }), h('strong', { text: a })), h('div', {}, h('span', { text: lb }), h('strong', { text: b })), h('div', {}, h('span', { text: 'Hardware' }), h('strong', { text: c })));
  const progress = (label, ms, next, nextLabel) => {
    const bar = h('span', { style: 'width:0%' }); const text = P(`${label} · 0 %`);
    action.textContent = 'Working…'; action.disabled = true;
    let p = 0; flashTimer = setInterval(() => { p = Math.min(100, p + 4); bar.style.width = `${p}%`; text.textContent = `${label} · ${p} %`; if (p >= 100) { clearInterval(flashTimer); action.disabled = false; action.textContent = nextLabel; action.onclick = next; } }, ms);
    return [h('div', { class: 'flash-bar' }, bar), text];
  };
  const body = h('div', { class: 'update-body' });
  const action = $('#dialog-action'); action.hidden = false; action.disabled = false; $('#dialog-cancel').textContent = step === 0 ? 'Not now' : 'Close';
  if (mode === 'reset') {
    // Recovery: the firmware is not running. The bootloader listens for about
    // 4.8 s after a reset, so Run keeps calling it while the user presses.
    const count = h('strong', { class: 'countdown', text: '30' });
    body.append(callout('Unplug the USB cable and plug it back in now.', 'Pressing the board’s reset button works too. Run is already calling the bootloader, which listens for only a few seconds after power-up while its LED blinks.'),
      h('p', {}, 'Waiting for the bootloader: ', count, ' s'),
      P('The bootloader survives a failed update, so trying again always works. When it answers, Run writes the same signed build.'));
    let n = 30; flashTimer = setInterval(() => { n -= 1; count.textContent = String(n); if (n <= 0) { clearInterval(flashTimer); count.textContent = '0'; action.textContent = 'Try again'; } }, 1000);
    action.textContent = 'Bootloader answered'; action.onclick = () => openUpdate(2);
  } else if (mode === 'failed') {
    body.append(callout('The update did not finish.', 'The board may not start normally. Your settings are safe in your account.', true),
      P('Start recovery: Run waits for the bootloader while you unplug the USB cable and plug it back in, then writes the same signed build again. Your backup from today is offered after a successful update.'));
    action.textContent = 'Start recovery'; action.onclick = () => openUpdate(1, 'reset');
  } else if (step === 0) {
    body.append(facts(st.fwOld ? '440.20' : '450.01', '450.01', 'v8 · TG-8-0412'),
      P(st.fwOld ? 'Run needs firmware 450.01 or newer to run jobs, jog and change settings, because older versions do not report the planner queue that Run uses to stream safely. Your board can still connect, be viewed and backed up.' : 'This board already runs 450.01. These are the steps an update follows.'),
      P('First, Run reads every setting from the board and saves it to your account as “Before update to 450.01”. Reading changes nothing on the board.'));
    action.textContent = 'Back up and continue'; action.onclick = () => openUpdate(1);
  } else if (step === 1) {
    body.append(P('Backed up 112 settings to your account: “Before update to 450.01”, today 09:41. A raw copy of the board’s settings memory is stored with it as a second recovery copy.'),
      callout('Keep the USB cable connected and the power on until the update finishes.', 'Unplugging while it writes can leave the board unable to start. If that happens, the recovery path brings it back.'),
      P('Next, Run asks the running firmware to restart into update mode. No button press is needed. Make sure the machine is idle and the spindle is off.'),
      h('button', { class: 'link', id: 'no-answer', text: 'The board is not running its firmware or does not answer' }));
    action.textContent = 'Restart into update mode'; action.onclick = () => openUpdate(2);
    setTimeout(() => $('#no-answer')?.addEventListener('click', () => openUpdate(1, 'reset')));
  } else if (step === 2) {
    body.append(P('In update mode. Checking the build: it is listed in the signed release manifest and its SHA-256 matches. Run writes the firmware page by page and never erases the whole chip, so the board keeps its settings memory.'),
      ...progress('Writing 450.01 for hardware v8', 110, () => openUpdate(3), 'Continue'),
      callout('Do not unplug the board.', 'Writing takes about a minute.'),
      h('button', { class: 'link', id: 'sim-fail', text: 'Preview what happens if writing fails' }));
    setTimeout(() => $('#sim-fail')?.addEventListener('click', () => openUpdate(2, 'failed')));
  } else if (step === 3) {
    body.append(P('Reading the firmware back and comparing it with the signed build.'), ...progress('Verifying', 50, () => openUpdate(4), 'Continue'));
  } else if (step === 4) {
    body.append(P('The board restarted. Run reconnects to the same board and identifies it again before anything else. No job, jog or setting is restored automatically.'));
    action.textContent = 'Reconnect'; action.onclick = () => { st.fwOld = false; st.switchCheck = true; $('.app').dataset.fw = 'ok'; renderAll(); openUpdate(5); };
  } else if (step === 5) {
    // After the reconnect: compare the live board with the pre-update backup.
    const table = h('table', { class: 'diff-table' }, h('thead', {}, h('tr', {}, h('th', { text: 'Setting' }), h('th', { text: 'Your backup' }), h('th', { text: 'Board now' }))),
      h('tbody', {}, ...postUpdateDiff.map(([name, key, a, b2, hot]) => h('tr', { class: hot ? 'hot' : '' }, h('td', {}, h('strong', { text: name }), h('small', { text: key })), h('td', { class: 'new', text: a }), h('td', { class: 'old', text: b2 })))));
    body.append(facts('450.01', 'Matches', 'v8 · TG-8-0412', 'Board reports', 'Signed build'),
      callout('Check your limit switches. The update changed the switch settings.', 'The new firmware started with default settings. A switch set to the wrong contact type can leave limits or homing not working, so jobs and jogging stay locked until your settings are restored and checked.', true),
      table);
    action.textContent = 'Continue to restore'; action.onclick = () => openUpdate(6);
    $('#dialog-cancel').textContent = 'Close, keep locked';
  } else if (step === 6 && mode !== 'restoring') {
    body.append(P(`Run restores your backup by setting name, one setting at a time, waiting for the board after each. ${postUpdateDiff.length} settings differ; the switch settings are among them. This step is required before the update is done.`),
      P('Restoring is a settings write. In the app it ships with settings writes, after Phase 1; this preview only simulates it.'));
    action.textContent = 'Restore and check'; action.onclick = () => openUpdate(6, 'restoring');
    $('#dialog-cancel').textContent = 'Close, keep locked';
  } else {
    body.append(P('Writing your settings back, then reading every setting again to confirm it matches the backup.'),
      ...progress('Restoring and reading back', 60, () => { closeDialog(); setScenario('identified'); notify('Restored and checked: all 112 settings match your backup. Jobs and jogging are no longer locked by the update.'); }, 'Done: all settings match'));
  }
  content.append(steps, body);
  $('#dialog-wrap').hidden = false; $('#close-dialog').focus();
}
for (const b of $$('[data-dialog]')) b.addEventListener('click', () => dialog(b.dataset.dialog));
for (const b of $$('[data-view]')) b.addEventListener('click', () => view(b.dataset.view));
$('#close-dialog').addEventListener('click', closeDialog);
$('#dialog-cancel').addEventListener('click', closeDialog);
$('#load-file').addEventListener('click', () => dialog('open'));
$('#empty-open').addEventListener('click', () => loadFile());
$('#scenario-action').addEventListener('click', () => {
  const sc = st.scenario;
  if (sc === 'idle') { view('configure'); selectCtab('wiring'); dialog('changes'); }
  else if (sc === 'identified') view('configure');
  else if (sc === 'disconnected') dialog('connection');
  else if (st.switchCheck) openUpdate(6);
  else if (sc === 'outdated') openUpdate();
  else dialog('recovery');
});

// ---------- Account menu ----------
function closeMenu() { $('#account-menu').hidden = true; $('#account-button').setAttribute('aria-expanded', 'false'); }
$('#account-button').addEventListener('click', (e) => { e.stopPropagation(); const open = $('#account-menu').hidden; $('#account-menu').hidden = !open; $('#account-button').setAttribute('aria-expanded', String(open)); if (open) $('#account-menu .menu-item').focus(); });
document.addEventListener('click', (e) => { if (!$('#account-menu').contains(e.target)) closeMenu(); });
$('#sign-out').addEventListener('click', () => { closeMenu(); notify('Example only: signing out keeps local preparation working. Pause and Stop job are never affected.'); });

// ---------- Pause / Stop / Escape ----------
function pauseFeedback() {
  notify({
    disconnected: 'Not connected: Pause was not delivered.', identified: 'Paused: the machine was idle, nothing changed. (Demo)', idle: 'Paused: the machine was idle, nothing changed. (Demo)', outdated: 'Paused: the machine was idle, nothing changed. (Demo)',
    running: 'Pause sent. Waiting for the controller to report the hold. (Demo: nothing moved)', toolchange: 'Pause sent. The job is already waiting for a tool change.', held: 'Already paused, and the spindle is still on. Use Stop job to end with the spindle off.',
    lost: 'Pause NOT DELIVERED: the connection is lost. Use your E-stop if the machine may be moving.', orphaned: 'Pause sent. Motion is still unconfirmed; use your E-stop if needed.',
  }[st.scenario]);
}
$('#pause').addEventListener('click', pauseFeedback);
$('#stop').addEventListener('click', () => notify(st.scenario === 'lost' || st.scenario === 'disconnected' ? 'Stop job NOT DELIVERED. Use your E-stop if needed.' : 'Stop job sent. A request is not proof that the machine or spindle stopped. (Demo)'));
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') { pauseFeedback(); if (!$('#dialog-wrap').hidden) closeDialog(); closeMenu(); } }, true);

// ---------- Theme ----------
$('#theme').addEventListener('click', () => {
  const dark = document.documentElement.dataset.theme !== 'dark';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  $('#theme').setAttribute('aria-label', `Switch to ${dark ? 'light' : 'dark'} theme`);
});
new MutationObserver(() => refreshScenes()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

// ---------- Boot ----------
function renderAll() {
  renderStrip(); renderPosition(); renderJob(); renderSpindle(); renderTimeline(); renderGcode(); renderLive();
  renderSetup(); renderTools(); renderAnalyze(); renderFirmware(); renderBackups(); renderProjects();
  $('#sec-toolchange').hidden = st.scenario !== 'toolchange';
  refreshScenes(true);
}
$('#scenario').addEventListener('change', (e) => { setScenario(e.target.value); view('run', false); history.pushState(null, '', `#${st.scenario}`); });
window.addEventListener('popstate', () => view(location.hash.slice(1), false));
drafts.set('motor1', { ...motorDefaults('motor1'), travel: '20' }); syncDraftCount(); selectConnector('xmin');
renderMachines();
setScenario('idle');
view(location.hash.slice(1) || 'run', false);
// Review hooks for the capture harness only.
window.reviewApi = { setScenario, view, selectCtab, selectTab, setDock, openUpdate, importFixture, features, state: st };
