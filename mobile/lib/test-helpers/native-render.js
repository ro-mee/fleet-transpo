import React from 'react';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transform } from 'esbuild';

// Execute real component callbacks while replacing only native/module boundaries.
export async function nativeRender(url, { deps = {}, props = {}, name = 'default', globals = {} } = {}) {
  const cells = [], effects = [], cleanups = new Map(); let cursor = 0, root, currentProps = props;
  const changed = (a, b) => !a || !b || a.length !== b.length || a.some((x, i) => !Object.is(x, b[i]));
  const react = { ...React,
    useState(initial) { const i = cursor++; if (!(i in cells)) cells[i] = typeof initial === 'function' ? initial() : initial; return [cells[i], value => { cells[i] = typeof value === 'function' ? value(cells[i]) : value; }]; },
    useRef(initial) { const i = cursor++; return cells[i] ||= { current: initial }; },
    useMemo(fn, dependencies) { const i = cursor++; if (!cells[i] || changed(cells[i].deps, dependencies)) cells[i] = { deps: dependencies, value: fn() }; return cells[i].value; },
    useCallback(fn, dependencies) { return react.useMemo(() => fn, dependencies); },
    useEffect(fn, dependencies) { const i = cursor++; if (!cells[i] || changed(cells[i].deps, dependencies)) { cells[i] = { deps: dependencies }; effects.push({ i, fn }); } },
    useLayoutEffect(fn, dependencies) { return react.useEffect(fn, dependencies); },
    useContext(context) { return context.value; },
    createElement(component, attributes, ...children) { return { component, props: { ...attributes, children }, children }; },
  };
  const source = (await transform(readFileSync(url, 'utf8'), { loader: 'jsx', format: 'cjs' })).code;
  const scope = { exports: {} };
  runInNewContext(source, { module: scope, exports: scope.exports, React: react, Date, setTimeout, clearTimeout, setInterval, clearInterval, ...globals,
    require: key => { if (key === 'react') return react; if (!(key in deps)) throw new Error(`Unexpected component dependency: ${key}`); return deps[key]; },
  });
  const render = (patch = {}) => { currentProps = { ...currentProps, ...patch }; cursor = 0; root = scope.exports[name](currentProps); return root; };
  const nodes = () => { const out = []; const walk = node => { if (Array.isArray(node)) return node.forEach(walk); if (node?.component) { out.push(node); node.children.forEach(walk); } }; walk(root); return out; };
  render();
  return { exports: scope.exports, render, nodes, get result() { return root; }, text: () => JSON.stringify(root), find: predicate => nodes().find(predicate), async flushEffects() { for (const { i, fn } of effects.splice(0)) { cleanups.get(i)?.(); cleanups.set(i, fn()); } await Promise.resolve(); }, unmount() { for (const fn of cleanups.values()) fn?.(); } };
}

export const nativeViews = { ...Object.fromEntries(['View', 'Text', 'Modal', 'ScrollView', 'Pressable', 'KeyboardAvoidingView', 'TextInput'].map(n => [n, n])), StyleSheet: { create: x => x, absoluteFill: {} }, Platform: { OS: 'android' } };
export const nativeTheme = { useTheme: () => ({ colors: { background: '#F5F2EC', surface: '#fff', onSurface: '#17382F', onSurfaceVariant: '#33443B', primary: '#285448', primaryContainer: '#DCE9E3', onPrimaryContainer: '#17382F', outlineVariant: '#C8D3CB' }, type: { bodyMd: {}, headlineMd: {}, supporting: {}, labelLg: {} } }) };
