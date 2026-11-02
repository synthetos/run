// Static design review only: no worker, transport, storage or network API.
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
let loaded = false;
let draftCount = 0;
let scenario = 'idle';
let selectedConnector = 'xmin';
const drafts = new Map();
const working = new Map();
const motorDefaults = (id) => ({ axis: { motor1: 'X', motor2: 'Y', motor3: 'Z', motor4: 'Unassigned' }[id], frame: 'NEMA 23', current: '', angle: '1.8', microsteps: '8', travel: '40' });
const defaultInput = { function: 'Homing + limit', contact: 'NC' };
let contact = 'NC';
let filter = 'all';
let toastTimer;
let returnFocus;
const routeNames = new Set(['run', 'configure', 'machines', 'projects', 'analyze']);
function notify(text) {
  clearTimeout(toastTimer);
  $('#toast').textContent = text;
  toastTimer = setTimeout(() => { $('#toast').textContent = ''; }, 4500);
}
function view(name, update = true) {
  if (Object.hasOwn(scenarios, name)) { setScenario(name); name = 'run'; }
  if (name === 'loaded') { loadFile(); name = 'run'; }
  if (!routeNames.has(name)) name = 'run';
  for (const el of $$('[data-screen]')) el.hidden = el.dataset.screen !== name;
  for (const el of $$('.rail [data-view]')) el.setAttribute('aria-current', el.dataset.view === name ? 'page' : 'false');
  if (update) history.pushState(null, '', `#${name}`);
  document.title = `${name[0].toUpperCase() + name.slice(1)} — Run design preview`;
}
function loadFile(operation = 'contour') {
  loaded = true;
  $('#empty-prompt').hidden = true;
  $('#no-job').hidden = true;
  $('#job-info').hidden = false;
  $('.loaded-geometry').hidden = false;
  $('.loaded-geometry').setAttribute('visibility', 'visible');
  $('#run-title').textContent = operation === 'drill' ? 'Mounting plate · drilling' : 'Mounting plate · contour';
  $('#run-subtitle').textContent = 'A new file for this machine. Inspect it before preparing the job.';
  $('#canvas-label').textContent = 'TOOLPATH PREVIEW · SAMPLE';
  $('#file-summary').textContent = operation === 'drill' ? '42 lines · version 2' : '246 lines · version 3';
  $('#load-file').textContent = 'Change sample';
  $('.job-title').textContent = operation === 'drill' ? 'Mounting plate · drilling' : 'Mounting plate · contour';
  $('#job-info .raw-key').textContent = operation === 'drill' ? 'plate-drill.nc · version 2' : 'plate-contour.nc · version 3';
}
function selectConnector(value) {
  selectedConnector = value;
  $('#connector-select').value = value;
  for (const el of $$('[data-connector]')) el.setAttribute('aria-pressed', String(el.dataset.connector === value));
  const motor = value.startsWith('motor');
  $('#input-fields').hidden = value !== 'xmin';
  $('#motor-fields').hidden = !motor;
  $('#other-fields').hidden = value === 'xmin' || motor;
  if (motor) {
    $('#motor-title').textContent = `Motor ${value.slice(-1)}`;
    const values = working.get(value) ?? drafts.get(value) ?? motorDefaults(value);
    for (const field of ['axis', 'frame', 'current', 'angle', 'microsteps', 'travel']) $('#motor-' + field).value = values[field];
  }
  $('#other-title').textContent = value === 'aux' ? 'Z / A inputs' : 'Spindle / coolant';
  $('.draft-value').textContent = motor ? `${$('#motor-axis').value} axis` : value === 'xmin' ? $('#switch-function').value : 'Not configured';
  $('#save-draft').disabled = !motor && value !== 'xmin';
  if (value === 'xmin') {
    const values = working.get(value) ?? drafts.get(value) ?? defaultInput;
    $('#switch-function').value = values.function;
    contact = values.contact;
    paintContact();
  }
  updateConfiguration(false);
}
function paragraph(text) { const p = document.createElement('p'); p.textContent = text; return p; }
function closeDialog() { $('#dialog-wrap').hidden = true; returnFocus?.focus(); }
const explanations = {
  safety: ['Safety stays with the machine', 'The safety strip remains visible in every view. This prototype cannot connect to a machine. In the application, Pause and Stop remain usable whenever a port is open, including when idle or signed out.', 'Escape retains its Pause behavior even with a panel open. A request sent does not prove that a controller stopped. The physical E-stop is the emergency control.'],
  settings: ['Workspace settings', 'Theme, units and display preferences belong here. They do not change the controller’s settings. The theme toggle in the header works in this prototype.'],
  connection: ['Workshop router', 'Simulated connection · TinyG v8 · read only. No serial port has been requested or opened. Every position shown is sample data.', 'In the application, this connection and its worker persist across Projects, Configure and all other views. Unknown readings are never replaced by zero.'],
  board: ['Choose the exact board', 'This study follows the public TinyG v8 component-side drawing. Connector interaction and physical orientation still need revision-specific verification before the configurator ships.', 'Other TinyG revisions and g2 boards will use their own reviewed definitions. No private hardware files or images are included.'],
  review: ['Review before preparing', 'Example: contour operation, version 3. Position is not verified, workholding has not been checked, and the file has not passed the real sanitizer.', 'Phase 1 is read-only. There is no Arm or Start action in this prototype. Review and approval will use the existing safety pipeline in a later phase.'],
  console: ['Connection transcript', 'Read-only example. This is where controller reports and delivery results can be inspected; it is not a command prompt.', '09:41:02 · Connection identified\n09:41:03 · Settings read\n09:41:03 · Machine idle — no active job\nAll entries here are illustrative.'],
  gcode: ['G-code and source lines', 'The source listing belongs in a virtualized drawer alongside the preview. Selecting a line will highlight its geometry; sent, acknowledged and executed are separate states.', 'Increment 1 uses an illustration. The interpreter and actual sample files join this view in increment 3.'],
  optimization: ['Compare, then choose', 'Original file → candidate version → geometric comparison → sanitizer and preflight → explicit review. Arc fitting and segment merging never change an armed job.', 'This panel reserves the workflow for the analysis engine. The time and length on this screen are illustrative, not computed.'],
  account: ['Your work, on your terms', 'Projects and machine profiles will sync to your GitHub-linked Synthetos account when the account service is available. This prototype does not sign in or save data.', 'Device-local safety facts, homing state and permission to resume never come from a cloud profile. Signed-out local preparation is distinct from identity-gated machine actions.'],
  changes: ['Review draft changes', 'On controller: not read. This is an example draft, not a verified comparison. Each affected input and high-risk change must be reviewed when the real write pipeline is implemented.', 'Saving a draft changes only this prototype’s memory. There is no Apply-to-board action.'],
};
function dialog(kind, value) {
  clearTimeout(toastTimer); $('#toast').textContent = '';
  returnFocus = document.activeElement;
  const content = $('#dialog-content');
  const action = $('#dialog-action');
  content.replaceChildren();
  action.hidden = true;
  action.onclick = null;
  let texts = explanations[kind];
  if (kind === 'connection' && scenario === 'disconnected') texts = ['Connect when you are ready', 'This is an offline workspace. In the application, sign-in, the safety advisory and C1 precede the port chooser.', 'This design preview opens no port. Use the Preview state selector to inspect the identified state.'];
  if (kind === 'fork' || kind === 'custom' || kind === 'new-project') {
    const project = kind === 'new-project';
    const title = project ? 'Create a project' : kind === 'fork' ? `Make ${value} your own` : 'Describe your machine';
    texts = [title, project ? 'An example project in this session. No account storage is connected.' : 'This catalogue card is a design example, not a validated machine preset. Sources, revision and controller compatibility must be reviewed before a usable template ships.'];
    $('#dialog-title').textContent = title;
    content.append(paragraph(texts[1]));
    const label = document.createElement('label'); label.className = 'field';
    const span = document.createElement('span'); span.textContent = project ? 'Project name' : 'Your machine name';
    const input = document.createElement('input'); input.value = project ? 'New workshop project' : kind === 'fork' ? `My ${value}` : 'My custom router'; input.maxLength = 60;
    label.append(span, input); content.append(label);
    content.append(paragraph('Prototype only: this example resets on reload. No settings or safety confirmations are inherited.'));
    action.hidden = false; action.textContent = project ? 'Create example project' : 'Create example copy';
    action.onclick = () => {
      const name = input.value.trim();
      if (!name) { input.focus(); return; }
      if (project) { $('.project-hero h2').textContent = name; view('projects'); }
      else { $('#my-machine-name').textContent = name; $('#editing-context').textContent = `Editing ${name}; connected to Workshop router. Drafts never retarget the connection.`; view('machines'); }
      closeDialog(); notify('Example created. No controller or cloud data changed.');
    };
  } else {
    texts ??= ['Coming in a later increment', 'This is a static interaction study. No hardware action is available.'];
    $('#dialog-title').textContent = texts[0];
    content.append(...texts.slice(1).map(paragraph));
    if (kind === 'changes') {
      content.replaceChildren(paragraph('One reviewable changeset · prototype memory only. No Apply action in Phase 1.'));
      if (!drafts.size) content.append(paragraph('No saved draft entries. Select an input or motor and save its proposed settings.'));
      for (const [id, values] of drafts) {
        const card = document.createElement('section'); card.className = 'change-card';
        const heading = document.createElement('h3'); heading.textContent = id === 'xmin' ? 'X-min + shared switch contact' : `Motor ${id.slice(-1)} · ${values.axis}`;
        card.append(heading);
        if (id === 'xmin') card.append(paragraph('On controller: not read. Proposed: ' + values.function + ' · ' + values.contact), paragraph('Affected inputs: X-min, X-max, Y-min, Y-max, Z-min, Z-max, A-min, A-max. All eight need wiring review.'));
        else card.append(paragraph('Example controller snapshot: 40 mm/rev. Draft: ' + values.travel + ' mm/rev · ' + values.angle + '° · ' + values.microsteps + ' microsteps.'), paragraph(values.frame + ' · nameplate current ' + (values.current ? values.current + ' A' : 'not recorded') + '. Current remains a physical adjustment; do not infer it from the frame.'));
        content.append(card);
      }
      if (drafts.size) { action.hidden = false; action.textContent = 'Clear example draft'; action.onclick = () => { drafts.clear(); working.clear(); syncDraftCount(); selectConnector(selectedConnector); closeDialog(); notify('Example draft cleared. Controller data is unchanged.'); }; }
    }
  }
  $('#dialog-wrap').hidden = false;
  $('#close-dialog').focus();
}
for (const button of $$('[data-view]')) button.addEventListener('click', () => view(button.dataset.view));
for (const button of $$('[data-dialog]')) button.addEventListener('click', () => dialog(button.dataset.dialog));
for (const button of $$('[data-fork]')) button.addEventListener('click', () => dialog('fork', button.dataset.fork));
for (const button of $$('[data-operation]')) button.addEventListener('click', () => { loadFile(button.dataset.operation); view('run'); });
for (const button of $$('[data-connector]')) {
  const activate = () => selectConnector(button.dataset.connector);
  button.addEventListener('click', activate);
  button.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate(); } });
}
$('#connector-select').addEventListener('change', (e) => selectConnector(e.target.value));
function paintContact() {
  $('#contact-arm').setAttribute('d', contact === 'NC' ? 'M93 32h63' : 'M93 32l60-12');
  for (const b of $$('[data-contact]')) b.classList.toggle('selected', b.dataset.contact === contact);
}
function configurationValues() {
  if (selectedConnector === 'xmin') return { function: $('#switch-function').value, contact };
  return Object.fromEntries(['axis', 'frame', 'current', 'angle', 'microsteps', 'travel'].map((field) => [field, $('#motor-' + field).value]));
}
function updateConfiguration(changed = true) {
  const motor = selectedConnector.startsWith('motor');
  if (!motor && selectedConnector !== 'xmin') return;
  const values = configurationValues();
  if (changed) working.set(selectedConnector, values);
  const valid = !motor || (Number(values.travel) > 0 && (!values.current || Number(values.current) > 0));
  $('#save-draft').disabled = !valid;
  $('.draft-value').textContent = motor ? `${values.axis} · ${values.travel || '—'} mm/rev` : `${values.function} · ${contact}`;
  $('#controller-value').textContent = motor ? '40 mm/rev · example read' : 'Not read';
  $('#draft-status').textContent = !valid ? 'Enter a positive travel and, if recorded, current.' : JSON.stringify(values) === JSON.stringify(drafts.get(selectedConnector)) ? 'Saved in this example draft' : 'Unsaved proposal · controller unchanged';
  if (motor) {
    const steps = 360 / Number(values.angle) * Number(values.microsteps) / Number(values.travel);
    $('#mechanical-story').textContent = valid ? `One revolution: ${360 / Number(values.angle)} full steps × ${values.microsteps} microsteps → ${values.travel} mm travel. ${Number(steps.toFixed(3))} steps/mm. Mechanical estimate, not measured or calibrated.` : 'Enter the mechanism’s travel per revolution to see its steps per millimetre.';
    const selected = $('[data-connector][aria-pressed="true"]');
    if (selected) selected.querySelector('text:last-of-type').textContent = values.axis === 'Unassigned' ? 'Unassigned' : values.axis + ' axis';
  }
}
function syncDraftCount() { draftCount = drafts.size; $('.draft-count-label').textContent = `(${draftCount})`; if (scenario === 'idle') setScenario('idle'); }
$('#switch-function').addEventListener('change', () => updateConfiguration());
for (const button of $$('[data-contact]')) button.addEventListener('click', () => { contact = button.dataset.contact; paintContact(); updateConfiguration(); });
for (const field of $$('#motor-fields input, #motor-fields select')) field.addEventListener('input', () => updateConfiguration());
$('#save-draft').addEventListener('click', () => { drafts.set(selectedConnector, configurationValues()); syncDraftCount(); updateConfiguration(false); notify('Saved to the example draft. Nothing was written to a board.'); });
$('#load-file').addEventListener('click', () => { if (loaded) dialog('gcode'); else loadFile(); });
function pauseFeedback() {
  notify({ disconnected: 'Demo: not connected. No Pause could be delivered.', identified: 'Demo: Pause sent; the last report was idle. No state change is assumed.', idle: 'Demo: machine idle; Pause remains available. No motion change is assumed.', running: 'Demo: Pause sent. Waiting for a controller report; this is not confirmation of a stop.', held: 'Demo: machine is held. Spindle state is unconfirmed; Pause does not turn it off.', lost: 'Demo: Pause NOT DELIVERED. Use the physical E-stop if the machine may be moving.', orphaned: 'Demo: Pause sent; motion remains unconfirmed. Use the physical E-stop if needed.' }[scenario]);
}
$('#pause').addEventListener('click', pauseFeedback);
$('#stop').addEventListener('click', () => notify(scenario === 'lost' || scenario === 'disconnected' ? 'Demo: Stop NOT DELIVERED. Use the physical E-stop if needed.' : 'Demo: Stop requested. A request is not proof of stopped motion or a stopped spindle.'));
$('#close-dialog').addEventListener('click', closeDialog);
$('#dialog-cancel').addEventListener('click', closeDialog);
window.addEventListener('keydown', (event) => { if (event.key === 'Escape') { pauseFeedback(); if (!$('#dialog-wrap').hidden) closeDialog(); } }, true);
$('#theme').addEventListener('click', () => {
  const dark = document.documentElement.dataset.theme !== 'dark';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  $('#theme').setAttribute('aria-label', `Switch to ${dark ? 'light' : 'dark'} theme`);
});
for (const button of $$('[data-camera]')) button.addEventListener('click', () => { notify('Camera control concept. This static toolpath is an illustration; the live viewer comes in increment 3.'); });
function filterMachines() {
  const query = $('#machine-search').value.toLowerCase();
  for (const card of $$('[data-machine]')) card.hidden = !card.dataset.machine.toLowerCase().includes(query) || (filter !== 'all' && filter !== card.dataset.drive);
}
$('#machine-search').addEventListener('input', filterMachines);
for (const button of $$('[data-filter]')) button.addEventListener('click', () => { filter = button.dataset.filter; for (const b of $$('[data-filter]')) b.classList.toggle('selected', b === button); filterMachines(); });
const scenarios = {
  disconnected: ['Not connected', 'Offline planning', 'No controller data', 'Your workspace is ready. Your machine is not connected.', 'Browse projects and inspect files offline. Connecting is a separate, identity-gated action.', 'Explore connection'],
  identified: ['Connected · read only', 'Read only', 'No active job', 'TinyG identified. Inspect before you operate.', 'Settings and positions shown here are samples. Motion and settings writes remain unavailable in Phase 1.', 'Inspect configuration'],
  idle: ['Machine idle', 'Needs review', '1 example difference', 'Your machine profile differs from the controller.', 'Motor 1 travel: profile draft 20 mm/rev; example controller read 40 mm/rev. Nothing has been applied.', 'Review difference'],
  running: ['Job running', 'Future concept', '42% · sample progress', 'Mounting plate · contour · 42%', 'Later-phase illustration. Pause requests a hold; only a controller report confirms it. The spindle can remain on.', 'Show held report'],
  held: ['Job held', 'Future concept', 'Spindle unconfirmed', 'Motion is held. The spindle is not confirmed off.', 'A later Resume must recheck the existing safety conditions. No automatic resume, including after sign-in.', 'Review operation'],
  lost: ['Connection lost', 'Not delivered', 'Last sample · 8 s ago', 'Machine state is unknown. Use the physical E-stop if needed.', 'Pause and Stop remain reachable, but delivery cannot be confirmed. Old position values are not live.', 'Recovery details'],
  orphaned: ['Motion unconfirmed', 'Orphaned motion', 'Position not trusted', 'A connection is not proof of a safe machine state.', 'No job may start. Pause and Stop stay available; recovery requires the existing safety checks.', 'Recovery details'],
};
function setScenario(value) {
  scenario = value;
  const [state, badge, meta, heading, copy, action] = scenarios[value];
  $('.app').dataset.scenario = value; $('#scenario').value = value;
  $('#machine-state').textContent = state; $('.state-meta .pill').textContent = badge; $('.state-meta .muted').textContent = meta;
  $('#scenario-heading').textContent = heading; $('#scenario-copy').textContent = copy; $('#scenario-action').textContent = action;
  if (value === 'idle' && drafts.get('motor1')?.travel === '40') { $('#scenario-heading').textContent = 'Your draft is ready for review.'; $('#scenario-copy').textContent = 'The example travel matches the controller snapshot. Other proposals and unknown readings still need review.'; $('.state-meta .muted').textContent = 'Draft needs review'; }
  if (value === 'idle' && drafts.size === 0) { $('.state-meta .pill').textContent = 'Read only'; $('.state-meta .muted').textContent = 'No saved draft'; $('#scenario-heading').textContent = 'No saved draft changes.'; $('#scenario-copy').textContent = 'The example draft is clear. Controller settings remain unchanged.'; }
  const unknown = value === 'disconnected' || value === 'orphaned';
  $('.source').textContent = unknown ? 'Not read' : value === 'lost' ? 'Last sample · 8 s ago' : 'Sample · 0.2 s';
  $$('.dro-row').forEach((row, i) => { row.querySelector('strong').textContent = unknown ? '—' : ['0.000', '0.000', '12.000'][i]; row.querySelector('.secondary').textContent = unknown ? '—' : ['125.000', '80.000', '−8.000'][i]; });
  $('.coordinates span').textContent = unknown ? 'Offsets: not read' : 'Offsets: +125, +80, −20';
  $('#phase-title').textContent = ['running', 'held'].includes(value) ? 'Later-phase state study' : value === 'lost' || value === 'orphaned' ? 'Recovery before operation' : 'Read-only workspace';
  $('#phase-copy').textContent = ['running', 'held'].includes(value) ? 'This state is illustrated for the complete workspace. No motion control is added to Phase 1.' : 'Inspect and prepare. Controller writes and motion remain unavailable in Phase 1.';
  if (['running', 'held'].includes(value)) loadFile();
  $('#run-subtitle').textContent = heading;
  clearTimeout(toastTimer); $('#toast').textContent = '';
}
$('#scenario').addEventListener('change', (event) => { setScenario(event.target.value); view('run', false); history.pushState(null, '', '#' + scenario); });
$('#scenario-action').addEventListener('click', () => {
  if (scenario === 'idle') dialog('changes');
  else if (scenario === 'identified') view('configure');
  else if (scenario === 'running') { setScenario('held'); history.pushState(null, '', '#held'); }
  else if (scenario === 'held') dialog('review');
  else if (scenario === 'disconnected') dialog('connection');
  else dialog('recovery');
});
explanations.recovery = ['Recovery stays visible', 'Use the physical E-stop if motion is uncertain. A disconnected interface cannot stop a machine.', 'No automatic reconnect or resume. The recovery card explains what is known, what is stale, and the existing conditions for a safe acknowledgement. Reset remains subject to safety.allowed and confirmations, even when signed out.'];
// Seed one explicit sample difference for the idle review state, never a board read.
drafts.set('motor1', { ...motorDefaults('motor1'), travel: '20' });
syncDraftCount(); selectConnector('xmin'); setScenario('idle');
window.addEventListener('popstate', () => view(location.hash.slice(1), false));
$('.loaded-geometry').setAttribute('visibility', 'hidden');
view(location.hash.slice(1), false);
