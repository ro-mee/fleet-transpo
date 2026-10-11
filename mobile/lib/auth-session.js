import { decodeJwtRole } from "./rbac";
import { clearAll, getAccessToken, getRefreshToken, getSessionState, getUser, markSignInComplete, markSignInPending, saveTokens, saveUser } from "./storage";
import { beginCargoSessionTransition, setCargoSessionActor } from "./cargo-sync";

export async function persistSignedInSession(data) {
  // Fence the previous account before replacement credentials enter the
  // serialized token store. A queued refresh can then only finish as stale.
  beginCargoSessionTransition();
  await markSignInPending();
  await saveTokens({
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
  });

  const user = {
    ...data.driver,
    role: decodeJwtRole(data.accessToken) || "driver",
    mustChangePassword: Boolean(data.driver?.mustChangePassword),
  };
  await saveUser(user);
  await markSignInComplete();
  setCargoSessionActor(user.employeeId ?? null);
  return user;
}

export async function getRestorableSignedInUser() {
  const [state, accessToken, refreshToken, user] = await Promise.all([
    getSessionState(),
    getAccessToken(),
    getRefreshToken(),
    getUser(),
  ]);
  if (state === "transition" || state === "signed_out") return null;
  return accessToken && refreshToken && user ? user : null;
}

export async function completeSignIn(data, setUser) {
  try {
    const user = await persistSignedInSession(data);
    setUser(user);
    return user;
  } catch (error) {
    // A partial SecureStore write must never leave the previous UI identity
    // active beside replacement or mixed credentials. Clear the UI identity
    // immediately and keep the actor in transition until durable cleanup ends.
    setUser(null);
    let cleared = false;
    try {
      await clearAll();
      cleared = true;
    } catch {
      // Stay in the non-refreshable transition state if durable cleanup failed.
    }
    if (cleared) setCargoSessionActor(null);
    throw error;
  }
}
