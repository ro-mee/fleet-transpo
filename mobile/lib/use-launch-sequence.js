import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing } from 'react-native';

export function useLaunchSequence(onComplete) {
  const [reducedMotion, setReducedMotion] = useState(null);
  const [reveal] = useState(() => new Animated.Value(0));
  const [tagline] = useState(() => new Animated.Value(0));
  const [exit] = useState(() => new Animated.Value(1));
  const callback = useRef(onComplete);
  const controls = useRef(null);
  useLayoutEffect(() => { callback.current = onComplete; }, [onComplete]);

  useEffect(() => {
    const started = Date.now(), timers = new Set(), entrances = [];
    let active = true, completed = false, exiting = false, preferenceChanged = false;
    let motion = null, normalTimer, queryTimer, exitAnimation;
    const schedule = (fn, delay) => {
      const timer = setTimeout(fn, Math.max(0, delay));
      timers.add(timer);
      return timer;
    };
    const clearTimers = () => timers.forEach(clearTimeout);
    const stopEntrance = () => entrances.forEach(animation => animation.stop());
    const complete = () => {
      if (!active || completed) return;
      completed = true;
      clearTimers();
      callback.current(motion === true);
    };
    const beginExit = () => {
      if (!active || completed || exiting) return;
      exiting = true;
      const duration = motion === true ? 1 : 180;
      // A native cancellation or missing completion event must still release startup.
      schedule(complete, duration);
      exitAnimation = Animated.timing(exit, {
        toValue: 0,
        duration,
        easing: Easing.bezier(0.32, 0.72, 0, 1),
        useNativeDriver: true,
        isInteraction: false,
      });
      exitAnimation.start(({ finished }) => { if (finished) complete(); });
    };
    const showStatic = () => {
      if (!active || completed || motion === true) return;
      motion = true;
      setReducedMotion(true);
      stopEntrance();
      reveal.setValue(1);
      tagline.setValue(1);
      clearTimeout(queryTimer);
      clearTimeout(normalTimer);
      if (!exiting) schedule(beginExit, Math.min(150, 1900 - (Date.now() - started)));
    };
    const chooseMotion = value => {
      if (!active || completed) return;
      if (value !== false) { showStatic(); return; }
      // Once static, changing the setting back must not replay the opening sequence.
      if (motion !== null) return;
      motion = false;
      setReducedMotion(false);
      clearTimeout(queryTimer);
      for (const [value, at, duration] of [[reveal, 1050, 300], [tagline, 1280, 260]]) {
        const animation = Animated.timing(value, {
          toValue: 1,
          delay: Math.max(0, at - (Date.now() - started)),
          duration,
          easing: Easing.bezier(0.16, 1, 0.3, 1),
          useNativeDriver: true,
          isInteraction: false,
        });
        entrances.push(animation);
        animation.start();
      }
    };
    controls.current = {
      finish() {
        if (!active || completed || exiting || motion !== false) return;
        clearTimeout(normalTimer);
        // A premature artwork event must not skip the text's readable reveal.
        const remaining = 1540 - (Date.now() - started);
        if (remaining > 0) normalTimer = schedule(beginExit, remaining);
        else beginExit();
      },
      animationFailed: showStatic,
    };
    normalTimer = schedule(beginExit, 1900);
    queryTimer = schedule(showStatic, 120);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', value => {
      preferenceChanged = true;
      chooseMotion(value);
    });
    try {
      AccessibilityInfo.isReduceMotionEnabled()
        .then(value => { if (!preferenceChanged) chooseMotion(value); })
        .catch(() => { if (!preferenceChanged) showStatic(); });
    } catch {
      showStatic();
    }
    return () => {
      active = false;
      controls.current = null;
      clearTimers();
      stopEntrance();
      exitAnimation?.stop();
      subscription.remove();
    };
  }, [exit, reveal, tagline]);

  const finish = useCallback(() => controls.current?.finish(), []);
  const animationFailed = useCallback(() => controls.current?.animationFailed(), []);
  return { reducedMotion, reveal, tagline, exit, finish, animationFailed };
}
