import { afterEach, expect, it, vi } from "vitest";
import { createCargoPhotoSession } from "./cargo-photo-session";

afterEach(() => vi.useRealTimers());

it("forgets a photo at link expiry and cancels in-flight reads on hide", async () => {
  vi.useFakeTimers();
  const states = [];
  let resolve;
  let signal;
  const session = createCargoPhotoSession({ load: async (_id, options) => {
    signal = options.signal;
    return new Promise(done => { resolve = done; });
  }, onChange: state => states.push(state) });
  const opening = session.open("photo");
  session.hide();
  expect(signal.aborted).toBe(true);
  resolve({ url: "private", expires_in: 300 });
  await opening;
  expect(states.at(-1).url).toBe("");

  const loaded = session.open("photo");
  resolve({ url: "private", expires_in: 300 });
  await loaded;
  expect(states.at(-1).url).toBe("private");
  await vi.advanceTimersByTimeAsync(300000);
  expect(states.at(-1).url).toBe("");
  expect(states.at(-1).error).toContain("expired");
});

it("ignores reads after session disposal and removes the previous photo on denied access", async () => {
  const states = [];
  const session = createCargoPhotoSession({ load: async id => {
    if (id === "denied") throw Object.assign(new Error("Access refused"), { status: 403 });
    return { url: "private", expires_in: 300 };
  }, onChange: state => states.push(state) });
  await session.open("photo");
  await session.open("denied");
  expect(states.at(-1)).toMatchObject({ url: "", error: "Access refused" });
  session.dispose();
  const count = states.length;
  await session.open("photo");
  expect(states).toHaveLength(count);
});

it("clears an unreadable image and leaves an actionable error", async () => {
  const states = [];
  const session = createCargoPhotoSession({ load: async () => ({ url: 'private', expires_in: 300 }), onChange: state => states.push(state) });
  await session.open('photo');
  session.imageFailed();
  expect(states.at(-1).url).toBe('');
  expect(states.at(-1).error).toContain('Open the photo again');
  session.dispose();
});
