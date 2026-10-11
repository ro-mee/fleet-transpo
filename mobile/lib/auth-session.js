import { decodeJwtRole } from "./rbac";
import { saveTokens, saveUser } from "./storage";
import { setCargoSessionActor } from "./cargo-sync";

export async function persistSignedInSession(data) {
  // Fence the previous account before replacement credentials enter the
  // serialized token store. A queued refresh can then only finish as stale.
  setCargoSessionActor(null);
  await saveTokens({
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
  });

  const user = {
    ...data.driver,
    role: decodeJwtRole(data.accessToken) || "driver",
    mustChangePassword: Boolean(data.driver?.mustChangePassword),
  };
  setCargoSessionActor(user.employeeId ?? null);
  await saveUser(user);
  return user;
}
