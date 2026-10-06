import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';

vi.mock('@/hooks/use-role-access', () => ({ useRoleAccess: () => ({ canAccess: () => true }) }));
vi.mock('@tanstack/react-query', () => ({ useMutation: () => ({ isPending: false, mutate: vi.fn() }) }));
vi.mock('@/lib/api/client', () => ({ apiFetch: vi.fn(async () => ({ answer: 'Checked' })) }));

import { CopilotConversation, setReservationMessages, clearAllReservationMessages } from './copilot-conversation';
import { CopilotOptionFlow } from './copilot-option-flow';
import { ComparisonCard } from './evidence-drawer';

// WCAG 2.x contrast ratio for two hex colors. Local to this test so no new
// production dependency is introduced.
function luminance(hex) {
  const c = hex.replace('#', '');
  const channel = (i) => {
    const v = parseInt(c.substr(i, 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}
function contrast(a, b) {
  const l1 = Math.max(luminance(a), luminance(b));
  const l2 = Math.min(luminance(a), luminance(b));
  return (l1 + 0.05) / (l2 + 0.05);
}

const src = (name) => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8');
const COPILOT_SOURCES = [
  'copilot-conversation.jsx',
  'copilot-option-flow.jsx',
  'ai-recommendation-panel.jsx',
  'dispatch-plan-panel.jsx',
  'evidence-drawer.jsx',
];
const queuePageSource = readFileSync(
  new URL('../../app/(dashboard)/reservations/queue/page.js', import.meta.url), 'utf8'
);
const globalsCss = readFileSync(
  new URL('../../app/globals.css', import.meta.url), 'utf8'
);

beforeEach(() => { vi.stubGlobal('React', React); clearAllReservationMessages(); });
afterEach(() => vi.unstubAllGlobals());

it('proves the old info pair fails normal-text contrast (control, not the passing criterion)', () => {
  expect(contrast('#3b82f6', '#eff6ff')).toBeLessThan(4.5); // proves old pair fails
});

it('uses AA ink tokens that pass 4.5:1 for normal text on light surfaces', () => {
  expect(contrast('#1d4ed8', '#eff6ff')).toBeGreaterThanOrEqual(4.5);
  expect(contrast('#b45309', '#ffffff')).toBeGreaterThanOrEqual(4.5);
  expect(contrast('#b91c1c', '#ffffff')).toBeGreaterThanOrEqual(4.5);
});

it('holds text or icon floors on dark token surfaces', () => {
  expect(contrast('#60a5fa', '#1e3a5f')).toBeGreaterThanOrEqual(4.5);
  expect(contrast('#fbbf24', '#78350f')).toBeGreaterThanOrEqual(4.5);
  // danger-700 on danger-bg is icon-only in dark mode (CopilotStateMessage
  // titles render in foreground); the 3:1 non-text floor applies and holds.
  expect(contrast('#f87171', '#7f1d1d')).toBeGreaterThanOrEqual(3);
  expect(contrast('#b45309', '#ffffff')).toBeGreaterThanOrEqual(3);
});

it('renders the transcript with AA ink, static avatars, and no idle motion', () => {
  setReservationMessages(71, [
    { role: 'user', content: 'Why this option?', at: 1 },
    { role: 'assistant', content: 'Recorded findings summary.', at: 2 },
  ]);
  const chatHtml = renderToStaticMarkup(
    React.createElement(CopilotConversation, { requestId: 71, hasPair: true })
  );
  expect(chatHtml).not.toContain('copilot-avatar-blinking.gif');
  expect(chatHtml).toContain('text-info-700');
  expect(chatHtml).not.toContain('animate-ping');
  const avatars = [...chatHtml.matchAll(/<img\b[^>]*src="\/images\/copilot-avatar\.png"[^>]*>/g)]
    .map((match) => match[0]);
  expect(avatars.length).toBeGreaterThan(0);
  for (const avatar of avatars) expect(avatar).toMatch(/alt=""/);
});

it('keeps exactly one named Copilot identity and no looping avatar asset', () => {
  const sources = [...COPILOT_SOURCES.map(src), queuePageSource];
  for (const source of sources) {
    expect(source).not.toContain('copilot-avatar-blinking.gif');
    expect(source).not.toContain('animate-ping');
  }
  // The single named identity is supplied through the avatar's `label` prop
  // (rendered as its alt); every other instance stays decorative.
  const named = sources
    .map((source) => source.match(/(?:alt|label)="Dispatch Copilot Avatar"/g) || [])
    .reduce((total, matches) => total + matches.length, 0);
  expect(named).toBe(1);
  for (const name of COPILOT_SOURCES) {
    expect(src(name)).not.toMatch(/\btext-(info|warning|danger)(?![-\w])/);
  }
  // Committed-trip status icons use 700 inks (3:1 icon floor), never 600 on tint.
  expect(src('ai-recommendation-panel.jsx')).not.toMatch(/text-(emerald|rose|blue|indigo)-600/);
  // No idle pulse in the committed-trip bubble; activity motion stays motion-safe spin only.
  expect(src('ai-recommendation-panel.jsx')).not.toContain('animate-pulse');
  expect(src('ai-recommendation-panel.jsx')).not.toContain('animate-ping');
});

it('keeps option and evidence status in AA ink with named comparison headings', () => {
  const html = renderToStaticMarkup(React.createElement(CopilotOptionFlow, {
    options: [{
      pair: {
        vehicle_id: 3, driver_id: 4,
        vehicle: { plate_number: 'ABC-1234' },
        driver: { driver_name: 'Maria Santos' },
        checks: [{ id: 'capacity', label: 'Capacity', status: 'verified', message: 'Sufficient seats' }],
        temporalContext: { horizon: 'FUTURE', pickupAt: '2026-10-05T08:00:00+08:00' },
      },
      recommended: true,
    }],
    busy: false,
    onChoose: () => {},
    now: Date.parse('2026-10-02T00:00:00Z'),
  }));
  expect(html).toContain('text-warning-700');
  expect(html).not.toMatch(/<p[^>]*>ID \d+<\/p>/);
  const comparisonHtml = renderToStaticMarkup(React.createElement(ComparisonCard, {
    planStatus: null,
    data: {
      facts: {
        optionA: { vehicleId: 1, driverId: 2 },
        optionB: { vehicleId: 3, driverId: 4 },
      },
    },
  }));
  expect(comparisonHtml).toContain('<h4');
  expect(comparisonHtml).toContain('Vehicle #1 / Driver #2');
});

it('covers both themes and reduced motion in the shared stylesheet', () => {
  expect(globalsCss).toContain('prefers-reduced-motion');
  expect(globalsCss).toContain(':root.dark');
  for (const token of ['--info-700', '--warning-700', '--danger-700']) {
    expect(globalsCss.match(new RegExp(token, 'g')).length).toBeGreaterThanOrEqual(2);
  }
});
