"""Capture the design study with native Python Playwright; no hardware or workers."""
import argparse
import html
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
            page.add_init_script('window.cspViolations=[]; document.addEventListener("securitypolicyviolation", e => window.cspViolations.push(e.violatedDirective));')
            page.goto(args.url + '#disconnected')
            page.wait_for_load_state('networkidle')
            page.evaluate('(theme) => { document.documentElement.dataset.theme = theme; window.reviewDocument = "unchanged"; }', theme)
            page.evaluate('document.fonts.ready')
            def capture(name):
                assert page.evaluate('window.reviewDocument') == 'unchanged'
                bounds = page.evaluate('({w:document.documentElement.scrollWidth,h:document.documentElement.scrollHeight,iw:innerWidth,ih:innerHeight})')
                assert bounds['w'] <= bounds['iw'] and bounds['h'] <= bounds['ih'], (width, theme, name, bounds)
                for control in ('#pause', '#stop'):
                    box = page.locator(control).bounding_box()
                    assert box and box['x'] >= 0 and box['y'] >= 0 and box['x'] + box['width'] <= width and box['y'] + box['height'] <= height
                    assert page.locator(control).is_enabled()
                file = f'{width}-{theme}-{name}.png'
                page.screenshot(path=str(out / file))
                results.append({'viewport': [width, height], 'theme': theme, 'screen': name, 'screenshot': file, 'document_scroll': False})
            for state in ('disconnected', 'identified', 'idle', 'running', 'held', 'lost', 'orphaned'):
                page.select_option('#scenario', state)
                if state == 'identified':
                    page.click('#load-file')
                if state in ('disconnected', 'orphaned'):
                    assert page.locator('.dro-row strong').first.inner_text() == '—'
                if state == 'running':
                    page.click('#pause')
                    assert page.locator('#machine-state').inner_text() == 'Job running'
                    assert 'Waiting for a controller report' in page.locator('#toast').inner_text()
                    page.select_option('#scenario', state)
                capture(state)
            page.select_option('#scenario', 'idle')
            page.locator('.rail [data-view="configure"]').click()
            capture('configure')
            page.select_option('#connector-select', 'xmin')
            page.select_option('#switch-function', 'Homing only')
            page.click('[data-contact="NO"]')
            assert page.locator('.affected-inputs li').count() == 8
            page.click('#save-draft')
            assert page.locator('.draft-count-label').inner_text() == '(2)'
            page.locator('#input-fields').scroll_into_view_if_needed()
            capture('xmin')
            page.select_option('#connector-select', 'motor1')
            page.select_option('#motor-axis', 'Y')
            page.fill('#motor-current', '2.8')
            page.select_option('#motor-angle', '0.9')
            page.fill('#motor-travel', '20')
            assert '160 steps/mm' in page.locator('#mechanical-story').inner_text()
            page.fill('#motor-travel', '0')
            assert page.locator('#save-draft').is_disabled()
            page.fill('#motor-travel', '20')
            page.click('#save-draft')
            assert page.locator('.draft-count-label').inner_text() == '(2)', 'Updating a draft must not duplicate it'
            page.select_option('#connector-select', 'xmin')
            assert page.locator('#switch-function').input_value() == 'Homing only'
            assert 'selected' in page.locator('[data-contact="NO"]').get_attribute('class')
            page.select_option('#connector-select', 'motor1')
            assert page.locator('#motor-axis').input_value() == 'Y'
            assert page.locator('#motor-current').input_value() == '2.8'
            page.locator('#motor-fields').evaluate('(el) => el.scrollIntoView({block: "start"})')
            capture('motor')
            page.click('[data-dialog="changes"]')
            assert page.locator('.change-card').count() == 2
            assert 'A-max' in page.locator('#dialog-content').inner_text()
            capture('changes')
            page.click('#pause')
            assert page.locator('#machine-state').inner_text() == 'Machine idle'
            page.keyboard.press('Escape')
            assert page.locator('#dialog-wrap').is_hidden()
            page.select_option('#scenario', 'idle')  # Clear feedback before the next captures.
            page.locator('.rail [data-view="machines"]').click()
            capture('machines')
            page.fill('#machine-search', 'Shapeoko')
            assert page.locator('[data-machine]:visible').count() == 1
            page.click('[data-fork="Shapeoko"]')
            page.click('#dialog-action')
            assert page.locator('#my-machine-name').inner_text() == 'My Shapeoko'
            assert 'connected to Workshop router' in page.locator('#editing-context').text_content()
            assert page.locator('.state-title small').inner_text() == 'Workshop router · TinyG v8 · simulated'
            page.select_option('#scenario', 'idle')
            page.locator('.rail [data-view="projects"]').click()
            capture('projects')
            page.click('[data-operation="contour"]')
            assert page.locator('[data-screen="run"]').is_visible()
            page.go_back()
            assert page.locator('[data-screen="projects"]').is_visible()
            page.locator('.rail [data-view="configure"]').click()
            page.click('[data-dialog="changes"]')
            page.click('#dialog-action')
            assert page.locator('.draft-count-label').inner_text() == '(0)'
            assert page.evaluate('window.reviewDocument') == 'unchanged'
            assert not page.workers
            assert not page.evaluate('window.cspViolations'), page.evaluate('window.cspViolations')
            assert not errors, errors
            assert not external, external
            context.close()
    browser.close()
checks = 'Five state families / seven variants; X-min shared polarity; motor mechanics and validation; saved per-connector drafts; review/clear; persistent controls and document; no overflow, workers, external requests, page errors or CSP violations.'
(out / 'manifest.json').write_text(json.dumps({'screenshots': results, 'checks': checks}, indent=2) + '\n')
(out / 'validation.json').write_text(json.dumps({'status': 'passed', 'screenshots': len(results), 'checks': checks}, indent=2) + '\n')
cards = ''.join(f'<figure><a href="{r["screenshot"]}"><img loading="lazy" src="{r["screenshot"]}" alt="{html.escape(r["screen"])}"></a><figcaption>{r["viewport"][0]} · {r["theme"]} · {html.escape(r["screen"])}</figcaption></figure>' for r in results)
(out / 'review.html').write_text('<!doctype html><meta charset="utf-8"><title>Run workspace · increment 1</title><style>body{font:16px system-ui;margin:32px;background:#eef2f5;color:#15222c}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:20px}figure{margin:0;background:white;padding:12px}img{width:100%;height:240px;object-fit:contain}figcaption{padding-top:10px}h1{font-size:28px}</style><h1>Run workspace · increment 1</h1><p>104 views · four sizes · both themes. Click any image for its full resolution.</p><main>' + cards + '</main>')
print(f'PASS: {len(results)} screenshots and interaction checks in {out}')
