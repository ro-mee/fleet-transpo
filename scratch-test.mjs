import { query } from "./src/lib/db.js";

async function runTests() {
  console.log("Starting API Acceptance Tests...");

  // 1. Get two active drivers from the database
  const { rows: drivers } = await query(
    `SELECT e.email, e.employee_id FROM employees e 
     JOIN roles r ON e.role_id = r.role_id 
     JOIN drivers d ON e.employee_id = d.employee_id
     WHERE r.role_name = 'driver' AND e.status = 'Active'
     ORDER BY e.email LIMIT 2`
  );

  if (drivers.length < 2) {
    console.error("Not enough drivers found to run tests.");
    process.exit(1);
  }

  const userA = drivers[0];
  const userB = drivers[1];
  console.log(`Test User A: ${userA.email}`);
  console.log(`Test User B: ${userB.email}`);

  // Helper to login and get token
  const loginMobile = async (email, ip, userAgent) => {
    const res = await fetch("http://localhost:3000/api/mobile/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-For": ip,
        "User-Agent": userAgent
      },
      body: JSON.stringify({ email, password: "driver123" }) // assume seeded password
    });
    if (!res.ok) throw new Error(`Login failed for ${email}: ${await res.text()}`);
    return await res.json();
  };

  const getSessions = async (token) => {
    const res = await fetch("http://localhost:3000/api/auth/sessions", {
      headers: { "Authorization": `Bearer ${token}` }
    });
    if (!res.ok) throw new Error(`Get sessions failed: ${await res.text()}`);
    const data = await res.json();
    return data.sessions;
  };

  const revokeSession = async (token, sessionId, kind) => {
    const res = await fetch("http://localhost:3000/api/auth/sessions", {
      method: "DELETE",
      headers: { 
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ id: sessionId, kind })
    });
    return { status: res.status, ok: res.ok };
  };

  try {
    console.log("\\n--- Testing Mobile Session Lifecycle & Current Device Detection ---");
    // Device A logs in
    const authA = await loginMobile(userA.email, "123.123.123.123", "MobileDeviceA");
    // Device B logs in (same user, different IP/Device)
    const authB = await loginMobile(userA.email, "124.124.124.124", "MobileDeviceB");
    
    let sessionsA = await getSessions(authA.accessToken);
    let sessionsB = await getSessions(authB.accessToken);
    
    const sessAForA = sessionsA.find(s => s.is_current);
    const sessBForA = sessionsA.find(s => !s.is_current && s.ipAddress === "124.124.124.x");
    
    if (sessAForA && sessBForA) {
      console.log("✅ Device A correctly sees itself as current and Device B as other.");
    } else {
      console.error(sessionsA);
      throw new Error("Failed Current Device detection for Device A.");
    }

    const sessBForB = sessionsB.find(s => s.is_current);
    if (sessBForB && sessBForB.ipAddress === "124.124.124.x") {
      console.log("✅ Device B correctly sees itself as current.");
    } else {
      throw new Error("Failed Current Device detection for Device B.");
    }

    console.log("\\n--- Testing Shared IP Handling ---");
    const authC = await loginMobile(userA.email, "123.123.123.123", "MobileDeviceC");
    let sessionsC = await getSessions(authC.accessToken);
    const currentForC = sessionsC.filter(s => s.is_current);
    if (currentForC.length === 1 && currentForC[0].ipAddress === "123.123.123.x") {
      console.log("✅ Shared IP correctly isolated current device by familyId.");
    } else {
      throw new Error("Failed Shared IP handling.");
    }

    console.log("\\n--- Testing Remote Mobile Revocation ---");
    // Device A revokes Device B
    const revokeRes = await revokeSession(authA.accessToken, sessBForA.id, "mobile");
    if (revokeRes.ok) {
      console.log("✅ Device A successfully revoked Device B's session.");
    } else {
      throw new Error("Device A failed to revoke Device B.");
    }

    // Device B attempts to get sessions
    try {
      await getSessions(authB.accessToken);
      throw new Error("Device B was able to fetch sessions after being revoked!");
    } catch (err) {
      if (err.message.includes("401") || err.message.includes("Session expired") || err.message.includes("Session revoked")) {
        console.log("✅ Device B correctly blocked from API after revocation.");
      } else {
        throw new Error("Device B failed with unexpected error: " + err.message);
      }
    }

    console.log("\\n--- Testing Cross-User Protection ---");
    const authUserB = await loginMobile(userB.email, "8.8.8.8", "UserBDevice");
    let sessionsUserB = await getSessions(authUserB.accessToken);
    const targetSessionId = sessionsUserB.find(s => s.is_current).id;

    // User A tries to revoke User B's session
    const crossRevokeRes = await revokeSession(authA.accessToken, targetSessionId, "mobile");
    if (crossRevokeRes.status === 404) {
      console.log("✅ User A correctly blocked (404) from revoking User B's session.");
    } else {
      throw new Error("Cross-user revocation did not fail with 404 as expected.");
    }
    
    console.log("\\n--- Testing GeoIP Edge Cases ---");
    const authPrivate = await loginMobile(userA.email, "192.168.1.100", "PrivateIPDevice");
    let sessionsPriv = await getSessions(authPrivate.accessToken);
    const privSess = sessionsPriv.find(s => s.is_current);
    if (privSess.location === "Unknown Location") {
      console.log("✅ Private IP correctly mapped to Unknown Location.");
    } else {
      throw new Error("Private IP did not map to Unknown Location.");
    }
    
    const authPublic = await loginMobile(userA.email, "8.8.8.8", "PublicIPDevice");
    let sessionsPub = await getSessions(authPublic.accessToken);
    const pubSess = sessionsPub.find(s => s.is_current);
    if (pubSess.location && pubSess.location !== "Unknown Location") {
      console.log(`✅ Public IP mapped correctly: ${pubSess.location}`);
    } else {
      throw new Error("Public IP failed GeoIP mapping.");
    }

    console.log("\\nAll API Acceptance Tests Passed!");
    process.exit(0);
  } catch (error) {
    console.error("Test Failed:");
    console.error(error);
    process.exit(1);
  }
}

runTests();
