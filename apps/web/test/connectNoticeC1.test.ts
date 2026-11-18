/**
 * The C1 markup ConnectNotice renders, which tools/e2e/specs/setup-wizard-layout.fake-serial.ts copies into the
 * wizard to measure it (C1 cannot be reached on 127.0.0.1). If this structure changes, change the copy there too.
 */
import { describe, expect, it } from 'vitest';
import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { c1Checklist } from '../src/live/c1.ts';
import { createWorkspaceModel, INITIAL_LIVE_VIEW, type LiveView } from '../src/workspace/model.ts';
import { ConnectNotice } from '../src/workspace/views/run/connect.ts';

describe('ConnectNotice in the C1 step', () => {
  it('renders the dialog wrap, the dialog, the C1 form and one checkbox label per line inside the connect region', () => {
    const model = createWorkspaceModel();
    model.live.value = { ...INITIAL_LIVE_VIEW, entry: { step: 'c1', form: 'full' } } as unknown as LiveView;
    const html = renderToString(h(ConnectNotice, { model }));
    expect(html).toMatch(/^<div class="scenario-notice connect-notice" data-region="connect">/);
    expect(html).toContain('<div class="dialog-wrap" role="presentation"><div class="dialog" role="dialog" aria-modal="true" aria-labelledby="c1-title"><div class="dialog-head"><h2 id="c1-title">Before you connect</h2></div><form class="live-entry c1" data-entry="c1" data-c1-form="full" data-safety="C1">');
    const lines = c1Checklist('full').boxes;
    expect(lines).toHaveLength(5);
    for (const i of lines.keys()) expect(html).toContain(`<label class="c1-box"><input type="checkbox" name="c1-${i}" required aria-label="`);
    expect(html).toContain(`> ${lines[0] ?? ''}</label>`);
    expect(html).toContain('<div class="c1-actions"><button type="submit" class="button" data-action="confirm">Confirm and choose port</button><button type="button" class="button" data-action="cancel">Cancel</button></div>');
  });
});
