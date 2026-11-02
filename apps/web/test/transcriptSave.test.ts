/** P1-08: the Save transcript panel, its file name and its privacy warning. */
import { describe, expect, it } from 'vitest';
import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { TRANSCRIPT_PRIVACY, TranscriptSave, transcriptFileName } from '../src/machine-ui/TranscriptSave.ts';

describe('TranscriptSave', () => {
  it('names the file with the UTC date and time, without colons', () => {
    expect(transcriptFileName(new Date('2026-11-02T07:15:26.123Z'))).toBe('run-transcript-2026-11-02T07-15-26Z.jsonl');
  });

  it('warns that the transcript holds the board id, next to the button', () => {
    const html = renderToString(h(TranscriptSave, { status: { kind: 'idle' }, onSave: () => undefined }));
    expect(TRANSCRIPT_PRIVACY).toContain('unique hardware id');
    expect(html).toContain('data-transcript="privacy"');
    expect(html).toContain('data-action="save-transcript"');
  });

  it('shows saving, saved and failed', () => {
    const r = (status: Parameters<typeof TranscriptSave>[0]['status']): string => renderToString(h(TranscriptSave, { status, onSave: () => undefined }));
    expect(r({ kind: 'saving' })).toContain('disabled');
    expect(r({ kind: 'saved', name: 'run-transcript-x.jsonl', events: 12 })).toContain('Saved run-transcript-x.jsonl (12 events).');
    expect(r({ kind: 'failed', message: 'no link has opened' })).toContain('no link has opened');
  });
});
