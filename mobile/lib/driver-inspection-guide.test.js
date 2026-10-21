import { describe, expect, it, vi } from 'vitest';
import { nativeRender, nativeViews, nativeTheme } from './test-helpers/native-render';
import { PRE_TRIP_CHECKLIST } from './inspection-checklist';
describe('actual shared inspection controls', () => {
  it('reports only the chosen answer and leaves actual submission to its owner', async () => {
    const answer = vi.fn(), remarks = vi.fn();
    const h = await nativeRender(new URL('../components/inspection/InspectionChecklist.jsx', import.meta.url), { props: { items: PRE_TRIP_CHECKLIST, answers: { brakes_tires: null, passenger_items: null, cabin_ready: null }, remarks: {}, onAnswer: answer, onRemarks: remarks, isCargoPreTrip: false }, deps: {
      'react-native': { ...nativeViews, TextInput: 'Input' }, '@expo/vector-icons': { Ionicons: 'Icon' }, '../../lib/theme-context': nativeTheme,
      '../../lib/theme': { fonts: {}, TOUCH_TARGET: 48 }, '../../lib/scaling': { moderateScale: x => x }, '../../lib/clay': { raisedControl: () => ({}) },
      '../clay': { ClayCard: 'Card' }, '../coachmarks': { CoachMarkTarget: 'Target' }, '../ReferencePhotoGuide': { ReferencePhotoGuide: 'PhotoGuide' }, '../../lib/inspection-reference-images': { inspectionReferenceFor: () => null },
    } });
    h.find(n => n.component === 'Pressable').props.onPress();
    expect(answer).toHaveBeenCalledWith('brakes_tires', 'PASS');
    expect(remarks).not.toHaveBeenCalled();
    expect(h.text()).toContain('NO ITEMS LEFT'); expect(h.text()).toContain('CABIN READY');
  });
});
