import { useEffect, useLayoutEffect, useRef } from 'react';
import { AppState } from 'react-native';

const READY_WINDOW_MS = 180;
const MAX_SEEK_DRIFT_MS = 40;

// Optional decoration: the launch never awaits this hook or depends on its result.
export function useLaunchAudio(enabled) {
  const control = useRef(null);
  const enabledNow = useRef(enabled);
  useLayoutEffect(() => { enabledNow.current = enabled; }, [enabled]);

  useEffect(() => {
    let player, statusSubscription, appSubscription, deadline;
    let disposed = false, cancelled = false, started = false, seeking = false, modeReady = false;
    let beganAt = null;
    let appState = AppState.currentState;

    const stop = () => {
      cancelled = true;
      clearTimeout(deadline);
      try { player?.pause(); } catch { /* An unavailable native player must not affect launch. */ }
    };
    const canStart = () => !disposed && !cancelled && !started && enabledNow.current === true
      && appState === 'active' && beganAt !== null && Date.now() - beganAt < READY_WINDOW_MS;

    const playWhenReady = async () => {
      try {
        if (!canStart() || seeking || !modeReady || !player?.isLoaded) return;
        seeking = true;
        const seekAt = Date.now();
        await player.seekTo((seekAt - beganAt) / 1000, 0, 0);
        // A slow native seek cannot shift the letter accents behind the animation.
        if (!canStart() || Date.now() - seekAt > MAX_SEEK_DRIFT_MS) { stop(); return; }
        started = true;
        clearTimeout(deadline);
        player.play();
      } catch { stop(); }
    };

    const setEnabled = (value) => {
      if (disposed || cancelled) return;
      if (value !== true) {
        if (beganAt !== null) stop();
        return;
      }
      if (beganAt !== null) return;
      if (appState !== 'active') { stop(); return; }
      beganAt = Date.now();
      deadline = setTimeout(stop, READY_WINDOW_MS);
      void playWhenReady();
    };
    control.current = { setEnabled };

    try {
      appSubscription = AppState.addEventListener('change', (next) => {
        if (disposed) return;
        appState = next;
        if (next !== 'active') stop();
      });
      // An older development binary may not contain ExpoAudio yet.
      const { createAudioPlayer, setAudioModeAsync } = require('expo-audio');
      player = createAudioPlayer(require('../assets/audio/hotel-route-launch.wav'), {
        updateInterval: 50,
        keepAudioSessionActive: false,
      });
      player.loop = false;
      player.volume = 0.55;
      statusSubscription = player.addListener('playbackStatusUpdate', playWhenReady);
      Promise.resolve(setAudioModeAsync({
        playsInSilentMode: false,
        interruptionMode: 'mixWithOthers',
        allowsRecording: false,
        shouldPlayInBackground: false,
        shouldRouteThroughEarpiece: false,
        allowsBackgroundRecording: false,
      })).then(() => {
        if (disposed || cancelled) return;
        modeReady = true;
        void playWhenReady();
      }).catch(stop);
      setEnabled(enabledNow.current);
    } catch { stop(); }

    return () => {
      disposed = true;
      stop();
      try { statusSubscription?.remove(); } catch { /* Native cleanup is best effort. */ }
      try { appSubscription?.remove(); } catch { /* Still release the audio resource. */ }
      try { player?.release(); } catch { /* The player may already have been released. */ }
    };
  }, []);

  useEffect(() => {
    control.current?.setEnabled(enabled);
  }, [enabled]);
}
