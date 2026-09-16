import AsyncStorage from '@react-native-async-storage/async-storage';

export const GUIDE_STORAGE_KEY = '@fleetops_driver_guide_progress';

export const MISSIONS = [
  {
    id: 'inspection',
    title: 'Pre-Trip Vehicle Inspection',
    subtitle: '7-point mandatory safety checklist',
    icon: 'shield-checkmark',
    badge: 'Safety First',
    durationMinutes: 2,
    description: 'Ensure vehicle roadworthiness before your shift starts. Learn how to verify vehicle condition and flag faults.',
    steps: [
      {
        title: 'Why Pre-Trip Inspection Matters',
        instruction: 'Every shift begins with safety. Dispatch and passengers depend on your vehicle being in top condition before departure.',
        tip: 'Inspections are recorded permanently in your activity history and vehicle health logs.',
      },
      {
        title: 'Interactive Checklist Practice',
        instruction: 'Tap through each safety item. Mark items as PASS, or select FAIL if you notice any warning lights or issues.',
        type: 'interactive_checklist',
      },
      {
        title: 'Flagging Critical Issues',
        instruction: 'When a critical item fails (like brakes or dashboard warnings), dispatch is alerted to swap your vehicle or send a mechanic.',
        tip: 'Never operate a vehicle with failing brakes or active safety warning lights.',
      },
    ],
  },
  {
    id: 'swipe',
    title: 'Mastering the Swipe Gesture',
    subtitle: 'Accidental-touch prevention',
    icon: 'swap-horizontal',
    badge: 'Core Gesture',
    durationMinutes: 2,
    description: 'Critical trip transitions use slide gestures instead of simple taps to prevent accidental triggers while driving.',
    steps: [
      {
        title: 'Why We Swipe Instead of Tap',
        instruction: 'Phone mounts can vibrate or be tapped accidentally. Swiping ensures intentional, confident confirmation.',
        tip: 'Slide the thumb smoothly across the track until the success animation plays.',
      },
      {
        title: 'Practice: Start Your Route',
        instruction: 'Practice sliding the button below to simulate starting your first trip of the day.',
        type: 'interactive_swipe',
        swipeTitle: 'Slide to Start Route',
        successMessage: 'Route Started! GPS tracking is now active.',
      },
      {
        title: 'Practice: Arrived at Pickup',
        instruction: 'Once you arrive at the guest pickup location, slide to update dispatch and notify waiting passengers.',
        type: 'interactive_swipe',
        swipeTitle: 'Slide to Confirm Pickup',
        successMessage: 'Arrival Confirmed! Guest notified.',
      },
      {
        title: 'Practice: Complete Trip',
        instruction: 'When guests have safely disembarked at the destination, slide to finalize the trip.',
        type: 'interactive_swipe',
        swipeTitle: 'Slide to Complete Trip',
        successMessage: 'Trip Finalized! Ready for odometer log.',
      },
    ],
  },
  {
    id: 'trip_flow',
    title: 'Trip Lifecycle & Odometer',
    subtitle: 'From dispatch to drop-off',
    icon: 'navigate',
    badge: 'Workflow',
    durationMinutes: 3,
    description: 'Understand the complete flow of an assigned dispatch: navigation, route stops, and odometer verification.',
    steps: [
      {
        title: 'Reviewing Your Dispatch',
        instruction: 'Assignments display your pickup location, scheduled departure, destination, and passenger headcount at a glance.',
        tip: 'Check upcoming trips in your schedule so you can plan travel and rest buffers accordingly.',
      },
      {
        title: 'Interactive Odometer Verification',
        instruction: 'At trip completion, enter your ending dashboard odometer reading to compute distance traveled.',
        type: 'interactive_odometer',
        startOdo: 45210,
        tip: 'Ending odometer must always be greater than your starting odometer.',
      },
      {
        title: 'Destination Geofence & Detours',
        instruction: 'If passengers ask to drop off at an alternate gate outside the planned pin, select a valid detour reason.',
        type: 'interactive_override',
        tip: 'Providing an override reason ensures dispatch approves off-geofence completions without penalty.',
      },
    ],
  },
  {
    id: 'fuel',
    title: 'Fuel Receipt & Level Scanner',
    subtitle: 'Camera viewfinder alignment',
    icon: 'speedometer',
    badge: 'Logistics',
    durationMinutes: 2,
    description: 'Learn how to scan gas station receipts with automated OCR and log fuel levels quickly.',
    steps: [
      {
        title: 'When to Report Fuel',
        instruction: 'Log refueling whenever you refuel during your shift or submit a pre-approved fuel allowance request.',
        tip: 'Always ask the gas station attendant for a printed physical receipt.',
      },
      {
        title: 'Interactive Receipt Scanner',
        instruction: 'Position the receipt inside the viewfinder guides. Tap the scan button to see FleetOps AI auto-extract liters and cost.',
        type: 'interactive_fuel_scan',
        tip: 'Ensure good lighting and avoid crumpled paper for 100% OCR accuracy.',
      },
      {
        title: 'Verifying Auto-Filled Values',
        instruction: 'Always double-check the detected numbers before submitting. You can edit any field manually if needed.',
        tip: 'Fuel submissions are matched against GPS distance and tank capacity to prevent errors.',
      },
    ],
  },
  {
    id: 'sos',
    title: 'Emergency SOS & Breakdowns',
    subtitle: 'Immediate dispatch hotline',
    icon: 'alert-circle',
    badge: 'Emergency',
    durationMinutes: 2,
    description: 'The floating SOS button is available on every screen. Learn how to call dispatch or request urgent roadside aid.',
    steps: [
      {
        title: 'The Floating SOS Medallion',
        instruction: 'Look for the red SOS button on your screen. You can drag it to any corner so it never blocks your map or navigation.',
        tip: 'The button stays with you across the app for quick one-touch emergency access.',
      },
      {
        title: 'Interactive SOS Practice',
        instruction: 'Tap the simulated SOS button below to open the emergency command modal.',
        type: 'interactive_sos',
      },
      {
        title: 'Selecting the Right Assistance',
        instruction: 'Choose between the direct 24/7 Dispatch Hotline, Police, Medical Emergency, or roadside Towing/Mechanic.',
        tip: 'Triggering an emergency alert sends your live GPS coordinates to dispatch immediately.',
      },
    ],
  },
  {
    id: 'offline',
    title: 'Offline Mode & Tunnel Driving',
    subtitle: 'Zero data loss in dead zones',
    icon: 'cloud-offline',
    badge: 'Resilience',
    durationMinutes: 2,
    description: 'Basement parking and mountain tunnels lose signal. Learn how FleetOps stores your actions offline and syncs automatically.',
    steps: [
      {
        title: 'No Internet? No Problem!',
        instruction: 'When cellular connection drops, an amber or gray banner appears at the top: "You\'re offline". The app continues working normally.',
        tip: 'GPS tracking logs your location locally and never double-counts distance.',
      },
      {
        title: 'Interactive Tunnel & Sync Simulator',
        instruction: 'Simulate losing signal in an underground tunnel, queue an action, and watch automatic background sync upon exit.',
        type: 'interactive_offline_sync',
        tip: 'You never have to tap "Retry" manually — sync runs automatically when 4G/Wi-Fi returns.',
      },
      {
        title: 'The Outbox Queue Guarantee',
        instruction: 'All pending odometer logs, fuel reports, and trip arrivals remain encrypted in local storage until safely delivered.',
      },
    ],
  },
];

export function getGuideStorageKey(driverId) {
  return driverId ? `${GUIDE_STORAGE_KEY}_${driverId}` : GUIDE_STORAGE_KEY;
}

export async function getGuideProgress(driverId = null) {
  try {
    const key = getGuideStorageKey(driverId);
    const raw = await AsyncStorage.getItem(key);
    if (!raw) {
      return { completedMissions: [], lastCompletedAt: null };
    }
    const data = JSON.parse(raw);
    return {
      completedMissions: Array.isArray(data?.completedMissions) ? data.completedMissions : [],
      lastCompletedAt: data?.lastCompletedAt || null,
    };
  } catch {
    return { completedMissions: [], lastCompletedAt: null };
  }
}

export async function markMissionComplete(missionId, driverId = null) {
  if (!missionId) return { completedMissions: [], lastCompletedAt: null };
  try {
    const current = await getGuideProgress(driverId);
    const set = new Set(current.completedMissions);
    set.add(missionId);
    const updated = {
      completedMissions: Array.from(set),
      lastCompletedAt: new Date().toISOString(),
    };
    const key = getGuideStorageKey(driverId);
    await AsyncStorage.setItem(key, JSON.stringify(updated));
    return updated;
  } catch {
    return { completedMissions: [missionId], lastCompletedAt: new Date().toISOString() };
  }
}

export async function resetGuideProgress(driverId = null) {
  try {
    const key = getGuideStorageKey(driverId);
    await AsyncStorage.removeItem(key);
  } catch {}
  return { completedMissions: [], lastCompletedAt: null };
}

export function calculateProgress(completedMissions = []) {
  const completedSet = new Set(completedMissions);
  const totalCount = MISSIONS.length;
  const completedCount = MISSIONS.filter((m) => completedSet.has(m.id)).length;
  const percent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
  const isComplete = completedCount === totalCount && totalCount > 0;
  return {
    completedCount,
    totalCount,
    percent,
    isComplete,
  };
}
