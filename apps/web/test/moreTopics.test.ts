import { describe, expect, it } from 'vitest';
import { MORE_TOPICS } from '../src/wizard/moreTopics.ts';

const VIEWS = ['job', 'library', 'board', 'projects', 'analyze', 'settings', 'safety', 'machines', 'tools', 'materials'];

describe('the "More to set up" topics (spec §6.3 step 7)', () => {
  it('starts with the six topics the spec names, in order, with unique ids', () => {
    expect(MORE_TOPICS.map((t) => t.id)).toEqual(['materials-feeds', 'work-zero-probing', 'feed-override', 'firmware-backups', 'projects-zip', 'report-problem']);
    expect(new Set(MORE_TOPICS.map((t) => t.id)).size).toBe(MORE_TOPICS.length);
  });
  it('every row has a title, two or three lines of one short sentence each, and a place in Run that exists', () => {
    for (const t of MORE_TOPICS) {
      expect(t.title.length).toBeGreaterThan(3);
      expect(t.lines.length).toBeGreaterThanOrEqual(2);
      expect(t.lines.length).toBeLessThanOrEqual(3);
      for (const line of t.lines) {
        expect(line.endsWith('.')).toBe(true);
        expect(line.slice(0, -1)).not.toContain('. ');
        expect(line.split(' ').length).toBeLessThanOrEqual(22);
      }
      expect(VIEWS).toContain(t.go.view);
      expect(t.go.label.length).toBeGreaterThan(3);
    }
  });
  it('carries no reassurance filler', () => {
    expect(JSON.stringify(MORE_TOPICS)).not.toMatch(/E-stop|never need|Saved in this browser|within reach/);
  });
});
