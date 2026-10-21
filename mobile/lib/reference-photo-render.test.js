import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { transform } from 'esbuild';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

async function harness(path, props) {
  const values = [];
  let cursor = 0;
  const nodes = [];
  const hooks = { ...React, useState: initial => {
    const index = cursor++;
    if (!(index in values)) values[index] = initial;
    return [values[index], next => { values[index] = typeof next === 'function' ? next(values[index]) : next; }];
  }, createElement: (component, attributes, ...children) => {
    const node = { component, props: attributes || {}, children }; nodes.push(node); return node;
  } };
  async function load(file) {
    const { code } = await transform(readFileSync(file, 'utf8'), { loader: 'jsx', format: 'cjs' });
    const deps = { react: hooks, 'react-native': { View: 'View', Text: 'Text', Pressable: 'Pressable', Image: 'Image', ActivityIndicator: 'Spinner', StyleSheet: { create: x => x } } };
    for (const match of code.matchAll(/require\("([^" ]+)"\)/g)) {
      const name = match[1];
      if (deps[name]) continue;
      if (name.endsWith('/coachmarks')) deps[name] = { CoachMarkTarget: 'Target' };
      else if (name.endsWith('.webp')) deps[name] = name;
      else if (name.endsWith('theme-context')) deps[name] = { useTheme: () => ({ colors: { onSurfaceVariant: '#53615A', surfaceContainerLow: '#FBF8F3', primary: '#285448' }, type: {} }) };
      else if (name.endsWith('/clay')) deps[name] = { ClayButton: 'Button', ClayInput: 'Input' };
      else deps[name] = await load(resolve(dirname(file), name + (name.endsWith('.jsx') || name.endsWith('.js') ? '' : name.includes('/lib/') ? '.js' : '.jsx')));
    }
    const scope = { exports: {} };
    runInNewContext(code, { React: hooks, module: scope, exports: scope.exports, require: name => deps[name] });
    return scope.exports;
  }
  const exports = await load(path);
  let component = exports.ReferencePhotoGuide || exports.CargoItemReceiptRow;
  const render = next => { if (next) props = next; cursor = 0; nodes.length = 0; component(props); return nodes; };
  render();
  return { nodes, render, mount: node => { component = node.component; props = node.props; values.length = 0; render(); }, text: () => nodes.filter(n => n.component === 'Text').flatMap(n => n.children).filter(x => typeof x === 'string').join(' ') };
}

const row = new URL('../components/cargo/CargoItemReceiptRow.jsx', import.meta.url);
const guide = new URL('../components/ReferencePhotoGuide.jsx', import.meta.url);
const line = { line_id: 'tomatoes', name: 'Tomatoes', expected_quantity: '10', unit: 'boxes', quantity_basis: 'TRANSPORT_PACKAGE', handling: [] };

describe('Cargo item reference presentation', () => {
  it('separates the photo guide from a blank actual pickup count', async () => {
    const onChange = vi.fn();
    const h = await harness(row.pathname.replace(/^\/(\w:)/, '$1'), { line, value: '', imageUrl: 'https://example.invalid/signed-reference', onChange });
    expect(h.text()).toContain('Count the packages physically present');
    const reference = h.nodes.find(n => typeof n.component === 'function' && n.component.name === 'ReferencePhotoGuide');
    expect(reference.props.subject).toBe('Tomatoes');
    expect(reference.props.source.uri).toBe('https://example.invalid/signed-reference');
    expect(h.nodes.find(n => n.component === 'Input').props.value).toBe('');
    expect(onChange).not.toHaveBeenCalled();
  });
  it('keeps source expectation and pickup separate at delivery, including zero', async () => {
    const h = await harness(row.pathname.replace(/^\/(\w:)/, '$1'), { line, value: '', stage: 'DELIVERY', pickupQuantity: '0', editable: false });
    expect(h.text()).toContain('Expected from source');
    expect(h.text()).toContain('Picked up:');
    expect(h.nodes.find(n => n.component === 'Input').props.editable).toBe(false);
    expect(h.nodes.find(n => n.component === 'Input').props.value).toBe('');
  });
  it('uses a clearly labeled tomato illustration only for a recognized item name', async () => {
    const h = await harness(row.pathname.replace(/^\/(\w:)/, '$1'), { line, value: '' });
    const reference = h.nodes.find(n => typeof n.component === 'function' && n.component.name === 'ReferencePhotoGuide');
    expect(reference.props.source).toContain('tomato-example.webp');
    expect(reference.props.caption).toContain('AI-generated item illustration');
    expect(h.nodes.find(n => n.component === 'Input').props.value).toBe('');
  });
  it('does not guess food contents for an unknown shipment label', async () => {
    const h = await harness(row.pathname.replace(/^\/(\w:)/, '$1'), { line: { ...line, name: 'Mixed supplies' }, value: '' });
    const reference = h.nodes.find(n => typeof n.component === 'function' && n.component.name === 'ReferencePhotoGuide');
    expect(reference.props.source).toContain('package-example.webp');
    expect(reference.props.caption).toContain('packaging illustration');
  });
  it('asks for a measured amount rather than a package count for non-package units', async () => {
    const h = await harness(row.pathname.replace(/^\/(\w:)/, '$1'), { line: { ...line, quantity_basis: 'STOCK_UNIT', unit: 'kg' }, value: '' });
    expect(h.text()).toContain('Measure the amount physically present in kg');
    expect(h.nodes.find(n => n.component === 'Input').props.keyboardType).toBe('decimal-pad');
  });
});

describe('Shared reference photo disclosure', () => {
  it('opens and closes guidance without recording an observation', async () => {
    const h = await harness(guide.pathname.replace(/^\/(\w:)/, '$1'), { source: { uri: 'https://example.invalid/signed-reference' }, subject: 'Tomatoes', children: 'Inspect the actual packages.' });
    expect(h.nodes.find(n => n.component === 'Pressable').props.accessibilityLabel).toBe('View example: Tomatoes');
    expect(h.text()).not.toContain('Reference only');
    h.nodes.find(n => n.component === 'Pressable').props.onPress(); h.render();
    expect(h.nodes.find(n => n.component === 'Pressable').props.accessibilityLabel).toBe('Hide example: Tomatoes');
    expect(h.text()).toContain('Reference only');
    h.nodes.find(n => n.component === 'Pressable').props.onPress(); h.render();
    expect(h.text()).not.toContain('Reference only');
  });
  it('keeps text-only guidance usable when there is no approved photo', async () => {
    const h = await harness(guide.pathname.replace(/^\/(\w:)/, '$1'), { subject: 'Cargo Secure', children: 'Inspect your actual load using Fleet guidance.' });
    expect(h.text()).toContain('Reference image unavailable');
    expect(h.nodes.find(n => n.component === 'Pressable').props.accessibilityLabel).toBe('View guide: Cargo Secure');
    h.nodes.find(n => n.component === 'Pressable').props.onPress(); h.render();
    expect(h.text()).toContain('Reference only');
    expect(h.nodes.some(n => n.component === 'Image')).toBe(false);
  });
  it.each(['onLoad', 'onError'])('handles native %s without leaving an indefinite loading state', async event => {
    const h = await harness(guide.pathname.replace(/^\/(\w:)/, '$1'), { source: { uri: 'https://example.invalid/reference' }, subject: 'Tomatoes' });
    h.nodes.find(n => n.component === 'Pressable').props.onPress(); h.render();
    h.mount(h.nodes.find(n => typeof n.component === 'function' && n.component.name === 'ReferencePhoto'));
    expect(h.nodes.some(n => n.component === 'Spinner')).toBe(true);
    h.nodes.find(n => n.component === 'Image').props[event](); h.render();
    expect(h.nodes.some(n => n.component === 'Spinner')).toBe(false);
    if (event === 'onError') {
      expect(h.text()).toContain('Continue using the written instructions');
      expect(h.nodes.some(n => n.component === 'Image')).toBe(false);
    }
  });
  it('remounts photo state when a different source reference replaces an old one', async () => {
    const h = await harness(guide.pathname.replace(/^\/(\w:)/, '$1'), { source: { uri: 'https://example.invalid/old' }, subject: 'Tomatoes' });
    h.nodes.find(n => n.component === 'Pressable').props.onPress(); h.render();
    const previous = h.nodes.find(n => typeof n.component === 'function' && n.component.name === 'ReferencePhoto');
    h.render({ source: { uri: 'https://example.invalid/new' }, subject: 'Tomatoes' });
    const current = h.nodes.find(n => typeof n.component === 'function' && n.component.name === 'ReferencePhoto');
    expect(current.props.key).not.toBe(previous.props.key);
    expect(current.props.source.uri).toBe('https://example.invalid/new');
  });
});
