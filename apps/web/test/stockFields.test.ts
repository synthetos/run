import { describe, expect, it } from 'vitest';
import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { readStock } from '@synthetos/library';
import { DEFAULT_STOCK_FIELDS, fieldsFromStock, newToolSince, stockFromFields } from '../src/wizard/stockFields.ts';
import { ToolsStock, TOOLS_LEAD, TOOLS_TITLE } from '../src/wizard/steps/ToolsStock.ts';
import { SEED_TOOLS } from '../src/workspace/librarySeed.ts';
import { SEED_SETUP } from '../src/workspace/library.ts';

describe('stock fields (Review Focus 4)', () => {
  it('default to the demo stock and read back as a block of MDF with work zero front-left-top', () => {
    expect(DEFAULT_STOCK_FIELDS).toEqual({ width: '180', depth: '120', thickness: '6.35' });
    const stock = stockFromFields(DEFAULT_STOCK_FIELDS);
    expect(stock).toMatchObject({ shape: 'block', width: 180, depth: 120, thickness: 6.35, materialRef: { id: 'builtin.mdf' }, zero: { corner: 'front-left', height: 'top' }, position: SEED_SETUP.stock.position });
    expect(readStock(stock).ok).toBe(true);
  });
  it('is null unless all three parse to a positive number', () => {
    expect(stockFromFields({ ...DEFAULT_STOCK_FIELDS, width: '0' })).toBeNull();
    expect(stockFromFields({ ...DEFAULT_STOCK_FIELDS, depth: '-5' })).toBeNull();
    expect(stockFromFields({ ...DEFAULT_STOCK_FIELDS, thickness: '' })).toBeNull();
    expect(stockFromFields({ ...DEFAULT_STOCK_FIELDS, thickness: 'thick' })).toBeNull();
    expect(stockFromFields({ width: '200', depth: '100.5', thickness: '12' })).toMatchObject({ width: 200, depth: 100.5, thickness: 12 });
  });
  it('fieldsFromStock round-trips and falls back to the defaults', () => {
    expect(fieldsFromStock({ ...SEED_SETUP.stock, width: 200, depth: 100, thickness: 12 })).toEqual({ width: '200', depth: '100', thickness: '12' });
    expect(fieldsFromStock(null)).toEqual(DEFAULT_STOCK_FIELDS);
  });
  it('newToolSince picks the entry whose id was not there before', () => {
    const before = SEED_TOOLS.slice(0, 2);
    const added = { number: 7, store: null, tool: { ...SEED_TOOLS[2]!.tool, id: 'mine.new' } };
    expect(newToolSince(before, [...before, added])).toBe(added);
    expect(newToolSince(before, before)).toBeNull();
    expect(newToolSince(before, [before[0]!])).toBeNull();
  });
});

describe('step 5 Tools and stock (render)', () => {
  const base = { tool: null, stock: null, fields: DEFAULT_STOCK_FIELDS, onFields: () => undefined, onAddStock: () => undefined, onCatalog: () => undefined, onCreate: () => undefined, catalogOpen: false, creating: false, onCloseModal: () => undefined };
  it('two cards: the tool actions and the three stock fields sized to content', () => {
    expect(TOOLS_TITLE).toBe('Tools and stock');
    expect(TOOLS_LEAD).toBe('One of each is enough to run the demo.');
    const html = renderToString(h(ToolsStock, base));
    expect(html.match(/class="wizard-card"/g)).toHaveLength(2);
    expect(html).toContain('data-action="wizard-catalog"');
    expect(html).toContain('data-action="wizard-create-tool"');
    expect(html.match(/class="field f-num"/g)).toHaveLength(3);
    expect(html).toMatch(/data-action="wizard-add-stock"[^>]*>Add stock</);
    expect(html).not.toContain('disabled');
    expect(html).not.toMatch(/E-stop|never need|Saved in this browser/);
  });
  it('shows the chosen tool and the saved stock; Add stock is disabled on bad fields', () => {
    const entry = SEED_TOOLS[0]!;
    const html = renderToString(h(ToolsStock, { ...base, tool: entry, stock: SEED_SETUP.stock, fields: { ...DEFAULT_STOCK_FIELDS, width: '0' } }));
    expect(html).toContain(`T${entry.number} · `);
    expect(html).toMatch(/data-action="wizard-add-stock"[^>]*disabled[^>]*>Add stock</);
    const saved = renderToString(h(ToolsStock, { ...base, stock: SEED_SETUP.stock, fields: fieldsFromStock(SEED_SETUP.stock) }));
    expect(saved).toMatch(/data-action="wizard-add-stock"[^>]*disabled[^>]*>Stock saved</);
  });
  it('the catalog opens in place of the tool card; the tool editor opens on top', () => {
    const open = renderToString(h(ToolsStock, { ...base, catalogOpen: true }));
    expect(open).toContain('class="wizard-embed"');
    expect(open).toContain('Tool catalog');
    expect(open).toContain('data-action="wizard-catalog-back"');
    const creating = renderToString(h(ToolsStock, { ...base, creating: true }));
    expect(creating).toContain('tool-modal');
  });
});
