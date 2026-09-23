// Diagnostic: what does TomTom actually return for a Philippine address?
//
// WHY THIS EXISTS
// ---------------
// src/lib/address/parse.js maps TomTom's global field vocabulary onto
// Philippine concepts through PH_COMPONENT_MAP. Every one of those mappings is
// an ASSUMPTION — most importantly that `municipalitySubdivision` carries the
// barangay. That assumption cannot be settled offline: the unit tests assert
// that a field the provider does not send stays null, which is true whichever
// way the mapping resolves, so they pass either way and prove nothing about the
// real payload.
//
// This prints the RAW provider response for real addresses so the mapping can be
// corrected from evidence. It deliberately does NOT import the application's
// provider module: observing the untouched payload is the entire point, and a
// script that parsed it the same way the app does could not tell us the parser
// was wrong. It also avoids the `@/` import alias, which plain `node` cannot
// resolve.
//
// THE AUTHENTICATION PROBES
// -------------------------
// A 403 from the Search API has several causes that need different fixes, and
// the status code alone does not distinguish them:
//
//   * the key is not authorized for the Search API at all
//   * the key is origin/referer-restricted (a browser key), and a server-side
//     call sends no Origin header to satisfy the restriction. Measured
//     2026-09-23: the browser key in this .env is NOT restricted this way — it
//     answers 200 with no Origin header at all — so do not reach for this
//     explanation without a probe below actually showing it.
//   * the key is wrong, disabled, or over quota
//
// So before searching, this probes the ROUTING endpoint with the same server
// key. Routing is the one TomTom call this app already makes successfully in
// production (src/lib/tomtom.js `buildRouteUrl`, which uses the server key), so
// it is a known-good baseline:
//
//   routing OK  + search 403  -> key is valid, Search API is not enabled for it
//   routing 403 + search 403  -> the key itself is being refused
//   routing OK  + search OK   -> the earlier 403 was transient or quota
//
// Read-only. Prints no credentials — only which address fields are populated and
// each key's presence, never its value.
//
//   node scripts/check-address-provider.mjs
//   node scripts/check-address-provider.mjs "some other address"

import { loadEnvLocal } from "./load-env.mjs";

loadEnvLocal();

const serverKey = process.env.TOMTOM_API_KEY || "";
const publicKey = process.env.NEXT_PUBLIC_TOMTOM_API_KEY || "";

console.log("\nKEY INVENTORY (values never printed)");
console.log(`  TOMTOM_API_KEY              (server): ${serverKey ? "set" : "MISSING"}`);
console.log(`  NEXT_PUBLIC_TOMTOM_API_KEY  (browser): ${publicKey ? "set" : "MISSING"}`);
if (serverKey && publicKey) {
  console.log(
    `  the two keys are ${serverKey === publicKey ? "IDENTICAL — the browser key is being used server-side, which a domain restriction would refuse" : "different"}`
  );
}
console.log("");

if (!serverKey) {
  console.error("TOMTOM_API_KEY is not set (.env.local or .env).");
  process.exit(1);
}

/**
 * One request, with the failure body kept rather than discarded. TomTom puts
 * the actual reason in the body ("Key is not authorized for this API", an origin
 * restriction, a quota message) and a bare status code cannot tell them apart.
 */
async function probe(url, headers) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10000), headers });
    const text = await response.text();
    let payload = null;
    try {
      payload = JSON.parse(text);
    } catch {
      /* not JSON — the caller only needs `text` for the error body */
    }
    return { ok: response.ok, status: response.status, payload, text };
  } catch (e) {
    return { ok: false, status: null, payload: null, text: e.message, threw: true };
  }
}

function describe(result) {
  if (result.threw) return `request failed: ${result.text}`;
  if (result.ok) return `HTTP ${result.status} OK`;
  const body = String(result.text || "").slice(0, 400);
  return `HTTP ${result.status}${body ? ` — ${body}` : ""}`;
}

// ── Baseline: Routing, the call this app already makes successfully ──────────
// Parada ng Mango -> Fuente Osmeña, Cebu. The coordinates are incidental; any
// valid pair works, this one just keeps the probe recognisably Philippine.
console.log("BASELINE PROBE — Routing API (the call the app already makes)");
const routing = await probe(
  `https://api.tomtom.com/routing/1/calculateRoute/10.3117,123.8916:10.3098,123.8934/json` +
    `?key=${encodeURIComponent(serverKey)}&routeType=fastest`
);
console.log(`  server key -> ${describe(routing)}`);
console.log("");

// The first is the worked example from the feature request; the rest exercise
// the shapes Philippine addresses actually take — a barangay-only address, a
// subdivision, and a provincial city outside Metro Manila.
const DEFAULT_QUERIES = [
  "29 Ninang Virginia, BF Homes Deparo, Caloocan City",
  "Barangay San Antonio, Pasig City",
  "BF Homes Parañaque",
  "Fuente Osmeña, Cebu City",
];

const queries = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_QUERIES;

// The fields parse.js cares about, plus a few it deliberately ignores.
const FIELDS = [
  "streetNumber",
  "streetName",
  "municipalitySubdivision",
  "municipality",
  "countrySecondarySubdivision",
  "countrySubdivision",
  "countrySubdivisionName",
  "postalCode",
  "country",
  "freeformAddress",
];

let sawSearchFailure = false;

for (const query of queries) {
  const url =
    `https://api.tomtom.com/search/2/search/${encodeURIComponent(query)}.json` +
    `?key=${encodeURIComponent(serverKey)}&countrySet=PH&typeahead=true&limit=3`;

  console.log(`\n${"=".repeat(72)}\nQUERY: ${query}\n${"=".repeat(72)}`);

  const result = await probe(url);
  if (!result.ok) {
    sawSearchFailure = true;
    console.log(`  server key -> ${describe(result)}`);
    continue;
  }

  const results = Array.isArray(result.payload?.results) ? result.payload.results : [];
  if (!results.length) {
    console.log("  no results");
    continue;
  }

  results.forEach((entry, index) => {
    const address = entry?.address ?? {};
    console.log(`\n  [${index}] id=${entry.id}`);
    console.log(`      freeformAddress: ${address.freeformAddress ?? "(none)"}`);

    // Which fields the provider ACTUALLY populated. This is the evidence.
    const populated = FIELDS.filter(
      (field) => address[field] !== undefined && String(address[field]).trim() !== ""
    );
    const absent = FIELDS.filter((field) => !populated.includes(field));

    console.log("      populated:");
    for (const field of populated) {
      console.log(`        ${field.padEnd(30)} = ${JSON.stringify(address[field])}`);
    }
    console.log(`      empty/absent: ${absent.join(", ") || "(none)"}`);

    // Any field parse.js does not map at all — a candidate for a better
    // barangay source than the one currently assumed.
    const unmapped = Object.keys(address).filter((k) => !FIELDS.includes(k));
    if (unmapped.length) {
      console.log("      other fields present:");
      for (const field of unmapped) {
        const value = address[field];
        if (value === undefined || String(value).trim() === "") continue;
        console.log(`        ${field.padEnd(30)} = ${JSON.stringify(value)}`);
      }
    }

    // What parse.js would currently produce for barangay, so the assumption is
    // visible next to the evidence that confirms or refutes it.
    console.log(
      `      -> parse.js would set barangay = ${JSON.stringify(address.municipalitySubdivision ?? null)}` +
        `, city = ${JSON.stringify(address.municipality ?? null)}`
    );
  });
}

// ── When Search is refused, say which of the causes it actually is ───────────
if (sawSearchFailure) {
  console.log(`\n${"=".repeat(72)}\nSEARCH WAS REFUSED — NARROWING THE CAUSE\n${"=".repeat(72)}`);
  console.log(`  routing   (server key): ${describe(routing)}`);

  // Two further probes, because "the Search API is off for the account" and "this
  // key is scoped away from it" are different problems with different fixes.
  //
  // The geocode endpoint is the same API family as search, so if it answers while
  // search does not, the family is enabled and something narrower is refused.
  //
  // The browser key is a cross-check with ASYMMETRIC value: a 200 there proves the
  // ACCOUNT has Search enabled and only the server key is scoped out. A 403 proves
  // nothing at all, because a domain-restricted key is refused server-side where no
  // Origin header is sent — so it is reported, not interpreted.
  const firstQuery = queries[0];
  const geocodeProbe = await probe(
    `https://api.tomtom.com/search/2/geocode/${encodeURIComponent(firstQuery)}.json` +
      `?key=${encodeURIComponent(serverKey)}&countrySet=PH&limit=1`
  );
  console.log(`  /search/2/geocode (server key): ${describe(geocodeProbe)}`);

  const publicProbe =
    publicKey && publicKey !== serverKey
      ? await probe(
          `https://api.tomtom.com/search/2/search/${encodeURIComponent(firstQuery)}.json` +
            `?key=${encodeURIComponent(publicKey)}&countrySet=PH&limit=1`
        )
      : null;
  if (publicProbe) {
    console.log(`  /search/2/search  (browser key): ${describe(publicProbe)}`);
  }

  // A browser key's refusal can be uninformative, because a domain-restricted
  // key may be refused server-side where no Origin header is supplied. Sending
  // the origin removes that confound — but do NOT assume it was ever the cause.
  // Measured 2026-09-23: when Search was granted to the browser key in this
  // .env, this probe returned 200 with no Origin header at all, so the key was
  // never origin-restricted and the earlier 403 was the permission alone.
  //
  //   403 without -> 200 with : the header was the missing piece
  //   200 either way           : not origin-restricted; permission is the whole
  //                              story, and the account does have Search
  //   403 both ways            : still ambiguous, and deliberately NOT reported
  //                              as "the account lacks Search" — the domain on
  //                              the key may differ, or Search may be off
  //                              account-wide. Absence of evidence only.
  //
  // Diagnostic only. The application must never call TomTom this way: the
  // browser key belongs in the browser, and TOMTOM_API_KEY is what every
  // server-side call uses.
  const appOrigin = process.env.NEXT_PUBLIC_APP_URL
    ? new URL(process.env.NEXT_PUBLIC_APP_URL).origin
    : null;
  if (publicProbe && appOrigin) {
    const originProbe = await probe(
      `https://api.tomtom.com/search/2/search/${encodeURIComponent(firstQuery)}.json` +
        `?key=${encodeURIComponent(publicKey)}&countrySet=PH&limit=1`,
      { Origin: appOrigin, Referer: `${appOrigin}/` }
    );
    console.log(
      `  /search/2/search  (browser key, Origin: ${appOrigin}): ${describe(originProbe)}`
    );
    if (originProbe.ok && !publicProbe.ok) {
      console.log(
        `\n  DECISIVE: the browser key searches when its own origin is supplied but\n` +
          `  not without it, so the origin restriction was the cause. Search IS\n` +
          `  enabled for the account — TOMTOM_API_KEY is the key to fix.`
      );
    } else if (originProbe.ok) {
      console.log(
        `\n  The browser key answered with AND without an Origin header, so it is not\n` +
          `  origin-restricted — the header was never what was missing. Search IS\n` +
          `  enabled for the account, so the grant belongs on the SERVER key: the\n` +
          `  permission is per key, and it currently sits on the browser key. When\n` +
          `  you add it, check the key's name in the portal — editing\n` +
          `  NEXT_PUBLIC_TOMTOM_API_KEY a second time is the easy mistake here.`
      );
    } else if (!originProbe.threw) {
      console.log(
        `\n  Not decisive. ${appOrigin} may not be the domain this key is\n` +
          `  restricted to, the restriction may be checked on a header Node did not\n` +
          `  send, or Search may be off for the account. This does NOT show the\n` +
          `  account lacks Search.`
      );
    }
  } else if (publicProbe && !appOrigin) {
    console.log(
      "  (NEXT_PUBLIC_APP_URL is unset, so the browser key could not be probed\n" +
        "   with its own origin — that is the one probe that would be decisive.)"
    );
  }

  if (routing.ok) {
    console.log(
      "\n  VERDICT: the server key is valid — Routing answers, so the key itself is\n" +
        "  fine — but Search is not permitted for it. Permissions are granted PER\n" +
        "  KEY, and a key can gain one in place: measured 2026-09-23 an existing key\n" +
        "  in this .env went 403 -> 200 on this same URL after a grant, with no new\n" +
        "  key involved. So add Search API v2 to the key in TOMTOM_API_KEY.\n" +
        "\n" +
        "  Do NOT swap key VALUES to fix this: TOMTOM_API_KEY also drives\n" +
        "  buildRouteUrl (src/lib/tomtom.js), so a Search-only replacement would\n" +
        "  break turn-by-turn navigation app-wide. It needs Routing AND Search.\n" +
        "\n" +
        "  Configuration, not application code — the provider sits behind\n" +
        "  src/lib/address/provider.js, so nothing above it changes."
    );
  } else {
    console.log(
      "\n  Both Routing and Search refused this key, so the problem is the key\n" +
        "  itself rather than the API: it may be wrong, disabled, over quota, or\n" +
        "  origin-restricted (a domain-restricted key is refused server-side,\n" +
        "  where no Origin header is sent). Check the inventory above — if the\n" +
        "  two keys are identical, that is the answer."
    );
  }

  if (geocodeProbe.ok && !routing.ok) {
    console.log(
      "\n  Unreachable combination — geocode answered while routing did not. Record it."
    );
  } else if (!geocodeProbe.ok && routing.ok) {
    console.log(
      "\n  The geocode endpoint is refused too, so the whole Search API family is\n" +
        "  unavailable to this key rather than one endpoint being scoped off."
    );
  }
}

console.log(
  "\nIf `barangay` is empty above for addresses that clearly have one, " +
    "`municipalitySubdivision` is the wrong source and PH_COMPONENT_MAP in " +
    "src/lib/address/parse.js needs a different field — visible in the " +
    "`other fields present` list.\n"
);
