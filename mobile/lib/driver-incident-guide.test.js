import { describe, expect, it, vi } from 'vitest';
import { nativeRender, nativeViews, nativeTheme } from './test-helpers/native-render';
import { recommendIncidentSeverity } from '../../shared/incidents/severity';

const deps = { 'react-native': { ...nativeViews, Image: 'Image' }, '@expo/vector-icons': { Ionicons: 'Icon' }, '../../lib/theme-context': nativeTheme, '../../lib/theme': { fonts: {}, TOUCH_TARGET: 48 }, '../../lib/scaling': { moderateScale: x => x }, '../../lib/clay': { raisedControl: () => ({}) }, '../clay': { ClayCard: 'Card', ClayTile: 'Tile', ClayButton: 'Button' }, '../coachmarks': { CoachMarkTarget: 'Target' }, '../../../shared/incidents/severity.js': { INCIDENT_SEVERITY_REASON_LABELS: {} } };
describe('shared incident reporting view', () => {
  it('uses the actual categories and routes their selection to the owning controller', async () => {
    const category = vi.fn();
    const h = await nativeRender(new URL('../components/incidents/IncidentReportForm.jsx', import.meta.url), { props: { values: { type: '', description: '', assistance: [], expense: '', photos: [], severityAnswers: {} }, actions: { onCategory: category } }, deps });
    h.find(n => n.component === 'Card' && n.props.onPress).props.onPress();
    expect(category).toHaveBeenCalledWith('breakdown');
    expect(h.text()).toContain('Choose an incident category');
  });
  it('keeps the real submit callback and computes severity from safety answers', async () => {
    const submit = vi.fn();
    const h = await nativeRender(new URL('../components/incidents/IncidentReportForm.jsx', import.meta.url), { name: 'IncidentSubmitButton', props: { onSubmit: submit }, deps });
    h.find(n => n.props.label === 'Send Incident Report').props.onPress(); expect(submit).toHaveBeenCalledOnce();
    expect(recommendIncidentSeverity({ immediateDanger: 'no', vehicleSafety: 'safe', tripImpact: 'delayed', hazardToOthers: 'no' }).severity).toBe('Moderate');
  });
});
