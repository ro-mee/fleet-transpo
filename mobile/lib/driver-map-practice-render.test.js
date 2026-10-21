import { describe, expect, it, vi } from 'vitest';
import { nativeRender, nativeViews, nativeTheme } from './test-helpers/native-render';
import * as presentation from './load-presentation';
describe('shared production Map views', () => {
  it('passes control actions only through the supplied callbacks', async () => {
    const act = vi.fn();
    const h = await nativeRender(new URL('../components/map/MapControlCluster.jsx', import.meta.url), { props: { controls: [{ id: 'recenter', label: 'Recenter map', icon: 'navigate', onPress: act }, { id: 'navigate', label: 'Open navigation', icon: 'open', disabled: true, onPress: act }] }, deps: { 'react-native': nativeViews, '@expo/vector-icons': { Ionicons: 'Icon' }, '../../lib/theme-context': nativeTheme } });
    h.find(n => n.props.accessibilityLabel === 'Recenter map').props.onPress(); expect(act).toHaveBeenCalledOnce();
    expect(h.find(n => n.props.accessibilityLabel === 'Open navigation').props.disabled).toBe(true);
  });
  it('renders the same Passenger header for sample and production props without network dependencies', async () => {
    const h = await nativeRender(new URL('../components/map/PassengerMapSummary.jsx', import.meta.url), { props: { activeTrip: { trip_status: 'At Pickup', passenger_count: 2 }, isState2: true, destName: 'Sample hotel', profile: { driverType: 'Passenger' } }, deps: { 'react-native': nativeViews, '@expo/vector-icons': { Ionicons: 'Icon' }, '../../lib/theme-context': nativeTheme, '../../lib/theme': { fonts: {} }, '../../lib/clay': { clayMaterials: () => ({ clayTile: {} }) }, '../../lib/load-presentation': presentation, '../coachmarks': { CoachMarkTarget: 'Target' } } });
    expect(h.text()).toContain('ARRIVED AT PICKUP'); expect(h.text()).toContain('Sample hotel');
    expect(h.text()).toContain('2 Guests');
  });
});
