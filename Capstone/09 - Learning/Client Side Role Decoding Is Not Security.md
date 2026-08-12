---
type: learning
tags: [learning, security, mobile, auth]
source:
  - mobile/lib/rbac.js
  - src/lib/api/utils.js
last_verified: 2026-08-11
---

# Concept: Client Side Role Decoding Is Not Security

## What it is

A JWT is **signed, not encrypted**. Any client can base64-decode the payload and read the claims — that's by design. What a client cannot do is *forge* one, because it lacks the signing key.

So decoding a token client-side to read `role` is fine and useful. Trusting that value for anything that matters is not, because the client controls what it decodes.

## Why it matters

The distinction is between **UI affordance** and **authorisation**.

- Hiding a button the user can't use: a UX decision. Client-side is correct — it's the only place it can happen.
- Deciding whether an operation is permitted: an authorisation decision. Must be server-side, every time, because the button was never the control.

An attacker doesn't click your hidden button. They call your endpoint.

## How it appears in my project — CONFIRMED

`mobile/lib/rbac.js` decodes the access token to read claims for navigation and screen gating. Its docstring draws the line:

> *"signature verification stays server-side, so this is for reading claims, not trusting them."*

The real check is `requireDriver(req)` in `src/lib/api/utils.js`, which verifies the signature, confirms the `driver` role, and guarantees a `driverId`. The mobile app deciding to show the Trips tab has no bearing on whether `/api/trips` returns anything. → [[Authentication]] · [[RBAC]]

## The mental model

```
Client:  decode → decide what to render        (convenience, tamperable)
Server:  verify signature → decide what to do  (authority)
```

Anything the server would refuse should still be refused if the client is a `curl` command with a hand-edited token. **Assume it is.**

## Where the guarantee actually comes from

Two things make the mobile side safe, and neither is in the mobile app:

1. **Signature verification** on every request — `jose` HS256 against the server secret
2. **The audience split** — a refresh token can't be used as an access token → [[Token Rotation And Refresh Races]]

The app's decode step contributes nothing to either. That's the point: it's allowed to be wrong.

## Common mistakes

| Mistake | Consequence |
|---|---|
| `jwt.decode()` where `jwt.verify()` was needed | Accepts unsigned/forged tokens — server-side, this is critical |
| Trusting a role claim to skip a server check | Trivial privilege escalation |
| Putting secrets in JWT claims | Payload is readable by anyone holding the token |
| "It's only in the app, nobody will see it" | Bundles are extractable; traffic is proxyable |
| Server trusting a client-sent `role` field | Same bug, more obvious |

## Related concepts

[[Mobile Architecture]] · [[Token Rotation And Refresh Races]] · [[Why RLS Is Not A Boundary]] · [[Fail Closed By Default]] · [[RBAC]] · [[Learning Dashboard]]
