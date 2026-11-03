/**
 * The workspace shell (Stage 1) and the safety bar: W1 first, the top bar,
 * the machine strip with W7 NOT CONNECTED and the disabled Pause (W2) and
 * Stop job, the ten-view rail with only Run shown, W13 on the preview, and
 * the version in the footer. The browser-level checks (no document scroll,
 * view switching keeps the worker, axe) are in tools/e2e.
 */
import { describe, expect, it, vi } from 'vitest';
import { Fragment, h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { STOP_TEXT, w1, w13, w2Label, w7 } from '@synthetos/safety';
import { AppShell, VIEWS } from '../src/workspace/AppShell.ts';
import { createWorkspaceModel, INITIAL_LIVE_VIEW, portOpen, type LiveView } from '../src/workspace/model.ts';
import { MachineStrip } from '../src/workspace/MachineStrip.ts';
import { stripStatus } from '../src/workspace/status.ts';
import { JogSection, OverridesSection, SpindleSection, ZeroSection } from '../src/workspace/views/RunView.ts';
import { FirmwareTab } from '../src/workspace/views/BoardView.ts';
import { SafetyBar, STOP_UNAVAILABLE } from '../src/shell/SafetyBar.ts';
import { versionLabel } from '../src/build-info/buildInfo.ts';
import { all, byAttr, one, root, text } from './tree.ts';

const build = { version: '1.2.3', sha: '0123456789abcdef0123456789abcdef01234567' };

function escaped(s: string): string {
  return s.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

describe('workspace AppShell (prerendered)', () => {
  const html = renderToString(h(Fragment, null, h(AppShell, { build })));

  it('renders W1 first, then the top bar, the machine strip, the rail and views, and the footer', () => {
    const order = ['data-region="safety-bar"', 'class="topbar"', 'data-region="machine-strip"', 'data-region="rail"', 'data-region="centre"', 'class="footer"'].map((m) => html.indexOf(m));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).toContain(escaped(w1().slice(w1().indexOf(' — ') + 3)));
  });

  it('the rail groups Job and Library, and only Job is shown', () => {
    expect(VIEWS.map((v) => v.label)).toEqual(['Job', 'Library', 'Board', 'Projects', 'Analyze', 'Settings', 'Safety']);
    for (const v of VIEWS) {
      const at = html.indexOf(`data-screen="${v.id}"`);
      expect(at, v.id).toBeGreaterThan(0);
      const tag = html.slice(html.lastIndexOf('<section', at), html.indexOf('>', at));
      expect(tag.includes('hidden'), v.id).toBe(v.id !== 'job');
    }
    expect(html).toMatch(/data-view="job" aria-current="page"/);
  });

  it('the machine strip shows W7 NOT CONNECTED, and Pause and Stop job disabled with the reason', () => {
    expect(html).toContain(escaped(w7().slice(w7().indexOf(' — ') + 3)));
    expect(html).toContain('data-safety="W7"');
    const pause = /<button[^>]*data-safety="W2"[^>]*>/.exec(html)?.[0] ?? '';
    expect(pause).toContain('disabled');
    expect(pause).toContain(`title="${STOP_UNAVAILABLE}"`);
    expect(pause).toContain('aria-describedby="stop-unavailable"');
    const stop = /<button[^>]*data-action="stop-job"[^>]*>/.exec(html)?.[0] ?? '';
    expect(stop).toContain('disabled');
    expect(html).toContain(`<span>${w2Label()}</span>`);
    expect(html).toContain(`<span>${STOP_TEXT.stopJob}</span>`);
    expect(html).toContain(`id="stop-unavailable" class="sr-only">${STOP_UNAVAILABLE}<`);
  });

  it('W13 is on the preview, and the version is in the footer', () => {
    expect(html).toContain(escaped(w13()));
    expect(html).toMatch(new RegExp(`data-version(="")? title="Version ${build.version}, commit ${build.sha}">${escaped(versionLabel(build))}<`));
  });

  it('prerendered, the preview controls are disabled and Start job is disabled with its reason', () => {
    expect(/<input[^>]*data-preview="file"[^>]*>/.exec(html)?.[0]).toContain('disabled');
    expect(/<select[^>]*data-preview="mode"[^>]*>/.exec(html)?.[0]).toContain('disabled');
    expect(/<button[^>]*data-action="start-job"[^>]*>/.exec(html)?.[0]).toContain('disabled');
    expect(html).toContain('Connect to see live job data.');
    expect(html).not.toContain('Phase 1 · no motion');
    expect(html).toContain('Connect a machine to use these controls.');
    expect(html).toContain('Needs firmware support');
  });

  it('carries no inline style attribute (CSP style-src self) and no link to another origin', () => {
    expect(html).not.toMatch(/\sstyle="/);
    expect(html).not.toMatch(/:\/\//);
  });

  it('has no Play, Simulate or Animate control in the preview (SAFETY H15, T-S41)', () => {
    const start = html.indexOf('data-region="preview"');
    const region = html.slice(start, html.indexOf('data-screen="setup"'));
    expect(region.replace(/<[^>]*>/g, ' ')).not.toMatch(/\b(play|simulat|animat)/i);
  });
});

describe('SafetyBar', () => {
  it('page variant: W1 and the version chip, and no machine controls', () => {
    const bar = root(h(SafetyBar, { build, variant: 'page' }));
    expect(text(one(bar, byAttr('data-safety', 'W1')))).toBe(w1());
    expect(text(one(bar, byAttr('data-version')))).toBe(versionLabel(build));
    expect(all(bar, byAttr('data-safety', 'W7'))).toEqual([]);
    expect(all(bar, (e) => e.tag === 'button').every((e) => e.props['data-action'] === 'context-help')).toBe(true);
  });

  it('workspace variant: W1 only, as a labelled region', () => {
    const bar = root(h(SafetyBar, { build, variant: 'workspace' }));
    expect(bar.props['role']).toBe('region');
    expect(bar.props['aria-label']).toBe('Safety');
    expect(text(one(bar, byAttr('data-safety', 'W1')))).toBe(w1());
    expect(all(bar, byAttr('data-version'))).toEqual([]);
    expect(all(bar, (e) => e.tag === 'button').every((e) => e.props['data-action'] === 'context-help')).toBe(true);
  });
});

/**
 * Phase 1: no control in the workspace can act on the machine except the ones allowed to. Every button,
 * input, select and textarea is classified: machine controls carry `data-machine-control` with a class;
 * everything else must match the reviewed list of UI controls below. A new control fails this test until
 * it is classified here.
 */
describe('Phase 1 control allowlist', () => {
  const html = renderToString(h(Fragment, null, h(AppShell, { build })));
  /** Must exist, and be disabled with no handler: they would move the machine or write to the board. */
  /**
   * Amendment 2026-11-02: `home` (G28.2, and G28.3 where homing is not configured) and `offset` (G54..G59, G92,
   * G92.1) are machine controls too, disabled in the prerendered page like the rest.
   */
  const MACHINE_DISABLED = new Set(['jog', 'zero', 'home', 'offset', 'spindle', 'coolant', 'override', 'start']);
  /**
   * The firmware update (SAFETY §4.8 as amended 2026-11-03): every control that can lead to a flash or a trust. Disabled
   * in the prerendered page (no board, no worker); enabled only with the worker's flasher switch on and a board
   * identified, and the worker decides each request (firmware.test.ts).
   */
  const FLASH = new Set(['flash']);
  /**
   * Settings writes (SAFETY §4.6, amendment 2026-11-02): disabled in the prerendered page (no board), and
   * enabled only when the phase switch is on and the machine is idle (the settings-write tests below).
   */
  const SETTINGS_WRITE = new Set(['settings-write']);
  /** Enabled only while a machine is LIVE in this browser (never gated otherwise): Pause and Stop job. */
  const LIVE_ONLY = new Set(['stop']);
  /**
   * Reads only (GETs through the read allowlist): Back up settings, and the Console command line's Send (it sends
   * only allowlisted reads; motion and settings writes are shown and never sent). Disabled until a board is read.
   */
  const READ_ONLY = new Set(['read']);
  /** The Connect flow (live/ConnectPanel.ts): Connect, the C1 confirm and cancel, dismiss, Disconnect. Disconnect also sits in the machine strip, enabled while a port is open or opening (absent otherwise). */
  const CONNECT = new Set(['connect', 'disconnect', 'confirm', 'cancel', 'dismiss']);
  /** Controls that never reach the machine: views, tabs, the preview, and the local libraries. */
  const UI: readonly RegExp[] = [
    /^action:advisor-(open|engine|input)$/,
    /^action:context-help$/,
    /^action:job-(step-(machine|stock|place|check|run|back|next)|files|files-close|projects|close|library-machines|use-machine)$/,
    /^view:(job|library|board|projects|analyze|settings|safety)$/,
    /^tab:(machines|tools|materials|gcode|console|live|spindle|jog|home|zero|overrides|details|buy|cutting|overview|links|basics|safety|stock|fixture|bed|board|pin|mine|tinyg|catalogue)$/,
    /^board-tab:(overview|motors|axes|inputs|io|comms|settings|backups|firmware)$/,
    /^action:(toggle-edit|toggle-pending|discard-pending|remove-pending|clear-apply|cancel-apply|stage-profile)$/,
    // Firmware & Backups: records on this computer (export, import, compare, delete, download) and dialog controls.
    /^action:(backup-compare|backup-export|backup-delete|backup-import|firmware-download|firmware-delete|trust-revoke|trust-cancel|cancel-flash|flash-cancel|flash-dismiss|flash-reconnect|switch-test-start)$/,
    /^preview:(file|rapids|mode|scrubber|fit|cancel|view-iso|view-top|view-front)$/,
    /^sample:(mounting-plate|test-square)$/,
    /^action:(add-tool|fork-material|new-material|edit-material|ask-delete|delete-material|cancel-delete|save-material|cancel-material|close-material|add-safety|add-behaviour|remove-row|add-link|more-link|remove-link|clear-draft|clear-pin|fill-from-board|copy-machine|fixture-file|save-transcript|dismiss-w29|pause-request|stop-job-request)$/,
    /^label:(Toggle day\/night mode|Account: .*|Dialect|Find a machine|back left|back right|center|front left|front right|Link|Shop|Price in US dollars|Close|TinyG v8 board drawing\..*|J\d\.\d .+|M\d\.\d .+|.+, draft|.+, your profile|Search settings|Only pending changes)$/,
    // The Job model (FLOW_ANALYSIS §4 steps 1-4): the job's machine and bed, Save to project, Projects' "Use in Job"
    // and the drawing import, the camera views. Records in this browser and the drawing only; never a board command.
    /^label:(Machine for this job|Project to save the draft to|Drawing units|(Width|Depth|Thickness|Bed top, machine Z), bed)$/,
    /^action:(job-take-bed|bed-save-machine|stock-outline-remove|job-save-to-project|project-use-in-job|project-open-job|project-remove-job|import-cancel|import-accept)$/,
    /^button:(Workshop|Stock|Whole bed|3D|Top|Front|Block|Round|Sheet|Stock top|Stock bottom|\d+ clamps|No clamps|Remove the fixture|Use the sample plate|All|End mills|Ball nose|V-bits|Drills|O-flutes|Built-in|Mine \(\d+\)|Belt driven|Screw driven|Go to Run|T\d+ · .+|Motor \d|X|Y|Z|A)$/,
    /^(input|select|textarea):/,
    // Report a problem (REPORT_A_PROBLEM): opens the dialog and builds links, files and Markdown from data run
    // already holds. Never a board command; the dialog covers the views only, so it never gates Pause or Stop.
    /^action:report-(problem|board|console|event|cancel|next|back|close|copy|download|open)$/,
    /^action:consent-(whole|excerpt)$/,
    // Projects (local): records and files in this browser's IndexedDB. "Open in Run" only loads the preview.
    /^action:project-(new|open|rename|save-name|cancel-rename|delete|confirm-delete|cancel-delete|share|edit-description|save-description|cancel-description|open-in-run|remove-file|set-cover|remove-image|add-link|remove-link|use-stock|go-run)$/,
  ];
  // Material and tool rows are plain buttons whose text is data: any other button must be in the list above.
  const LIST_ROW = /class="(material-row[^"]*|row-link)"/;

  function controls(): { id: string; machine: string | null; disabled: boolean; attrs: string }[] {
    const out: { id: string; machine: string | null; disabled: boolean; attrs: string }[] = [];
    for (const m of html.matchAll(/<(button|input|select|textarea)\b([^>]*)>([\s\S]*?)(?=<\/button>|<(?:button|input|select|textarea)\b|$)/g)) {
      const [, tag, attrs = '', inner = ''] = m;
      const a = (n: string): string | undefined => new RegExp(`\\s${n}="([^"]*)"`).exec(attrs)?.[1];
      const text = tag === 'button' ? inner.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').trim() : '';
      const id =
        (a('data-action') !== undefined ? `action:${a('data-action')}` : undefined) ??
        (a('data-view') !== undefined ? `view:${a('data-view')}` : undefined) ??
        (a('data-tab') !== undefined ? `tab:${a('data-tab')}` : undefined) ??
        (a('data-board-tab') !== undefined ? `board-tab:${a('data-board-tab')}` : undefined) ??
        (a('data-sample') !== undefined ? `sample:${a('data-sample')}` : undefined) ??
        (a('data-preview') !== undefined ? `preview:${a('data-preview')}` : undefined) ??
        (a('aria-label') !== undefined ? `label:${a('aria-label')}` : undefined) ??
        `${tag}:${text}`;
      out.push({ id, machine: a('data-machine-control') ?? null, disabled: /\sdisabled(=|\s|$)/.test(attrs), attrs });
    }
    return out;
  }

  it('every control is classified; machine-acting ones are disabled; only Connect, Pause, Stop job and Back up settings are machine-related', () => {
    const list = controls();
    expect(list.length).toBeGreaterThan(50);
    const seen = new Set<string>();
    for (const c of list) {
      if (c.machine !== null) {
        seen.add(c.machine);
        expect(MACHINE_DISABLED.has(c.machine) || LIVE_ONLY.has(c.machine) || READ_ONLY.has(c.machine) || SETTINGS_WRITE.has(c.machine) || FLASH.has(c.machine), `unknown machine control class ${c.machine}`).toBe(true);
        expect(c.disabled, `${c.machine} control ${c.id} is enabled in the prerendered page`).toBe(true);
        continue;
      }
      const action = c.id.startsWith('action:') ? c.id.slice(7) : null;
      if (action !== null && CONNECT.has(action)) continue;
      if (c.id.startsWith('button:') && !UI.some((r) => r.test(c.id))) {
        expect(LIST_ROW.test(c.attrs), `unclassified control ${c.id}: classify it in shell.test.ts`).toBe(true);
        continue;
      }
      expect(UI.some((r) => r.test(c.id)), `unclassified control ${c.id}: classify it in shell.test.ts`).toBe(true);
    }
    for (const k of MACHINE_DISABLED) expect(seen.has(k), `no ${k} control rendered`).toBe(true);
    expect(seen.has('stop')).toBe(true);
    expect(seen.has('read')).toBe(true);
    expect(seen.has('settings-write')).toBe(true);
    expect(seen.has('flash')).toBe(true);
  });

  it('Disconnect: absent from the prerendered strip; in the machine strip, enabled with a handler, while a port is open or opening', () => {
    const stripOf = (page: string): string => page.slice(page.indexOf('data-region="machine-strip"'), page.indexOf('data-region="rail"'));
    // Prerendered (no model): the strip offers no Disconnect.
    expect(stripOf(html)).not.toContain('data-action="disconnect"');
    const model = createWorkspaceModel();
    const disconnect = vi.fn();
    model.actions.value = { connect: vi.fn(), confirm: vi.fn(), cancel: vi.fn(), disconnect, saveTranscript: vi.fn(), keepBoardSettings: vi.fn(), backup: vi.fn(), transcriptText: () => Promise.resolve(null), consoleRead: vi.fn(), applySettings: vi.fn(), revertSettings: vi.fn(), clearApply: vi.fn() };
    const rendered = (): string => stripOf(renderToString(h(AppShell, { build, model })));
    expect(rendered()).not.toContain('data-action="disconnect"');
    model.live.value = { ...INITIAL_LIVE_VIEW, entry: { step: 'live' } };
    const tag = /<button\b[^>]*data-action="disconnect"[^>]*>/.exec(rendered())?.[0] ?? '';
    expect(tag).not.toBe('');
    expect(tag).not.toMatch(/\sdisabled/);
    expect(tag).not.toContain('data-machine-control');
    // Opening or identifying (the worker has the port) counts as open too; NOT_CONNECTED does not.
    const at = (base: string): LiveView => ({ ...INITIAL_LIVE_VIEW, entry: { step: 'opening' }, message: { snapshot: { base } } as unknown as LiveView['message'] });
    expect(portOpen(at('OPENING'))).toBe(true);
    expect(portOpen(at('IDENTIFYING'))).toBe(true);
    expect(portOpen(at('NOT_CONNECTED'))).toBe(false);
    expect(portOpen(INITIAL_LIVE_VIEW)).toBe(false);
    expect(CONNECT.has('disconnect')).toBe(true);
    // The strip's button calls the Disconnect action; a refusal says why, in the strip (every view).
    const status = stripStatus(INITIAL_LIVE_VIEW, null);
    const strip = root(h(MachineStrip, { status, stop: null, previousSession: false, connection: { onDisconnect: disconnect, refused: 'Disconnecting now would leave the machine running what it has queued. Use Stop job.' } }));
    (one(strip, byAttr('data-action', 'disconnect')).props['onClick'] as () => void)();
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(text(one(strip, byAttr('data-disconnect', 'refused')))).toContain('Disconnecting now would leave');
    expect(all(root(h(MachineStrip, { status, stop: null, previousSession: false, connection: null })), byAttr('data-action', 'disconnect'))).toEqual([]);
  });

  it('the machine-acting controls carry no handler at all: they dispatch nothing', () => {
    // BackupsTab is not here: its Restore control is a settings-write control with a handler, gated by the settings tests (settingsWrite.test.ts).
    // FirmwareTab is not here: its flash controls carry handlers and are gated by the flasher switch (firmware.test.ts).
    const trees = [h(JogSection, null), h(ZeroSection, null), h(SpindleSection, null), h(OverridesSection, null)].map((n) => root(n));
    void FirmwareTab;
    let count = 0;
    for (const tree of trees) {
      for (const el of all(tree, (e) => typeof e.props['data-machine-control'] === 'string' && MACHINE_DISABLED.has(e.props['data-machine-control'] as string))) {
        count += 1;
        expect(el.props['disabled'], String(el.props['aria-label'] ?? el.tag)).toBe(true);
        expect(Object.keys(el.props).filter((k) => /^on[A-Z]/.test(k))).toEqual([]);
      }
    }
    expect(count).toBeGreaterThan(20);
  });
});
