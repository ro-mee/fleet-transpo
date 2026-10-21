import { useCallback, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';

// Presentation time only: GPS and operational polling keep their own lifecycle.
export function useScreenClock() {
  const [now, setNow] = useState(Date.now);
  const [active, setActive] = useState(false);

  useFocusEffect(useCallback(() => {
    let focused = true;
    let timer = null;
    const stop = () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
    };
    const change = state => {
      if (!focused) return;
      const foreground = state === 'active';
      setActive(foreground);
      if (foreground) {
        setNow(Date.now());
        if (timer === null) timer = setInterval(() => setNow(Date.now()), 30000);
      } else stop();
    };
    const subscription = AppState.addEventListener('change', change);
    change(AppState.currentState);
    return () => {
      focused = false;
      stop();
      subscription.remove();
      setActive(false);
    };
  }, []));

  return { now, active };
}
