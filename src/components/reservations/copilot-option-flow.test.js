import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CopilotBubble, CopilotOptionFlow } from './copilot-option-flow';

beforeEach(() => { vi.stubGlobal('React', React); });
afterEach(() => vi.unstubAllGlobals());

const pair = {
  vehicle_id: 3,
  driver_id: 4,
  vehicle: { plate_number: 'ABC-1234', vehicle_name: 'Toyota HiAce', seating_capacity: 7 },
  driver: { driver_name: 'Maria Santos' },
  checks: [{ id: 'capacity', label: 'Capacity', status: 'verified', message: 'Sufficient seats' }],
  readiness: 'VERIFIED',
  feasibility: { verdict: 'SAFE' },
  temporalContext: { horizon: 'FUTURE', pickupAt: '2026-10-05T08:00:00+08:00' },
};

const renderOptions = () => renderToStaticMarkup(React.createElement(CopilotOptionFlow, {
  options: [{ pair, recommended: true }],
  busy: false,
  onChoose: () => {},
  now: Date.parse('2026-10-02T00:00:00Z'),
}));

it('renders each option as a noninteractive article with a sibling native disclosure', () => {
  const html = renderOptions();
  const article = html.match(/<article\b[\s\S]*?<\/article>/)?.[0];

  expect(article).toBeDefined();
  expect(article).not.toMatch(/role="button"|tabindex=|onkeydown=|onclick=/i);
  const articleStart = html.indexOf(article);
  const beforeArticle = html.slice(0, articleStart);
  expect(beforeArticle).not.toMatch(/<button\b[^>]*>(?:(?!<\/button>)[\s\S])*$/);
  expect(article).toMatch(/<details\b[\s\S]*?<summary\b[\s\S]*?<\/summary>/);
  expect(article.match(/<button\b/g)).toHaveLength(1);
  expect(article).toMatch(/<\/details>[\s\S]*?<button\b/);
});

it('names the single pair-selection control with its vehicle plate and driver', () => {
  const article = renderOptions().match(/<article\b[\s\S]*?<\/article>/)?.[0];
  const choiceButton = article?.match(/<button\b[^>]*>[\s\S]*?<\/button>/)?.[0];

  expect(choiceButton).toMatch(/aria-label="[^"]*ABC-1234[^"]*Maria Santos[^"]*recommended/);
});

it('marks the repeated assistant avatar as decorative', () => {
  const html = renderToStaticMarkup(React.createElement(CopilotBubble, null, 'Recommended options'));

  expect(html).toMatch(/<img\b[^>]*alt=""[^>]*>/);
});
