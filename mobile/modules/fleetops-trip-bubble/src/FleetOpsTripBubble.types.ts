export type ShowTripBubbleResult = {
  shown: boolean;
  reason?: 'unsupported' | 'permission-denied' | 'invalid-trip' | 'start-failed';
};

export type FleetOpsTripBubbleModuleEvents = Record<string, never>;

export interface FleetOpsTripBubbleNativeModule {
  canDrawOverlays(): Promise<boolean>;
  openOverlaySettings(): Promise<boolean>;
  showTripBubble(tripId: string): Promise<ShowTripBubbleResult>;
  hideTripBubble(): Promise<void>;
}
