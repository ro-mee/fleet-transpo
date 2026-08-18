let complete = false;
const listeners = new Set();

export function completeLaunch() {
  complete = true;
  listeners.forEach((listener) => listener());
  listeners.clear();
}

export function onLaunchComplete(listener) {
  if (complete) {
    listener();
    return () => {};
  }
  listeners.add(listener);
  return () => listeners.delete(listener);
}
