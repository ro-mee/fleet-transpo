import React from 'react';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { transform } from 'esbuild';
import { describe, expect, it, vi } from 'vitest';
import * as presentation from './presentation';
import { mobileNotificationTarget } from './navigation';
import { classifyNotification } from './tiers';
import { nativeRender } from '../test-helpers/native-render';

const native = { View: 'View', Text: 'Text', Pressable: 'Pressable', ScrollView: 'ScrollView', RefreshControl: 'Refresh', StyleSheet: { create: x => x } };
const theme = { useTheme: () => ({ colors: new Proxy({}, { get: () => '#285448' }), type: {}, scheme: 'light' }) };
async function moduleAt(path, dependencies, react) {
  const { code } = await transform(readFileSync(path, 'utf8'), { loader: 'jsx', format: 'cjs' });
  const scope = { exports: {} };
  runInNewContext(code, { module: scope, exports: scope.exports, React: react, require: name => {
    if (name === 'react') return react;
    if (!dependencies[name]) throw Error(`Unexpected dependency: ${name}`);
    return dependencies[name];
  } });
  return scope.exports;
}
function reactBoundary() {
  return { ...React, useState: initial => [typeof initial === 'function' ? initial() : initial, vi.fn()], createElement: (component, props, ...children) => ({ component, props: props || {}, children }) };
}
function expand(tree) {
  if (Array.isArray(tree)) return tree.map(expand);
  if (!tree || typeof tree !== 'object') return tree;
  if (typeof tree.component === 'function') return expand(tree.component({ ...tree.props, children: tree.children }));
  return { ...tree, children: tree.children.flat(Infinity).map(expand) };
}
function nodes(tree) { return !tree || typeof tree !== 'object' ? [] : [tree, ...tree.children.flat(Infinity).flatMap(nodes)]; }
function text(tree) { return typeof tree === 'string' ? tree : (tree?.children || []).flat(Infinity).map(text).join(' '); }
const message = { notification_id: 12, title: 'Your fleet team has acknowledged your incident report', message: 'Stay in a safe location. Open the incident to check the latest response from your fleet team.', reference_type: 'incident', reference_id: 8, severity: 'Major', type: 'Alert', is_read: false, created_at: '2026-10-17T00:10:00Z' };

async function renderInbox(overrides = {}) {
  const feed = { notifications: [message], unreadCount: 1, loading: false, refreshing: false, error: null, refresh: vi.fn(), markRead: vi.fn(), markAllRead: vi.fn(), dismiss: vi.fn(), ...overrides };
  const router = { push: vi.fn(), back: vi.fn(), canGoBack: () => true };
  const prefix = '../../../';
  const deps = {
    'react-native': native, '@expo/vector-icons': { Ionicons: 'Icon' },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 24, bottom: 16 }) },
    'expo-router': { useRouter: () => router }, [prefix+'lib/theme-context']: theme,
    [prefix+'lib/scaling']: { moderateScale: n => n },
    [prefix+'lib/theme']: { statusColorForTone: () => ({ bg: '#fff', fg: '#222' }) },
    [prefix+'lib/notifications/navigation']: { mobileNotificationTarget },
    [prefix+'lib/notifications/presentation']: presentation,
    [prefix+'context/notification-feed']: { useNotificationFeed: () => feed },
    [prefix+'components/ui']: { SkeletonCard: 'Skeleton' },
    [prefix+'components/ClayScreenHeader']: { default: 'Header', __esModule: true },
    [prefix+'components/clay']: { ClayCard: 'Card', ClayTile: 'Tile', ClayBadge: 'Badge', ClayButton: 'Button' },
  };
  const { default: Component } = await moduleAt('mobile/app/(app)/(tabs)/notifications.js', deps, reactBoundary());
  return { tree: expand(Component()), feed, router };
}

describe('mobile inbox presentation and interactions', () => {
  it('shows a fetch failure with Retry instead of claiming an empty inbox', async () => {
    const { tree } = await renderInbox({ notifications: [], unreadCount: 0, error: 'Could not refresh notifications.' });
    expect(text(tree)).toContain('Could not refresh notifications.');
    expect(text(tree)).not.toMatch(/All Caught Up|All caught up/);
    expect(nodes(tree).some(n => n.component === 'Button' && n.props.label === 'Try again')).toBe(true);
  });
  it('keeps the full message and title readable instead of truncating them', async () => {
    const { tree } = await renderInbox();
    for (const value of [message.title, message.message]) {
      const node = nodes(tree).find(n => n.component === 'Text' && text(n) === value);
      expect(node).toBeDefined();
      expect(node.props.numberOfLines).toBeUndefined();
    }
    expect(text(tree)).toContain('Unread');
    expect(nodes(tree).some(n => n.component === 'Badge' && n.props.label === 'Major' && n.props.tone === 'danger')).toBe(true);
  });
  it('keeps dismissal outside the message navigation target', async () => {
    const { tree, feed, router } = await renderInbox();
    let dismissNode;
    const visit = (node, interactive = []) => {
      if (!node || typeof node !== 'object') return;
      if (node.props.accessibilityLabel?.startsWith('Dismiss notification:')) {
        expect(interactive).toHaveLength(0);
        dismissNode = node;
      }
      const ancestors = node.props.onPress ? [...interactive, node] : interactive;
      node.children.flat(Infinity).forEach(child => visit(child, ancestors));
    };
    visit(tree);
    dismissNode.props.onPress();
    expect(feed.dismiss).toHaveBeenCalledWith(12);
    expect(feed.markRead).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
  });
  it('still marks an unread incident read and opens its existing destination', async () => {
    const { tree, feed, router } = await renderInbox();
    const target = nodes(tree).find(n => n.props.accessibilityLabel?.includes(message.title) && !n.props.accessibilityLabel.startsWith('Dismiss'));
    await target.props.onPress();
    expect(feed.markRead).toHaveBeenCalledWith(12);
    expect(router.push).toHaveBeenCalledWith('/incident/8');
  });
  it('retains loaded messages while showing a refresh failure', async () => {
    const { tree } = await renderInbox({ error: 'Refresh unavailable.' });
    expect(text(tree)).toContain(message.title);
    expect(text(tree)).toContain('Refresh unavailable.');
  });
});

async function renderProvider() {
  const api = { get: vi.fn(), put: vi.fn().mockResolvedValue({}), del: vi.fn().mockResolvedValue({}) };
  const notify = { push: vi.fn(), headsUp: vi.fn() };
  const router = { push: vi.fn() };
  const harness = await nativeRender(new URL('../../context/notification-feed.jsx', import.meta.url), {
    name: 'NotificationFeedProvider',
    deps: {
      'react-native': { AppState: {} }, 'expo-router': { useRouter: () => router },
      '../lib/api': { api }, '../lib/settings-context': { useSettings: () => ({ settings: {} }) },
      '../lib/notifications/notify': { notify },
      '../lib/notifications/tiers': { classifyNotification }, '../lib/notifications/navigation': { mobileNotificationTarget },
    },
  });
  return { api, notify, render: () => harness.render().props.value };
}

describe('notification provider publications', () => {
  it('retains its array and context for six identical silent polls', async () => {
    const { api, notify, render } = await renderProvider();
    api.get.mockImplementation(async () => JSON.parse(JSON.stringify([message])));
    await render().refresh(true);
    const initial = render();
    let changedArrays = 0, changedContexts = 0;
    for (let poll = 0; poll < 6; poll += 1) {
      await render().refresh(true);
      const current = render();
      if (current.notifications !== initial.notifications) changedArrays += 1;
      if (current !== initial) changedContexts += 1;
    }
    expect({ changedArrays, changedContexts }).toEqual({ changedArrays: 0, changedContexts: 0 });
    expect(notify.push).not.toHaveBeenCalled();
    expect(notify.headsUp).not.toHaveBeenCalled();
  });

  it('retains the published context when only the parent rerenders', async () => {
    const { render } = await renderProvider();
    const initial = render();
    expect(render()).toBe(initial);
  });

  const second = { ...message, notification_id: 34, title: 'Next assignment' };
  it.each([
    ['message content', rows => [{ ...rows[0], message: 'Dispatch has updated this incident.' }, rows[1]]],
    ['read state', rows => [{ ...rows[0], is_read: true }, rows[1]]],
    ['row order', rows => [rows[1], rows[0]]],
    ['added row', rows => [...rows, { ...message, notification_id: 56 }]],
    ['removed row', rows => rows.slice(1)],
    ['additional metadata', rows => [{ ...rows[0], delivery_metadata: { revision: 2 } }, rows[1]]],
  ])('publishes changed %s rather than retaining stale information', async (_, change) => {
    const { api, render } = await renderProvider();
    const original = [message, second];
    api.get.mockResolvedValueOnce(original);
    await render().refresh(true);
    const previous = render();
    const changed = change(original);
    api.get.mockResolvedValueOnce(changed);
    await previous.refresh(true);
    const current = render();
    expect(current.notifications).toEqual(changed);
    expect(current.notifications).not.toBe(previous.notifications);
    expect(current).not.toBe(previous);
    expect(current.unreadCount).toBe(changed.filter(row => !row.is_read).length);
  });

  it('exposes retrieval failure, retains loaded messages, and publishes recovery with identical data', async () => {
    const { api, render } = await renderProvider();
    api.get.mockResolvedValueOnce([message]);
    await render().refresh(true);
    const loaded = render();
    api.get.mockRejectedValueOnce(new Error('Offline'));
    await loaded.refresh(true);
    const failed = render();
    expect(failed.error).toBeTruthy();
    expect(failed.notifications).toBe(loaded.notifications);
    expect(failed).not.toBe(loaded);
    api.get.mockResolvedValueOnce([{ ...message }]);
    await failed.refresh(true);
    const recovered = render();
    expect(recovered.error).toBeNull();
    expect(recovered.notifications).toBe(loaded.notifications);
    expect(recovered).not.toBe(failed);
  });

  it('keeps new-row delivery deduplicated while updating read and dismissed state', async () => {
    const { api, notify, render } = await renderProvider();
    api.get.mockResolvedValueOnce([message]);
    await render().refresh(true);
    const newMessage = { ...message, notification_id: 34, pushed_at: null };
    api.get.mockImplementation(async () => [{ ...message }, { ...newMessage }]);
    await render().refresh(true);
    render();
    await render().refresh(true);
    expect(notify.push).toHaveBeenCalledTimes(1);
    await render().markRead(34);
    expect(render().notifications.find(row => row.notification_id === 34).is_read).toBe(true);
    await render().dismiss(34);
    expect(render().notifications.map(row => row.notification_id)).toEqual([12]);
    expect(api.del).toHaveBeenCalledWith('/api/notifications/34');
    await render().refresh(true);
    render();
    expect(notify.push).toHaveBeenCalledTimes(1);
  });
});

describe('notification time and semantic presentation', () => {
  it.each([null, 'not-a-date'])('does not display an invalid timestamp for %s', value => {
    expect(presentation.notificationTimeLabel(value)).toBe('Time unavailable');
  });
  it('includes the year for a notification from a previous year', () => {
    expect(presentation.notificationTimeLabel('2025-10-01T08:00:00Z', new Date('2026-10-17T08:00:00Z'))).toContain('2025');
  });
});
