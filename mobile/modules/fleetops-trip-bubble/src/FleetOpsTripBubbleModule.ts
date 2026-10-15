import { requireOptionalNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

import type { FleetOpsTripBubbleNativeModule } from './FleetOpsTripBubble.types';

const nativeModule = Platform.OS === 'android'
  ? requireOptionalNativeModule<FleetOpsTripBubbleNativeModule>('FleetOpsTripBubble')
  : null;

const FleetOpsTripBubble: FleetOpsTripBubbleNativeModule = nativeModule ?? {
  async canDrawOverlays() { return false; },
  async openOverlaySettings() { return false; },
  async showTripBubble() { return { shown: false, reason: 'unsupported' }; },
  async hideTripBubble() {},
};

export default FleetOpsTripBubble;
