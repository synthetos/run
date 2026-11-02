"""Review the static prototype; needs Python Playwright and its Chromium browser.
Serve the repository root on loopback, then run capture.py --output <directory>.
No serial permissions are granted; no machine worker exists in this prototype.
"""
import argparse
import json
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser()
parser.add_argument('--url', default='http://127.0.0.1:8766/docs/design/workspace-prototype/')
parser.add_argument('--output', required=True)
args = parser.parse_args()
assert urlparse(args.url).hostname in ('127.0.0.1', 'localhost'), 'Loopback only'
out = Path(args.output)
out.mkdir(parents=True, exist_ok=True)
results = []
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    for width, height in ((1280, 720), (1440, 900), (1920, 1080), (390, 844)):
        for theme in ('light', 'dark'):
            context = browser.new_context(viewport={'width': width, 'height': height}, color_scheme=theme, device_scale_factor=1)
            errors, external = [], []
            def guard(route):
                if urlparse(route.request.url).netloc != urlparse(args.url).netloc:
                    external.append(route.request.url)
                    route.abort()
                else:
                    route.continue_()
            context.route('**/*', guard)
            page = context.new_page()
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.goto(args.url + '#run')
            page.wait_for_load_state('networkidle')
            page.evaluate('(theme) => { document.documentElement.dataset.theme = theme; window.reviewDocument = "unchanged"; window.cspViolations = []; document.addEventListener("securitypolicyviolation", e => window.cspViolations.push(e.violatedDirective)); }', theme)
            page.evaluate('document.fonts.ready')
            assert page.locator('#toast').is_hidden(), 'Empty feedback must not render a blank overlay'
            for name in ('idle', 'loaded', 'configure', 'machines', 'projects'):
                if name == 'loaded':
                    page.locator('#load-file').click()
                elif name != 'idle':
                    page.locator(f'.rail [data-view="{name}"]').click()
                assert page.evaluate('window.reviewDocument') == 'unchanged'
                bounds = page.evaluate('({w:document.documentElement.scrollWidth,h:document.documentElement.scrollHeight,iw:innerWidth,ih:innerHeight})')
                assert bounds['w'] <= bounds['iw'] and bounds['h'] <= bounds['ih'], (width, theme, name, bounds)
                for control in ('#pause', '#stop'):
                    box = page.locator(control).bounding_box()
                    assert box and box['x'] >= 0 and box['y'] >= 0 and box['x'] + box['width'] <= width and box['y'] + box['height'] <= height
                file = f'{width}-{theme}-{name}.png'
                page.screenshot(path=str(out / file))
                results.append({'viewport':[width,height], 'theme':theme, 'screen':name, 'screenshot':file, 'document_scroll':False})
            # Meaningful interaction checks, beyond rendering.
            page.locator('.rail [data-view="configure"]').click()
            page.locator('#connector-select').select_option('motor1')
            assert page.locator('#motor-fields').is_visible()
            page.locator('#save-draft').click()
            assert page.locator('.draft-count-label').inner_text() == '(1)'
            page.locator('[data-dialog="changes"]').click()
            page.locator('#pause').click()
            assert page.locator('#machine-state').inner_text() == 'Machine idle'
            assert 'idle' in page.locator('#toast').inner_text()
            page.keyboard.press('Escape')
            assert page.locator('#dialog-wrap').is_hidden()
            page.locator('.rail [data-view="machines"]').click()
            page.locator('#machine-search').fill('Shapeoko')
            assert page.locator('[data-machine]:visible').count() == 1
            page.locator('[data-fork="Shapeoko"]').click()
            page.locator('#dialog-action').click()
            assert page.locator('#my-machine-name').inner_text() == 'My Shapeoko'
            assert page.locator('.state-title small').inner_text() == 'Workshop router · TinyG v8 · simulated'
            page.locator('.rail [data-view="projects"]').click()
            page.locator('[data-operation="contour"]').click()
            assert page.locator('[data-screen="run"]').is_visible()
            page.go_back()
            assert page.locator('[data-screen="projects"]').is_visible()
            assert page.evaluate('window.reviewDocument') == 'unchanged'
            assert not page.workers
            assert not page.evaluate('window.cspViolations'), page.evaluate('window.cspViolations')
            assert not errors, errors
            assert not external, external
            context.close()
    browser.close()
(out/'manifest.json').write_text(json.dumps({'screenshots':results, 'checks':'40 screenshots; no document overflow or navigation; controls visible; connector/draft, modal Pause/Escape, machine copy, project load, Back, no workers/external requests/page errors/CSP violations'}, indent=2)+'\n')
print(f'PASS: {len(results)} screenshots and interaction checks in {out}')
