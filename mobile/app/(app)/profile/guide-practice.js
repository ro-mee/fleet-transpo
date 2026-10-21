import React from 'react';
import { useRouter } from 'expo-router';
import DriverPracticeHost from '../../../components/coachmarks/DriverPracticeHost';
import { useCoachMarkActions, useCoachMarkStatus } from '../../../components/coachmarks';
import { DRIVER_GUIDES_V2 } from '../../../lib/driver-guidance-config';

export default function GuidePracticeScreen() {
  const router = useRouter();
  const { practiceSession } = useCoachMarkStatus();
  const { dispatchPractice, endPractice } = useCoachMarkActions();
  const exit = () => { endPractice?.(); router.replace('/profile/help'); };
  return <DriverPracticeHost session={DRIVER_GUIDES_V2 ? practiceSession : null} onEvent={event => dispatchPractice?.(event) === true} onExit={exit} />;
}
