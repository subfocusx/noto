// The styles of the panels of the plugins (Activity, Link Cards, Graph).
//
// The panels had no styles of their own: the browser drew them. The plugins
// now bring a markup that the styles of `src/styles/plugin-*.css` can paint:
// the activity is a grid of days, the links are cards and the graph has its
// own frame.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from '@testing-library/preact';
import { ActivityStore, ActivityView } from '../plugins/builtin/activity/index';
import { LinksStore, LinksView } from '../plugins/builtin/links/index';
import { GraphStore, GraphView } from '../plugins/builtin/graph/index';

const STYLES = resolve(__dirname, '..', 'styles');

/** The text of a file of the styles. */
function css(name: string): string {
  return readFileSync(resolve(STYLES, name), 'utf8');
}

describe('the styles of the panels of the plugins', () => {
  it('ships a file of styles for every panel', () => {
    expect(css('plugin-activity.css')).toContain('.noto-activity-cell');
    expect(css('plugin-links.css')).toContain('.noto-links-card');
    expect(css('plugin-graph.css')).toContain('.noto-graph-node');
  });

  it('uses the tokens of the application and not the colors of the browser', () => {
    for (const name of ['plugin-activity.css', 'plugin-links.css', 'plugin-graph.css']) {
      const text = css(name);
      expect(text).toContain('var(--');
      expect(text).not.toMatch(/:\s*#[0-9a-f]{3,6}\s*;/i);
    }
  });
});

describe('the markup of the panel of the activity', () => {
  it('draws the calendar as a grid of days', () => {
    const store = new ActivityStore();
    store.set({
      ready: true,
      error: null,
      days: [
        { date: '2026-01-01', count: 0 },
        { date: '2026-01-02', count: 3 },
      ],
      max: 3,
      notes: 3,
    });
    render(<ActivityView store={store} />);

    const grid = document.querySelector('.noto-activity-grid');
    expect(grid).not.toBeNull();
    const cells = document.querySelectorAll('.noto-activity-cell');
    expect(cells.length).toBeGreaterThanOrEqual(2);
    expect(document.querySelector('.noto-activity-cell.level-4')).not.toBeNull();
    expect(document.querySelector('.noto-activity-legend')).not.toBeNull();
  });
});

describe('the markup of the panel of the links', () => {
  it('draws every link as a card that can be pressed', () => {
    const store = new LinksStore();
    store.set({
      available: true,
      ready: true,
      error: null,
      notePath: 'a.md',
      outgoing: [{ path: 'a.md', name: 'a.md', title: 'A' }],
      incoming: [],
    });
    render(<LinksView store={store} />);

    const cards = document.querySelectorAll('.noto-links-card');
    expect(cards).toHaveLength(1);
    expect(cards[0]?.tagName).toBe('BUTTON');
    expect(document.querySelector('.noto-links-card-title')?.textContent).toBe('A');
    expect(document.querySelector('.noto-links-section')).not.toBeNull();
  });
});

describe('the markup of the panel of the graph', () => {
  it('draws the graph inside its own frame', () => {
    const store = new GraphStore();
    store.set({
      ready: true,
      error: null,
      data: {
        nodes: [{ path: 'a.md', name: 'a.md', title: 'A', x: 10, y: 10 }],
        edges: [],
      },
    });
    render(<GraphView store={store} />);

    const canvas = document.querySelector('.noto-graph-canvas');
    expect(canvas).not.toBeNull();
    expect(canvas?.querySelector('svg.noto-graph-svg')).not.toBeNull();
    expect(document.querySelectorAll('.noto-graph-node')).toHaveLength(1);
    expect(document.querySelector('.noto-graph-legend')).not.toBeNull();
  });
});
