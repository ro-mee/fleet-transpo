import { describe, expect, it, vi } from 'vitest';
import { nativeRender, nativeViews, nativeTheme } from './test-helpers/native-render';

describe('driver guide explanation and practice identity', () => {
  it('renders the full explanation in a scrollable native sheet and closes on Back', async () => {
    const close = vi.fn();
    const h = await nativeRender(new URL('../components/coachmarks/GuideDetailsSheet.jsx', import.meta.url), { props: { visible: true, title: 'Count honestly', body: 'Blank means not counted. Zero means none. A signature does not clear departure.', onClose: close }, deps: { 'react-native': nativeViews, 'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 20, bottom: 20 }) }, '../../lib/theme-context': nativeTheme, '../clay': { ClayButton: 'Button' } } });
    expect(h.text()).toContain('A signature does not clear departure');
    expect(h.find(n => n.component === 'ScrollView')).toBeTruthy();
    h.find(n => n.component === 'Modal').props.onRequestClose(); expect(close).toHaveBeenCalledOnce();
    expect(h.find(n => n.props.label === 'Back to guide').props.onPress).toBe(close);
  });
  it('keeps sample identity and Exit available on every practice view', async () => {
    const exit = vi.fn();
    const h = await nativeRender(new URL('../components/coachmarks/PracticeBanner.jsx', import.meta.url), { props: { onExit: exit }, deps: { 'react-native': nativeViews, '../../lib/theme-context': nativeTheme, '../clay': { ClayButton: 'Button' } } });
    expect(h.text()).toContain('Sample data'); expect(h.text()).toContain('Nothing here will be submitted');
    h.find(n => n.props.label === 'Exit practice').props.onPress(); expect(exit).toHaveBeenCalledOnce();
  });
});
