import React from 'react';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transform } from 'esbuild';
import { vi } from 'vitest';
import { describe, expect, it } from 'vitest';
import { readCargoScreenSources } from './cargo-view-model';

describe('Cargo exact trip read failures', () => {
  it('propagates a failed owned-trip lookup instead of showing an assignment mismatch', async () => {
    const failure = new Error('Trip could not be refreshed');
    await expect(readCargoScreenSources('701', { driverType: 'Cargo', readExecution: async () => ({}), readTrips: async () => { throw failure; } })).rejects.toBe(failure);
  });
});
it.each([['vehicle', '/(app)/(tabs)/map'], ['fuel_action', '/fuel-report']])('resolves legacy %s directly to the existing destination', async (name, destination) => {
  const code = (await transform(readFileSync(new URL(`../app/(app)/(tabs)/${name}.js`, import.meta.url), 'utf8'), { loader: 'jsx', format: 'cjs' })).code;
  const scope = { exports: {} };
  runInNewContext(code, { React: { createElement: (component, props) => ({ component, props }) }, module: scope, exports: scope.exports, require: () => ({ Redirect: 'Redirect' }) });
  expect(scope.exports.default()).toMatchObject({ component: 'Redirect', props: { href: destination } });
});

it.each([false, true])('previews local issue evidence and protects locked drafts (locked=%s)', async busy => {
  const nodes = [], change = vi.fn();
  const react = { ...React, createElement: (component, props, ...children) => { const node = { component, props: props || {}, children }; nodes.push(node); return node; } };
  const deps = { react, 'react-native': { View: 'View', Text: 'Text', Image: 'Image' }, '../coachmarks': { CoachMarkTarget: 'Target' }, '../clay': { ClayInput: 'Input' }, './CargoButton': { CargoButton: 'Button' }, '../../lib/theme-context': { useTheme: () => ({ colors: {}, type: {} }) } };
  const code = (await transform(readFileSync(new URL('../components/cargo/CargoIssueSheet.jsx', import.meta.url), 'utf8'), { loader: 'jsx', format: 'cjs' })).code;
  const scope = { exports: {} }; runInNewContext(code, { React: react, module: scope, exports: scope.exports, require: name => deps[name] });
  scope.exports.CargoIssueSheet({ line: { name: 'Rice' }, issue: { evidence: [{ uri: 'file:///a.jpg' }, { uri: 'file:///b.jpg' }] }, busy, onChange: change });
  expect(nodes.filter(n => n.component === 'Image')).toHaveLength(2);
  const remove = nodes.find(n => n.props.label === 'Remove photo 1'); expect(remove.props.disabled).toBe(busy); remove.props.onPress();
  if (busy) expect(change).not.toHaveBeenCalled(); else expect(change.mock.calls[0][0].evidence).toEqual([{ uri: 'file:///b.jpg' }]);
});
