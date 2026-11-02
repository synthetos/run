/**
 * The workspace shell (Stage 1) and the safety bar: W1 first, the top bar,
 * the machine strip with W7 NOT CONNECTED and the disabled Pause (W2) and
 * Stop job, the ten-view rail with only Run shown, W13 on the preview, and
 * the version in the footer. The browser-level checks (no document scroll,
 * view switching keeps the worker, axe) are in tools/e2e.
 */
import { describe, expect, it } from 'vitest';
import { Fragment, h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { STOP_TEXT, w1, w13, w2Label, w7 } from '@synthetos/safety';
import { AppShell, VIEWS } from '../src/workspace/AppShell.ts';
import { JogSection, OverridesSection, SpindleSection } from '../src/workspace/views/RunView.ts';
import { BackupsTab, FirmwareTab } from '../src/workspace/views/BoardView.ts';
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

  it('the rail lists the ten views in order, and only Run is shown', () => {
    expect(VIEWS.map((v) => v.label)).toEqual(['Run', 'Setup', 'Tools', 'Materials', 'Board', 'Machines', 'Projects', 'Analyze', 'Settings', 'Safety']);
    for (const v of VIEWS) {
      const at = html.indexOf(`data-screen="${v.id}"`);
      expect(at, v.id).toBeGreaterThan(0);
      const tag = html.slice(html.lastIndexOf('<section', at), html.indexOf('>', at));
      expect(tag.includes('hidden'), v.id).toBe(v.id !== 'run');
    }
    expect(html).toMatch(/data-view="run" aria-current="page"/);
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
    expect(html).toContain('Running jobs arrives in a later phase.');
    expect(html).toContain('Jogging arrives with motion control.');
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
    expect(all(bar, (e) => e.tag === 'button')).toEqual([]);
  });

  it('workspace variant: W1 only, as a labelled region', () => {
    const bar = root(h(SafetyBar, { build, variant: 'workspace' }));
    expect(bar.props['role']).toBe('region');
    expect(bar.props['aria-label']).toBe('Safety');
    expect(text(one(bar, byAttr('data-safety', 'W1')))).toBe(w1());
    expect(all(bar, byAttr('data-version'))).toEqual([]);
    expect(all(bar, (e) => e.tag === 'button')).toEqual([]);
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
  const MACHINE_DISABLED = new Set(['jog', 'zero', 'spindle', 'coolant', 'override', 'start', 'settings-write', 'firmware']);
  /** Enabled only while a machine is LIVE in this browser (never gated otherwise): Pause and Stop job. */
  const LIVE_ONLY = new Set(['stop']);
  /**
   * Reads only (GETs through the read allowlist): Back up settings, and the Console command line's Send (it sends
   * only allowlisted reads; motion and settings writes are shown and never sent). Disabled until a board is read.
   */
  const READ_ONLY = new Set(['read']);
  /** The Connect flow (live/ConnectPanel.ts): Connect, the C1 confirm and cancel, dismiss, Disconnect. */
  const CONNECT = new Set(['connect', 'disconnect', 'confirm', 'cancel', 'dismiss']);
  /** Controls that never reach the machine: views, tabs, the preview, and the local libraries. */
  const UI: readonly RegExp[] = [
    /^view:(run|setup|tools|materials|board|machines|projects|analyze|settings|safety)$/,
    /^tab:(gcode|console|live|spindle|jog|overrides|details|buy|cutting|overview|links|basics|safety|stock|fixture|bed|board|pin|mine|tinyg|catalogue)$/,
    /^board-tab:(overview|motors|axes|inputs|io|comms|settings|backups|firmware)$/,
    /^preview:(file|rapids|mode|scrubber|fit|cancel)$/,
    /^sample:(mounting-plate|test-square)$/,
    /^action:(add-tool|fork-material|new-material|edit-material|ask-delete|delete-material|cancel-delete|save-material|cancel-material|close-material|add-safety|add-behaviour|remove-row|add-link|more-link|remove-link|clear-draft|clear-pin|fill-from-board|copy-machine|fixture-file|save-transcript|dismiss-w29|pause-request|stop-job-request)$/,
    /^label:(Toggle day\/night mode|Account: .*|Dialect|Find a machine|back left|back right|center|front left|front right|Link|Shop|Price in US dollars|Close|TinyG v8 board drawing\..*|J\d\.\d .+|M\d\.\d .+|.+, draft|.+, your profile)$/,
    /^button:(Workshop|Stock|Whole bed|3D|Top|Front|Block|Round|Sheet|Stock top|Stock bottom|\d+ clamps|No clamps|Remove the fixture|Use the sample plate|All|End mills|Ball nose|V-bits|Drills|O-flutes|Built-in|Mine \(\d+\)|Belt driven|Screw driven|Go to Run|T\d+ · .+|Motor \d|X|Y|Z|A)$/,
    /^(input|select|textarea):/,
    // Report a problem (REPORT_A_PROBLEM): opens the dialog and builds links, files and Markdown from data run
    // already holds. Never a board command; the dialog covers the views only, so it never gates Pause or Stop.
    /^action:report-(problem|board|console|event|cancel|next|back|close|copy|download|open)$/,
    /^action:consent-(whole|excerpt)$/,
    // Projects (local): records and files in this browser's IndexedDB. "Open in Run" only loads the preview.
    /^action:project-(new|rename|save-name|cancel-rename|delete|confirm-delete|cancel-delete|share|edit-description|save-description|cancel-description|open-in-run|remove-file|set-cover|remove-image|add-link|remove-link|use-stock|go-run)$/,
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
        expect(MACHINE_DISABLED.has(c.machine) || LIVE_ONLY.has(c.machine) || READ_ONLY.has(c.machine), `unknown machine control class ${c.machine}`).toBe(true);
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
  });

  it('the machine-acting controls carry no handler at all: they dispatch nothing', () => {
    const trees = [h(JogSection, null), h(SpindleSection, null), h(OverridesSection, null), h(FirmwareTab, { view: null }), h(BackupsTab, { model: null })].map((n) => root(n));
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
