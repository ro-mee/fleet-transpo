import { describe, expect, it, vi } from 'vitest';
import { nativeRender, nativeViews, nativeTheme } from './test-helpers/native-render';
const deps = { 'react-native': { ...nativeViews, Image: 'Image', ActivityIndicator: 'Spinner' }, '@expo/vector-icons': { Ionicons: 'Icon' }, '../../lib/theme-context': nativeTheme, '../../lib/theme': { fonts: {}, TOUCH_TARGET: 48 }, '../../lib/scaling': { moderateScale: x => x }, '../clay': { ClayCard: 'Card', ClayButton: 'Button' }, '../coachmarks': { CoachMarkTarget: 'Target' } };
describe('actual shared fuel forms', () => {
  it('edits the actual receipt cost field and submits through the supplied callback', async () => {
    const cost = vi.fn(), submit = vi.fn(), clearPrice = vi.fn();
    const h = await nativeRender(new URL('../components/fuel/FuelReceiptReview.jsx', import.meta.url), { props: { entryMethod: 'scan', liters: '45', cost: '2911.75', station: 'Sample station', fuelDate: '2026-10-21', receiptUrl: 'sample', setCost: cost, setPricePerLiter: clearPrice, handleSubmit: submit, canSubmit: true }, deps });
    h.find(n => n.props.accessibilityLabel === 'Total fuel cost in pesos').props.onChangeText('2911.25');
    expect(cost).toHaveBeenCalledWith('2911.25'); expect(clearPrice).toHaveBeenCalledWith('');
    h.find(n => n.props.label === 'Save Fuel Entry').props.onPress(); expect(submit).toHaveBeenCalledOnce();
  });
  it('retains the gauge capture action and approval-independent request validation', async () => {
    const capture = vi.fn(), request = vi.fn();
    const h = await nativeRender(new URL('../components/fuel/FuelRequestForm.jsx', import.meta.url), { props: { fuelLevelPercent: '25', requestPurpose: '', onCaptureGauge: capture, requestFuel: request, hasAssignedVehicle: true, gaugePhotoUrl: '' }, deps });
    h.find(n => n.props.label === 'Capture gauge with camera').props.onPress(); expect(capture).toHaveBeenCalledOnce();
    expect(h.find(n => n.props.label === 'Request fuel').props.disabled).toBe(true);
    h.render({ gaugePhotoUrl: 'sample' });
    h.find(n => n.props.label === 'Request fuel').props.onPress(); expect(request).toHaveBeenCalledOnce();
  });
});
