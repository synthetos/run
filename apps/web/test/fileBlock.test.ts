/**
 * The job's file block (spec §7, workspace/views/run/fileBlock.ts): the top "No file open" bar is gone, and the file
 * controls it carried (the picker, the file name, Close job, Save to project) live in step 3, "Open & place job".
 */
import { describe, expect, it } from 'vitest';
import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import type { PreviewParts } from '../src/preview/PreviewPanel.ts';
import { SEED_JOB } from '../src/workspace/jobModel.ts';
import { JobFileBlock } from '../src/workspace/views/run/fileBlock.ts';
import { JobProjectLine } from '../src/workspace/views/run/projectLine.ts';

function parts(fileName: string | null): PreviewParts {
  const result = fileName === null ? null : { fileLines: 12, sourceLines: [], summary: { blocked: false, counts: { warn: 0 } } };
  const state = { ready: true, dialect: 'tinyg', mode: 'auto', status: fileName === null ? 'idle' : 'ready', progress: null, fileName, error: null, result, showRapids: true, scrub: 0, drawing: 'svg' };
  return { state, actions: {}, slots: {}, live: null, scene: null, toolInPath: null, tool: null } as unknown as PreviewParts;
}

const block = (fileName: string | null, step: 'place' | 'machine') => renderToString(h(JobFileBlock, { parts: parts(fileName), model: null, step }));

describe('the job file block', () => {
  it('at step 3 it offers the picker and names no file; no Close job yet', () => {
    const html = block(null, 'place');
    expect(html).toContain('data-job-panel="file"');
    expect(html).toContain('data-region="job"');
    expect(html).not.toMatch(/<section[^>]*\shidden/);
    expect(html).toContain('data-preview="file"');
    expect(html).toMatch(/data-preview="file-name"[^>]*>none</);
    expect(html).toContain('Open a file');
    expect(html).not.toContain('data-action="job-close"');
    expect(html).not.toContain('data-action="job-files"');
    expect(html).not.toContain('data-action="job-projects"');
  });

  it('on another step the block is hidden but still holds the picker the viewer prompt clicks', () => {
    const html = block(null, 'machine');
    expect(html).toMatch(/<section[^>]*\shidden/);
    expect(html).toContain('data-preview="file"');
  });

  it('with a file open: the name, its lines, Open another and Close job', () => {
    const html = block('plate.nc', 'place');
    expect(html).toMatch(/data-preview="file-name"[^>]*>plate\.nc</);
    expect(html).toContain('12 lines');
    expect(html).toContain('Open another');
    expect(html).toContain('data-action="job-close"');
  });
});

describe('the project line', () => {
  const line = (job: typeof SEED_JOB, fileOpen: boolean) => renderToString(h(JobProjectLine, { job, fileOpen, onNote: () => undefined }));

  it('a draft with a file open offers Save to project; without a file it says nothing', () => {
    expect(line(SEED_JOB, true)).toContain('data-action="job-save-to-project"');
    expect(line(SEED_JOB, true)).toContain('data-job="save-target"');
    expect(line(SEED_JOB, false)).toBe('');
  });

  it('a project job names its project and offers no save', () => {
    const html = line({ ...SEED_JOB, projectId: 'proj_1' }, true);
    expect(html).toContain('data-job="project"');
    expect(html).not.toContain('job-save-to-project');
  });
});
