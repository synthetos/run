// Static design review only: no worker, transport, storage or network API.
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
let loaded = false;
let draftCount = 0;
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
  $('#connector-select').value = value;
  for (const el of $$('[data-connector]')) el.setAttribute('aria-pressed', String(el.dataset.connector === value));
  const motor = value.startsWith('motor');
  $('#input-fields').hidden = value !== 'xmin';
  $('#motor-fields').hidden = !motor;
  $('#other-fields').hidden = value === 'xmin' || motor;
  if (motor) {
    $('#motor-title').textContent = `Motor ${value.slice(-1)}`;
    $('#motor-axis').value = { motor1: 'X', motor2: 'Y', motor3: 'Z', motor4: 'Unassigned' }[value];
  }
  $('#other-title').textContent = value === 'aux' ? 'Z / A inputs' : 'Spindle / coolant';
  $('.draft-value').textContent = motor ? `${$('#motor-axis').value} axis` : value === 'xmin' ? $('#switch-function').value : 'Not configured';
  $('#save-draft').disabled = !motor && value !== 'xmin';
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
  returnFocus = document.activeElement;
  const content = $('#dialog-content');
  const action = $('#dialog-action');
  content.replaceChildren();
  action.hidden = true;
  action.onclick = null;
  let texts = explanations[kind];
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
      else { $('#my-machine-name').textContent = name; view('machines'); }
      closeDialog(); notify('Example created. No controller or cloud data changed.');
    };
  } else {
    texts ??= ['Coming in a later increment', 'This is a static interaction study. No hardware action is available.'];
    $('#dialog-title').textContent = texts[0];
    content.append(...texts.slice(1).map(paragraph));
    if (kind === 'changes') content.prepend(paragraph(`${draftCount} example change${draftCount === 1 ? '' : 's'} saved to the draft.`));
  }
  $('#dialog-wrap').hidden = false;
  $('#dialog-cancel').focus();
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
$('#switch-function').addEventListener('change', () => { $('.draft-value').textContent = $('#switch-function').value; });
for (const button of $$('[data-contact]')) button.addEventListener('click', () => {
  contact = button.dataset.contact;
  $('#contact-arm').setAttribute('d', contact === 'NC' ? 'M93 32h63' : 'M93 32l60-12');
  for (const b of $$('[data-contact]')) b.classList.toggle('selected', b === button);
  $('.draft-value').textContent = `${$('#switch-function').value} · ${contact}`;
});
$('#motor-axis').addEventListener('change', () => {
  const value = $('#motor-axis').value;
  $('.draft-value').textContent = value === 'Unassigned' ? value : `${value} axis`;
  const selected = $('[data-connector][aria-pressed="true"]');
  if (selected) selected.querySelector('text:last-of-type').textContent = $('.draft-value').textContent;
});
$('#save-draft').addEventListener('click', () => { draftCount++; $('.draft-count-label').textContent = `(${draftCount})`; notify('Saved to the example draft. Nothing was written to a board.'); });
$('#load-file').addEventListener('click', () => { if (loaded) dialog('gcode'); else loadFile(); });
$('#pause').addEventListener('click', () => notify('Demo: the machine was idle; no motion changed.'));
$('#stop').addEventListener('click', () => notify('Demo: no active job. No stop command was sent to hardware.'));
$('#close-dialog').addEventListener('click', closeDialog);
$('#dialog-cancel').addEventListener('click', closeDialog);
window.addEventListener('keydown', (event) => { if (event.key === 'Escape') { notify('Demo Pause: machine idle; no motion changed.'); if (!$('#dialog-wrap').hidden) closeDialog(); } }, true);
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
window.addEventListener('popstate', () => view(location.hash.slice(1), false));
$('.loaded-geometry').setAttribute('visibility', 'hidden');
view(location.hash.slice(1), false);
