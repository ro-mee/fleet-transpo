import { useEffect, useState } from 'react';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { useAuth } from '../lib/auth';
import { isDriverSession } from '../lib/rbac';
import { hideTripBubble } from '../lib/trip-bubble';
import { parseTripDeepLink, resolveTripReturnRoute } from '../lib/trip-deep-link';

export default function RedirectTrip() {
  const { user, loading } = useAuth();
  const { tripId } = useLocalSearchParams();
  const [cleared, setCleared] = useState(false);
  const [refresh] = useState(() => String(Date.now()));
  const requested = typeof tripId === 'string'
    ? parseTripDeepLink(`fleetops:///redirect-trip?tripId=${encodeURIComponent(tripId)}`) : null;

  useEffect(() => {
    let mounted = true;
    hideTripBubble().then(() => { if (mounted) setCleared(true); });
    return () => { mounted = false; };
  }, []);

  if (loading || !cleared) return null;
  if (!isDriverSession(user)) return <Redirect href="/login" />;
  if (user.mustChangePassword) return <Redirect href="/set-password" />;
  return <Redirect href={{ pathname: resolveTripReturnRoute({ requestedId: requested?.tripId }), params: { bubbleReturn: refresh } }} />;
}
