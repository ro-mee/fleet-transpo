import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '../../lib/theme-context';
import { listDriverGuides } from '../../lib/driver-guides';
import { PRACTICE_TOPICS } from '../../lib/driver-practice';
import { ClayButton } from '../clay';
import { AppAlert } from '../AppAlert';
import { useCoachMarkActions, useCoachMarkStatus } from './CoachMarkProvider';

const reasons = {
  checking_work: 'A practice check is already in progress.', refresh_required: 'Reconnect and refresh your assignments and pending reports before starting practice.',
  practice_active: 'Finish or exit the current sample first.', assignment: 'Practice is unavailable while you have an accepted or active assignment.',
  pending_submission: 'Finish syncing or reviewing your pending operational reports first.', moving: 'Stop in a safe place before starting practice.',
  movement_hold: 'Recent movement was detected. Park safely and wait for the movement hold to clear.', emergency: 'Finish the emergency or responder work before practicing.',
};

export default function DriverGuideLibrary() {
  const { colors, type } = useTheme(), router = useRouter();
  const { workspace, guideError } = useCoachMarkStatus();
  const { replayGuide, startPractice } = useCoachMarkActions();
  const [expanded, setExpanded] = useState(null), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const classified = ['passenger', 'cargo'].includes(workspace);
  const guides = classified ? listDriverGuides(workspace) : listDriverGuides('passenger').filter(guide => guide.variant === 'common');
  const practice = guide => AppAlert.alert('Are you safely parked?', 'Start this optional sample only when safely parked, with no accepted or active assignment, pending submission or emergency work. Everything stays on this screen and is discarded when you exit.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'I am safely parked', onPress: async () => {
      setBusy(true); setMessage('');
      try {
        const result = await startPractice({ topic: guide.id, variant: workspace, parkedConfirmed: true });
        if (result.allowed) router.push('/profile/guide-practice');
        else setMessage(reasons[result.reason] || 'Practice is unavailable. Check your saved driver type, current work and safe parking status, then try again.');
      } catch { setMessage('Could not start the sample. Please refresh and try again.'); }
      finally { setBusy(false); }
    } },
  ]);
  return <View style={{ gap: 8 }}>
    <Text style={type.headlineMd}>Driver guidance</Text>
    <Text style={type.bodyMd}>Read a section whenever you need it. Practice is optional and uses fictional data. It never submits reports, signs real counts or changes your assignment.</Text>
    {!classified ? <Text style={type.bodyMd}>Ask Dispatch to save your Passenger or Cargo driver type. These common instructions remain available to read.</Text> : null}
    {guides.length === 0 ? <Text style={type.bodyMd}>Ask Dispatch to save your Passenger or Cargo driver type. Guidance will then match your work.</Text> : guides.map(guide => <View key={`${guide.id}.${guide.variant}`} style={{ borderBottomWidth: 1, borderBottomColor: colors.outlineVariant }}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: expanded === guide.id }} onPress={() => setExpanded(expanded === guide.id ? null : guide.id)} style={{ minHeight: 48, paddingVertical: 14, justifyContent: 'center' }}><Text style={type.labelLg}>{guide.title}</Text></Pressable>
      {expanded === guide.id ? <View style={{ gap: 12, paddingBottom: 16 }}><Text style={type.bodyMd}>{guide.steps[0].body}</Text><Text style={type.bodyMd}>{guide.steps[0].details}</Text>{classified ? <ClayButton label="Read this section" variant="tonal" disabled={busy} onPress={async () => { if (!await replayGuide({ guideId: guide.id, variant: workspace })) setMessage('Close any open guide or emergency screen, then try again.'); }} /> : null}{classified && PRACTICE_TOPICS.includes(guide.id) ? <ClayButton label="Try with sample data" variant="tonal" disabled={busy} onPress={() => practice(guide)} /> : null}</View> : null}
    </View>)}
    {message || guideError ? <Text accessibilityLiveRegion="polite" style={type.bodyMd}>{message || guideError}</Text> : null}
  </View>;
}
