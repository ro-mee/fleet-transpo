import React from 'react';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transform } from 'esbuild';
import { describe, expect, it, vi } from 'vitest';
import * as checklist from './inspection-checklist';

const inspectionCode = (await transform(readFileSync(new URL('../app/(app)/inspection.js', import.meta.url), 'utf8'), { loader: 'jsx', format: 'cjs' })).code;

async function renderInspection({ cargo = true, mode = 'pretrip', missingContext = false, answers = { brakes_tires: null, cargo_secure: null, cabin_ready: null }, remarks = {} } = {}) {
  const state = new Map();
  const seed = [missingContext ? null : { trip_id: 7, load_type: cargo ? 'Cargo' : 'Passenger', plate_number: 'ABC 123', model: 'Toyota Hilux' }, answers, remarks, false, 'submission-7', false, null, 0];
  let owner = 'screen';
  let cursor = 0;
  let elements = [];
  const api = { post: vi.fn().mockResolvedValue({}), get: vi.fn() };
  const alert = vi.fn();
  const notifyInteraction = vi.fn();
  const hookReact = {
    ...React,
    useEffect: () => {}, useMemo: fn => fn(), useRef: current => ({ current }),
    useState: initial => {
      const key = `${owner}:${cursor++}`;
      if (!state.has(key)) state.set(key, owner === 'screen' && cursor <= seed.length ? seed[cursor - 1] : typeof initial === 'function' ? initial() : initial);
      return [state.get(key), value => state.set(key, typeof value === 'function' ? value(state.get(key)) : value)];
    },
    createElement: (component, props, ...children) => {
      const node = { component, props: props || {}, children };
      if (typeof component === 'function') {
        const previous = [owner, cursor];
        owner = `${component.name}:${props.subject}:${props.key || ''}`; cursor = 0;
        node.children = [component({ ...props, children })];
        [owner, cursor] = previous;
      }
      return node;
    },
  };
  const native = { View: 'View', Text: 'Text', Image: 'Image', Pressable: 'Pressable', ScrollView: 'ScrollView', TextInput: 'Input', ActivityIndicator: 'Spinner', KeyboardAvoidingView: 'KeyboardAvoidingView', Platform: { OS: 'android' }, Vibration: { vibrate: vi.fn() }, StyleSheet: { create: value => value } };
  const deps = {
    react: hookReact, 'react-native': native,
    '../../lib/scaling': { moderateScale: value => value }, '../lib/scaling': { moderateScale: value => value },
    'expo-router': { useLocalSearchParams: () => ({ tripId: '7', mode }), useRouter: () => ({ back: vi.fn() }) },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 16 }) }, '@expo/vector-icons': { Ionicons: 'Icon' },
    '../../lib/theme-context': { useTheme: () => ({ colors: { outlineVariant: '#aaa' }, type: {} }) },
    '../../lib/theme': { fonts: {}, TOUCH_TARGET: 48 }, '../../lib/api': { api }, '../../components/AppAlert': { AppAlert: { alert } },
    '../../components/clay': { ClayCard: 'Card', ClayButton: 'Button', ClayTile: 'Tile' }, '../../lib/clay': { raisedControl: () => ({}) },
    '../../components/coachmarks': { useCoachMarkActions: () => ({ notifyInteraction, triggerMilestone: vi.fn() }), useCoachMarkStatus: () => ({}), CoachMarkTarget: 'Target' },
    '../../lib/inspection-tour': {}, '../../lib/inspection-checklist': checklist,
    '../assets/images/cargo-guides/tire-example.webp': 101,
    '../assets/images/cargo-guides/load-example.webp': 102,
    '../assets/images/cargo-guides/package-example.webp': 103,
  };
  deps['../lib/theme-context'] = deps['../../lib/theme-context'];
  deps['../lib/theme'] = deps['../../lib/theme'];
  deps['./clay'] = deps['../../components/clay'];
  deps['../lib/clay'] = deps['../../lib/clay'];
  function evaluate(code) {
    const scope = { exports: {} };
    runInNewContext(code, { React: hookReact, module: scope, exports: scope.exports, require: name => { if (!deps[name]) throw Error(`Missing dependency: ${name}`); return deps[name]; } });
    return scope.exports;
  }
  // Load actual guidance only if the screen uses it, so RED observes the absent UI.
  if (inspectionCode.includes('ReferencePhotoGuide')) {
    const guideCode = (await transform(readFileSync(new URL('../components/ReferencePhotoGuide.jsx', import.meta.url), 'utf8'), { loader: 'jsx', format: 'cjs' })).code;
    deps['../../components/ReferencePhotoGuide'] = evaluate(guideCode);
    const imageCode = (await transform(readFileSync(new URL('./inspection-reference-images.js', import.meta.url), 'utf8'), { loader: 'js', format: 'cjs' })).code;
    deps['../../lib/inspection-reference-images'] = evaluate(imageCode);
  }
  const screen = evaluate(inspectionCode).default;
  const rerender = () => {
    elements = []; owner = 'screen'; cursor = 0;
    const collect = value => {
      if (Array.isArray(value)) { value.forEach(collect); return; }
      if (!value || typeof value !== 'object' || !value.component) return;
      elements.push(value);
      value.children.forEach(collect);
    };
    collect(screen());
  };
  rerender();
  return { get elements() { return elements; }, get text() { return elements.filter(node => node.component === 'Text').flatMap(node => node.children).filter(value => typeof value === 'string').join(' '); }, get progress() { return elements.find(node => node.component === 'Text' && node.children.includes(' of '))?.children.join(''); }, rerender, api, alert, notifyInteraction, get answers() { return state.get('screen:1'); } };
}

describe('Cargo Pre-Trip photo guidance in the actual inspection screen', () => {
  it('expands each safety example without answering, advancing progress or submitting', async () => {
    const h = await renderInspection();
    const guides = h.elements.filter(node => typeof node.component === 'function' && node.props.subject);
    expect(guides.map(node => node.props.subject)).toEqual(['Brakes & Tires', 'Cargo Secured']);
    expect(h.progress).toBe('0 of 3 Complete');
    expect(h.elements.filter(node => node.component === 'Image')).toHaveLength(0);
    expect(h.text).not.toContain('AI-generated illustration');
    for (const guide of guides) {
      const toggle = h.elements.find(node => node.component === 'Pressable' && node.props.accessibilityLabel?.includes(guide.props.subject) && node.props.accessibilityState?.expanded === false);
      expect(toggle).toBeDefined();
      toggle.props.onPress(); h.rerender();
      expect(h.elements.some(node => node.props.accessibilityLabel?.includes(guide.props.subject) && node.props.accessibilityState?.expanded === true)).toBe(true);
    }
    expect(h.answers).toEqual({ brakes_tires: null, cargo_secure: null, cabin_ready: null });
    expect(h.elements.filter(node => node.component === 'Image')).toHaveLength(2);
    expect(h.text).toContain('AI-generated illustration');
    expect(h.progress).toBe('0 of 3 Complete');
    expect(h.notifyInteraction).not.toHaveBeenCalled();
    expect(h.api.post).not.toHaveBeenCalled();
  });

  it.each([{ cargo: false }, { mode: 'preshift' }, { missingContext: true }])('keeps guidance out of non-Cargo-Pre-Trip context %o', async options => {
    const h = await renderInspection(options);
    expect(h.elements.filter(node => typeof node.component === 'function' && node.props.subject)).toHaveLength(0);
  });

  it('preserves unsecured-cargo blocking, remarks and cabin acknowledgement while viewing guidance', async () => {
    const h = await renderInspection({ answers: { brakes_tires: 'PASS', cargo_secure: 'FAIL', cabin_ready: 'PASS' }, remarks: { cargo_secure: 'Loose strap' } });
    const toggle = h.elements.find(node => node.props.accessibilityLabel?.includes('Cargo Secured') && node.props.accessibilityState?.expanded === false);
    expect(toggle).toBeDefined();
    toggle.props.onPress(); h.rerender();
    expect(h.text).toMatch(/departure.*blocked/i);
    expect(h.elements.find(node => node.component === 'Input').props.value).toBe('Loose strap');
    expect(h.elements.find(node => node.props.accessibilityRole === 'checkbox').props.accessibilityState.checked).toBe(true);
    expect(h.answers).toEqual({ brakes_tires: 'PASS', cargo_secure: 'FAIL', cabin_ready: 'PASS' });
    expect(h.elements.find(node => node.component === 'Button').props.label).toBe('SAVE BLOCKING ISSUE');
  });

  it('still changes only the selected answer through the real answer button and requires failure remarks', async () => {
    const h = await renderInspection({ answers: { brakes_tires: 'PASS', cabin_ready: 'PASS' } });
    const toggle = h.elements.find(node => node.props.accessibilityLabel?.includes('Cargo Secured') && node.props.accessibilityState?.expanded === false);
    expect(toggle).toBeDefined();
    toggle.props.onPress(); h.rerender();
    const fail = h.elements.find(node => node.component === 'Pressable' && node.children.some(child => child.component === 'Text' && child.children.includes('NOT SECURE')));
    fail.props.onPress(); h.rerender();
    expect(h.answers).toEqual({ brakes_tires: 'PASS', cargo_secure: 'FAIL', cabin_ready: 'PASS' });
    expect(h.progress).toBe('3 of 3 Complete');
    expect(h.notifyInteraction).toHaveBeenCalledWith('inspection.pass_fail', { itemId: 'cargo_secure', status: 'FAIL' });
    await h.elements.find(node => node.component === 'Button').props.onPress();
    expect(h.alert).toHaveBeenCalledWith('Remarks Required', expect.any(String));
    expect(h.api.post).not.toHaveBeenCalled();
  });
});
