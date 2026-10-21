import React, { useEffect, useLayoutEffect } from 'react';
import { usePathname } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { resolveDriverWorkspace } from '../../lib/driver-workspace';
import { ClayButton } from '../clay';
import { useCoachMarkActions, useCoachMarkStatus } from './CoachMarkProvider';

// A producer for this screen only. The controller still checks motion, identity,
// context, route and exact measured target before presenting an automatic tip.
export default function DriverGuideTrigger({ guideId, enabled = true, trip, requireTrip = false }) {
  const route = usePathname(), focused = useIsFocused();
  const { guideVersion2, workspace, activeMilestone } = useCoachMarkStatus();
  const { requestGuide, replayGuide, updateGuideContext } = useCoachMarkActions();
  const tripReady = !requireTrip || resolveDriverWorkspace({ driverType: workspace === 'cargo' ? 'Cargo' : workspace === 'passenger' ? 'Passenger' : null, trip }).tripReady === true;
  const ready = enabled && tripReady;
  useLayoutEffect(() => {
    if (guideVersion2 && focused) updateGuideContext({ contextRoute: route, contextValid: ready });
  }, [guideVersion2, focused, route, ready, updateGuideContext]);
  useEffect(() => {
    if (!guideVersion2 || !focused || !ready || activeMilestone || !guideId) return;
    let alive = true, attempts = 0;
    const tryGuide = () => {
      if (alive && ++attempts <= 30) void requestGuide({ guideId, variant: workspace });
    };
    tryGuide();
    const timer = setInterval(tryGuide, 1000);
    return () => { alive = false; clearInterval(timer); };
  }, [guideVersion2, focused, ready, activeMilestone, guideId, workspace, requestGuide]);
  if (!guideVersion2 || !guideId) return null;
  return <ClayButton label="Explain this step" variant="tonal" onPress={() => replayGuide({ guideId, variant: workspace })} />;
}
