/**
 * Prerendering (ROADMAP P0-05): every page's HTML carries the safety bar with
 * W1 before any script runs, and every warning comes from strings.ts. Also
 * checks the safety page content the roadmap requires and that only the
 * reviewed outbound links appear, never in client-side code.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Fragment, h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { CANNOT_GUARANTEE, w1, w10, w16, w22, w2Label } from '@synthetos/safety';
import { BODY_MARKER, prerenderPage } from '../build/prerender.ts';
import { PAGES } from '../src/pages/registry.ts';
import { OUTBOUND, OUTBOUND_URLS } from '../src/pages/outbound.ts';
import { Shell } from '../src/shell/Shell.ts';

const web = resolve(import.meta.dirname, '..');
const build = { version: '0.0.0', sha: 'b'.repeat(40) };
const HTML_FILES = ['index.html', 'safety/index.html', 'privacy/index.html', '404.html'];

/** The text of the HTML as a browser would show it, entities decoded (only the ones renderToString emits). */
function decoded(html: string): string {
  return html.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function rendered(path: string): string {
  return prerenderPage(path, readFileSync(join(web, path.slice(1)), 'utf8'), build);
}

describe('prerender', () => {
  it('every HTML page is a Vite input, is registered, and holds the body marker exactly once', () => {
    const config = readFileSync(join(web, 'vite.config.ts'), 'utf8');
    for (const file of HTML_FILES) {
      expect(config, file).toContain(`'${file}'`);
      const html = readFileSync(join(web, file), 'utf8');
      expect(html.split(BODY_MARKER).length - 1, file).toBe(1);
    }
    expect(Object.keys(PAGES).sort()).toEqual(HTML_FILES.map((f) => `/${f}`).sort());
  });

  it('puts the safety bar with W1 into every page', () => {
    for (const path of Object.keys(PAGES)) {
      const html = decoded(rendered(path));
      expect(html, path).not.toContain(BODY_MARKER);
      expect(html, path).toContain('data-region="safety-bar"');
      expect(html.replace(/<[^>]+>/g, ''), path).toContain(w1());
    }
  });

  it('refuses an unregistered page, a missing marker and a repeated marker', () => {
    expect(() => prerenderPage('/other.html', BODY_MARKER, build)).toThrow(/no page registered/);
    expect(() => prerenderPage('/index.html', '<body></body>', build)).toThrow(/exactly once/);
    expect(() => prerenderPage('/index.html', BODY_MARKER + BODY_MARKER, build)).toThrow(/exactly once/);
  });

  it('the 404 page keeps its marker attribute for the asset layer tests', () => {
    expect(rendered('/404.html')).toContain('data-page="not-found"');
  });
});

describe('the /safety/ page', () => {
  const html = rendered('/safety/index.html');
  const visible = decoded(html.replace(/<[^>]+>/g, ''));

  it('shows the SAFETY §7 list verbatim, in order, in one ordered list', () => {
    const list = /<ol class="guarantee-list" data-safety="S7">(.*?)<\/ol>/s.exec(html);
    expect(list).not.toBeNull();
    const items = [...(list?.[1] ?? '').matchAll(/<li>(.*?)<\/li>/gs)].map((m) => decoded(m[1] as string));
    expect(items).toEqual([...CANNOT_GUARANTEE]);
  });

  it('the sign-out rule matches the amended W22 in SAFETY.md, word for word (batch 6, finding P0-05 W22)', () => {
    const safetyMd = readFileSync(resolve(web, '../../SAFETY.md'), 'utf8');
    const entry = /^- \*\*W22 [^*]*:\*\* "([^"]+)"$/m.exec(safetyMd);
    expect(entry, 'SAFETY.md has a W22 entry').not.toBeNull();
    const quoted = entry?.[1] as string;
    expect(w22()).toBe(quoted);
    const block = /<p data-safety="W22"[^>]*>(.*?)<\/p>/s.exec(html);
    expect(block, 'the page quotes W22 in a data-safety="W22" element').not.toBeNull();
    expect(decoded((block?.[1] ?? '').replace(/<[^>]+>/g, ''))).toBe(quoted);
    // The plain-language rule names every action W22 says needs a new sign-in.
    const gated = /Sign in again to (.+?)\./.exec(quoted)?.[1] ?? '';
    const actions = gated.replace(/,? or /, ', ').split(', ');
    expect(actions).toEqual(['start a job', 'jog', 'home', 'change settings']);
    const rule = /<li data-safety-rule="sign-out">(.*?)<\/li>/s.exec(html);
    expect(rule).not.toBeNull();
    const ruleText = decoded((rule?.[1] ?? '').replace(/<[^>]+>/g, ''));
    for (const words of ['starting a job', 'jogging', 'homing', 'changing settings']) expect(ruleText).toContain(words);
    // The old text said sign-out only blocks new jobs, which W22 no longer allows.
    expect(visible).not.toMatch(/only prevents starting new ones/);
  });

  it('explains the stop categories, using the W2, W10 and W16 strings', () => {
    expect(visible).toContain('category 0');
    expect(visible).toContain('category 2');
    expect(visible).toContain(w2Label());
    expect(visible).toContain(w10());
    expect(visible).toContain(w16());
  });

  it('states the E-stop requirements', () => {
    for (const phrase of ['Latching.', 'Normally-closed contacts.', 'motor power (Vmot)', 'spindle or VFD power', 'Never the reset button.', 'Consult a qualified electrician.']) {
      expect(visible, phrase).toContain(phrase);
    }
    expect(visible).toContain('must remove motor and spindle power in hardware');
  });

  it('covers tab and OS hygiene, with the Chrome "Always keep these sites active" help link', () => {
    expect(visible).toContain('Always keep these sites active');
    expect(html).toContain(`href="${OUTBOUND.chromeKeepActive}"`);
    expect(visible).toContain('Turn off sleep and screen lock');
  });

  it('says how to report a safety issue, E-stop first', () => {
    expect(visible).toContain('stop it with your E-stop first');
    expect(html).toContain(`href="${OUTBOUND.reportVulnerability}"`);
  });

  it('says plainly that the account is never in the stop path (D1) and that this version cannot connect', () => {
    expect(visible).toContain('never need you to be signed in');
    expect(visible).toContain('This version cannot connect to a machine.');
  });
});

describe('outbound links', () => {
  it('pages link to other origins only through the reviewed list, as plain anchors', () => {
    for (const path of Object.keys(PAGES)) {
      const html = decoded(rendered(path));
      for (const m of html.matchAll(/[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi)) {
        expect(OUTBOUND_URLS, `${path}: ${m[0]}`).toContain(m[0]);
        expect(html.slice(Math.max(0, (m.index ?? 0) - 9), m.index), `${path}: ${m[0]}`).toBe('<a href="');
      }
    }
  });

  it('the shell, which ships in the client bundle, links to no other origin', () => {
    expect(renderToString(h(Fragment, null, h(Shell, { build })))).not.toMatch(/:\/\//);
  });
});
