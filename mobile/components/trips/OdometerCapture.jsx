import DriverGuideTrigger from '../coachmarks/DriverGuideTrigger';
import { CoachMarkTarget } from '../coachmarks';
import OdometerReview from './OdometerReview';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../lib/theme-context';
import { ClayButton } from '../clay';

/** Camera/review visuals only. The owning screen supplies all network actions. */
export default function OdometerCapture({ stage, phase = 'camera', asset, reading, previousReading,
  tripReference, plate, preTripComplete = false, error, retakeRequired = false, disabledReason,
  onCapture, onRead, onConfirm, onRetake, onCancel }) {
  const { colors, type } = useTheme();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission, getPermission] = useCameraPermissions();
  const [focused, setFocused] = useState(false);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [torch, setTorch] = useState(false);
  const [ready, setReady] = useState(false);
  const [taking, setTaking] = useState(false);
  const [cameraError, setCameraError] = useState(null);
  const camera = useRef(null);
  const captureLock = useRef(false);
  const active = useRef(false);
  const focusRef = useRef(false);
  const foregroundRef = useRef(AppState.currentState === 'active');
  const cameraGeneration = useRef(0);
  useFocusEffect(useCallback(() => {
    focusRef.current = true; active.current = foregroundRef.current; setFocused(true);
    return () => { focusRef.current = false; active.current = false; cameraGeneration.current += 1; captureLock.current = false; setFocused(false); setReady(false); setTaking(false); };
  }, []));
  useEffect(() => {
    const listener = AppState.addEventListener('change', state => {
      foregroundRef.current = state === 'active';
      active.current = focusRef.current && foregroundRef.current;
      setForeground(state === 'active');
      if (state !== 'active') { cameraGeneration.current += 1; captureLock.current = false; setReady(false); setTaking(false); }
    });
    return () => listener.remove();
  }, []);
  useEffect(() => {
    if (!focused || !foreground || phase !== 'camera') return;
    let current = true;
    getPermission().catch(() => {
      if (current && active.current) setCameraError('Camera permission could not be checked. Open settings or try again.');
    });
    return () => { current = false; };
  }, [focused, foreground, phase, getPermission]);
  const busy = ['uploading', 'scanning', 'saving'].includes(phase) || taking;
  const capture = async () => {
    if (captureLock.current || !ready || disabledReason || !camera.current) return;
    captureLock.current = true; setTaking(true); setCameraError(null);
    const generation = cameraGeneration.current;
    try {
      const photo = await camera.current.takePictureAsync({ quality: 0.8 });
      if (active.current && generation === cameraGeneration.current && photo?.uri) { setReady(false); onCapture?.(photo); }
    } catch { if (active.current && generation === cameraGeneration.current) setCameraError('The camera could not take this photo. Try again.'); }
    finally { if (generation === cameraGeneration.current) { captureLock.current = false; if (active.current) setTaking(false); } }
  };
  const label = phase === 'uploading' ? 'Uploading photo...' : phase === 'scanning' ? 'Reading odometer...'
    : phase === 'saving' ? stage === 'end' ? 'Completing trip...' : 'Starting route...' : null;
  return <View style={[s.content, { paddingBottom: Math.max(24, insets.bottom) }]}>
    <DriverGuideTrigger guideId={stage === 'end' ? 'odometer.end' : 'odometer.start'} enabled={!disabledReason && phase !== 'saving'} />
    {tripReference || plate ? <Text style={type.supporting}>{[plate, tripReference].filter(Boolean).join(' · ')}</Text> : null}
    {preTripComplete && stage === 'start' ? <Text style={[type.supporting, { color: colors.primary }]}>Pre-Trip complete</Text> : null}
    {phase === 'camera' ? <>
      <Text style={type.supporting}>Park safely. Keep the total odometer and km unit visible.</Text>
      {!permission ? <ActivityIndicator color={colors.primary} accessibilityLabel="Checking camera permission" />
        : !permission.granted ? <View style={s.permission}>
          <Ionicons name="camera-outline" size={32} color={colors.onSurfaceVariant} accessible={false} />
          <Text style={type.cardTitle}>Allow camera access</Text>
          <Text style={type.supporting}>A new dashboard photo is needed to record this odometer.</Text>
          <ClayButton label={permission.canAskAgain ? 'Allow camera' : 'Open settings'} onPress={permission.canAskAgain ? requestPermission : () => Linking.openSettings()} />
        </View> : <>
          <View style={[s.preview, { backgroundColor: colors.surfaceContainer }]}>
            {focused && foreground ? <CameraView ref={camera} style={StyleSheet.absoluteFillObject} facing="back" enableTorch={torch}
              onCameraReady={() => { setReady(true); setCameraError(null); }} onMountError={() => { setReady(false); setCameraError('Camera unavailable. Close other camera apps and try again.'); }} /> : null}
            <View pointerEvents="none" style={[s.guide, { borderColor: colors.onPrimary }]} />
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={torch ? 'Turn torch off' : 'Turn torch on'} accessibilityState={{ selected: torch }} onPress={() => setTorch(v => !v)} style={s.torch}>
            <Ionicons name={torch ? 'flash' : 'flash-outline'} size={24} color={colors.primary} accessible={false} />
            <Text style={[type.labelLg, { color: colors.primary }]}>Torch {torch ? 'on' : 'off'}</Text>
          </Pressable>
          <CoachMarkTarget targetId="odometer.photo"><ClayButton label="Take odometer photo" onPress={capture} loading={taking} disabled={!ready || !focused || !foreground || !!disabledReason} /></CoachMarkTarget>
        </>}
    </> : <>
      <OdometerReview guideTarget {...{ stage, phase, asset, reading, previousReading, label, busy, disabledReason, retakeRequired, onRead, onConfirm, onRetake, colors, type }} />
    </>}
    {disabledReason ? <Text accessibilityRole="alert" style={type.supporting}>{disabledReason}</Text> : null}
    {error || cameraError ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={[type.supporting, { color: colors.error }]}>{error || cameraError}</Text> : null}
    <ClayButton label="Cancel" variant="outline" onPress={onCancel} />
  </View>;
}

const s = StyleSheet.create({
  content: { gap: 12 },
  preview: { width: '100%', aspectRatio: 4 / 3, maxHeight: 360, borderRadius: 20, overflow: 'hidden' },
  guide: { position: 'absolute', top: '32%', bottom: '32%', left: '8%', right: '8%', borderWidth: 2, borderRadius: 8 },
  permission: { gap: 12, paddingVertical: 24 },
  torch: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', minHeight: 48, paddingHorizontal: 12, gap: 8 },
});
