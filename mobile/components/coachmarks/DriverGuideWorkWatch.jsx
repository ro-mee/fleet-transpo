import { useLayoutEffect, useRef } from 'react';
import { useNotificationFeed } from '../../context/notification-feed';
import { useCoachMarkActions, useCoachMarkStatus } from './CoachMarkProvider';

// Reuse the existing inbox feed; never start a second notification/network loop.
export default function DriverGuideWorkWatch() {
  const { notifications, loading } = useNotificationFeed();
  const { guideVersion2 } = useCoachMarkStatus();
  const { interruptGuidance, updateGuideContext } = useCoachMarkActions();
  const previous = useRef(null);
  useLayoutEffect(() => {
    if (!guideVersion2 || loading) return;
    const current = new Set(notifications.map(row => row.notification_id).filter(Boolean));
    if (previous.current && notifications.some(row => current.has(row.notification_id) && !previous.current.has(row.notification_id))) {
      interruptGuidance();
      updateGuideContext({ work: null });
    }
    previous.current = current;
  }, [guideVersion2, loading, notifications, interruptGuidance, updateGuideContext]);
  return null;
}
