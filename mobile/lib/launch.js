let complete = false;
const listeners = new Set();

export function completeLaunch() {
  if (complete) return;
  complete = true;
  const pending = [...listeners];
  listeners.clear();
  pending.forEach((listener) => listener());
}

export function onLaunchComplete(listener) {
  if (complete) {
    listener();
    return () => {};
  }
  listeners.add(listener);
  return () => listeners.delete(listener);
}
