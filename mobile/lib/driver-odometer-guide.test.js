import { describe, expect, it, vi } from 'vitest';
import { nativeRender, nativeViews } from './test-helpers/native-render';
describe('shared odometer evidence review', () => {
  it('uses actual confirm/retake controls without importing native camera or location', async () => {
    const confirm = vi.fn(), retake = vi.fn();
    const h = await nativeRender(new URL('../components/trips/OdometerReview.jsx', import.meta.url), { props: { phase: 'review', stage: 'start', reading: 123456, colors: {}, type: {}, onConfirm: confirm, onRetake: retake }, deps: { '../coachmarks': { CoachMarkTarget: 'Target' }, 'react-native': { ...nativeViews, Image: 'Image' }, '../clay': { ClayButton: 'Button' } } });
    expect(h.text()).toContain('Check every digit');
    h.find(n => n.props.label === 'Confirm and start route').props.onPress(); expect(confirm).toHaveBeenCalledOnce();
    h.find(n => n.props.label === 'Retake photo').props.onPress(); expect(retake).toHaveBeenCalledOnce();
    h.render({ disabledReason: 'Receiving authority not confirmed', stage: 'end' });
    expect(h.find(n => n.props.label === 'Confirm and complete trip').props.disabled).toBe(true);
  });
});
