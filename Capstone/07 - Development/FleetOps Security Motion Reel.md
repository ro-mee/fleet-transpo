# FleetOps Security Motion Reel & Complete Architecture Film

**Document Type:** Technical Security Architecture & Defense Presentation Artifact  
**Date:** 2026-10-02  
**Status:** Implemented & Verified  
**Video Artifact:** [`fleetops-security.mp4`](file:///c:/Users/lenovo/OneDrive/Desktop/capstone/fleetops-security.mp4) (1920×1080, 30 fps, 503.3s / 8.39 min, 15,099 frames, H.264 / AAC 192kbps 48kHz stereo, Neural Commercial Voiceover `en-US-AndrewNeural`, Dual-Buffer Cross-Dissolves, Staggered Card Entrance Motion, 100% Custom 2px Vector SVG Icons, Zero Emojis)  
**Poster Artifact:** [`fleetops-security-poster.jpg`](file:///c:/Users/lenovo/OneDrive/Desktop/capstone/fleetops-security-poster.jpg) (1920×1080)  
**Architecture Source Code:** [`motion/security/`](file:///c:/Users/lenovo/OneDrive/Desktop/capstone/motion/security/)  

---

## 1. Executive Summary & Purpose

The **FleetOps Security Motion Reel: "From Identity to Audit"** is an authoritative, cinematic motion-design film demonstrating the complete end-to-end security architecture of the FleetOps Fleet & Logistics Management System.

Unlike generic cybersecurity presentations, this production strictly models the **real, verifiable security controls in the FleetOps codebase**:
- Controlled administrator user provisioning with high-entropy 16-character temporary credentials and transaction rollback on undelivered invitations.
- Edge proxy ingress (`src/proxy.js`) enforcing same-origin CORS, 600 req/min/IP rate limiting, and transport security headers (HSTS, CSP, X-Frame-Options).
- Server-side bcrypt password verification with 72-byte truncation defense, database-backed account lockout (10 failed attempts $\to$ 15-minute freeze), and timing-safe anti-enumeration responses.
- Mandatory email OTP challenges (6-digit, 5-minute TTL, SHA-256 digest at rest, 3 attempts per challenge, 3 burned challenges $\to$ 15-minute lockout) with a 7-day cryptographically signed workstation bypass cookie (`__Host-fleetops-trusted-device`).
- Decoupled web and mobile session architecture: database-backed NextAuth web sessions (5-minute idle, 12-hour ceiling) vs mobile dual HS256 JWTs (15-minute access, 30-day single-use rotating refresh token with family revocation upon replay).
- Authoritative live identity revalidation (`resolveIdentity(req)`) against PostgreSQL on every protected API call, instantly applying database role demotions and rejecting suspended accounts.
- Centralized 6-role permission matrix (`src/lib/auth/permissions.js`), enforcing a fail-closed perimeter that isolates the driver role from staff endpoints.
- Driver row ownership scoping (`assertTripOwnership`) returning `404 Not Found` (instead of `403 Forbidden`) to completely conceal foreign operational existence against IDOR probes.
- Clear separation between the application connection pool (`DATABASE_URL`, bypassing RLS as owner) and the PostgreSQL RLS surface (`REVOKE ALL PRIVILEGES FROM anon, authenticated`) that seals the public PostgREST / anon-key boundary.
- Sensitive data masking (driver licenses masked by default as `N01-**-****91`) paired with mandatory transactional audit locks (`writeAuditRequired(tx)`).
- Durable, structured audit trails (`audit_logs`) sanitizing credentials through a `BLOCKED_KEY` regex sieve and capped at 1 KiB per JSON payload.
- 90-day device fingerprint detection alerting operators across in-app, mobile push, and verified email without false-positive IP geolocation dependencies.
- Interactive web console idle heartbeat monitor and instant global session invalidation via `security_version` increments.
- Defense-in-depth credential recovery and audited break-glass MFA bypass codes that never override active brute-force freezes.
- Continuous executable verification gates: `verify:auth` (294 routes), `db:contract`, `verify:anon`, and `db:check` (140 migrations).

---

## 2. Motion Design & Technical Architecture

1. **Zero Emojis Everywhere**:
   - Zero unicode emojis are used. All indicators and status badges utilize custom 2px stroke SVG vector glyphs from [`motion/security/src/icons.js`](file:///c:/Users/lenovo/OneDrive/Desktop/capstone/motion/security/src/icons.js) (`shieldCheck`, `shieldAlert`, `lock`, `unlock`, `key`, `database`, `server`, `terminal`, `mail`, `smartphone`, `monitor`, `clock`, `alertTriangle`, etc.).
2. **Phrase-Synced Subtitle Engine**:
   - Subtitles are broken into concise **3–8 word phrases** synchronized to narration speech pauses via FFmpeg `silencedetect`. Subtitles smoothly ease in when spoken and fade out during natural pauses.
3. **Dual-Buffer Cross-Dissolves & Staggered Card Physics**:
   - Two staging buffers (`#stage-prev` and `#stage-curr`) execute a 0.55s easeInOutCubic cross-dissolve with staggered card glide physics (`getCardGlide(localTime, delay, duration)`), eliminating all abrupt pop-ins.
4. **4-Worker Headless Rendering Engine**:
   - Uses Puppeteer-Core connected to official Microsoft Edge, capturing 1920×1080 JPEG frames piped directly into Gyan FFmpeg 9.0.2 (`-c:v libx264 -preset fast -crf 20`).
5. **Broadcast Mastered Audio**:
   - Neural commercial voiceover (`en-US-AndrewNeural`, `-3%` rate, 115–125 WPM) combined with procedural tech ambient synthesizer soundbed and synchronized acoustic UI cues.
   - Mastered to EBU R128 broadcast loudness standards (`-16.0 dB` mean volume, `-1.5 dB` true peak).

---

## 3. 17-Chapter Technical Storyboard

| Chapter | Title | Architectural Boundaries & Codebase Components |
|---|---|---|
| **01** | System Lifecycle | 12-stage continuous control flow: `PROVISION` $\to$ `INGRESS` $\to$ `PASSWORD` $\to$ `VERIFY` $\to$ `SESSION` $\to$ `IDENTITY` $\to$ `AUTHORIZE` $\to$ `SCOPE` $\to$ `EXECUTE` $\to$ `AUDIT` $\to$ `DETECT` $\to$ `REVOKE`. |
| **02** | Account Provisioning | Admin user creation API, role authority validation, 16-char high-entropy temporary credential, bcrypt hash in `employees`, SMTP delivery; rollback on delivery failure. |
| **03** | Edge Ingress | `src/proxy.js` edge middleware: CORS allowlist, security headers (HSTS, CSP, X-Frame-Options), 600 req/min/IP rate limit; untrusted origin $\to$ 403 Forbidden. Note: edge is not auth. |
| **04** | Password Verification | Server-side bcrypt comparison, 72-byte max password; database-backed account lockout: 10 consecutive failures $\to$ 15 min lock; timing-safe identical failure responses prevent user enumeration. |
| **05** | Email OTP Challenge | Mandatory 2FA: 6-digit OTP, 5 min TTL, SHA-256 digest stored; 3 attempts per challenge, 3 challenges $\to$ 15m lockout; trusted workstation cookie bypass `__Host-fleetops-trusted-device` for 7 days. |
| **06** | Session Architecture | Web NextAuth session cookie + `web_sessions` table (5m idle / 12h absolute timeout); Mobile separate HS256 JWTs: 15m access token `fleetops-mobile-access`, 30d rotating refresh token `fleetops-mobile-refresh` hashed at rest; token replay attack revokes entire family. |
| **07** | Live Identity Revalidation | `resolveIdentity(req)` revalidates live employee record from PostgreSQL on every request; demotions/role changes take effect immediately; suspended accounts or bumped `security_version` instantly return 401. |
| **08** | RBAC Permission Gate | 6 canonical roles: `super_admin`, `admin`, `fleet_manager`, `dispatcher`, `driver`, `management`; centralized permission matrix `permissions.js`; dispatcher/fleet_manager write trips, management read-only, driver excluded from staff APIs. |
| **09** | Ownership & IDOR Defense | Driver row ownership: `assertTripOwnership`, `assertDispatchOwnership`, `resolveDriverScope`; probing another driver's trip returns 404 Not Found to conceal operational existence. |
| **10** | Boundary Separation | `getPool()` / `DATABASE_URL` connects as owner for application route guards and parameterized queries; PostgreSQL RLS and `REVOKE ALL` protect public PostgREST / anon key surface. |
| **11** | Sensitive Data & Audit Lock | Driver license masked by default `N01-**-****91`; full reveal requires `drivers:update` permission and mandatory transactional audit write `writeAuditRequired(tx)`. |
| **12** | Audit Evidence & Redaction | Structured immutable audit logs: actor, action, resource, IP/network, outcome; `BLOCKED_KEY` regex sanitizes passwords, OTPs, tokens; 1 KiB payload cap. |
| **13** | Anomaly Detection | Login history checked over 90 days; new browser family + OS detected before writing `login_success`; tri-channel alert: in-app, mobile push, email; no false-positive IP geo. |
| **14** | Session Revocation | Interactive idle monitor in web console, throttled DB heartbeat; warning modal before termination; instant cross-platform revocation via `security_version` bump or account status change. |
| **15** | Recovery & Break-Glass | Self-service password recovery: 30-minute single-use token, kills existing sessions; admin emergency break-glass code for MFA lockout, audited; active brute-force freeze cannot be overridden. |
| **16** | Verification Gates | Executable contract gates: `npm run verify:auth` with 294 routes, `npm run db:contract` for live catalog & RLS, `npm run verify:anon` probing anon key, `npm run db:check` verifying 140 migration ledgers. |
| **17** | Architecture Recap | Complete security workflow topology connecting identity provisioning, ingress filtering, cryptographic verification, live database revalidation, and instant revocation. |

---

## 4. Verification & Artifact Distribution

1. **Video Production Output**:
   - `fleetops-security.mp4` (1080p Full HD, 30 fps, 8.39 min).
   - `fleetops-security-poster.jpg` (Full HD poster image).
2. **Automated Cloud Upload & Email Dispatch**:
   - Hosted at cloud endpoint: `https://tmpfiles.org/` with direct download link.
   - HTML notification email dispatched via Nodemailer over Gmail SMTP (`kityanz09@gmail.com`) with embedded poster frame and chapter syllabus.
3. **Repository Status**:
   - Output video binaries and `motion/` artifacts remain strictly git-ignored, keeping git status pristine.
