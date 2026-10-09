---
type: database-table
status: working
tags: [database, storage, documents, privacy]
source:
  - supabase/migrations/157_document_upload_drafts.sql
  - src/lib/uploads/document-storage.js
  - src/app/api/document-uploads
last_verified: 2026-10-09
related: ["[[Driver Management]]", "[[Fleet And Vehicles]]", "[[Migrations]]"]
---

# document_uploads

Private ledger for immediately uploaded files awaiting driver/vehicle Save. UUID identifies the upload; employee owner FK and resource/kind/bucket constraints separate license front/back from OR/CR/Insurance. Other columns record target/attached record, object key, display filename, MIME, size, SHA-256, state and timestamps. UI metadata excludes owner/key/hash; audit values exclude storage references and document contents.

Lifecycle: `uploading` -> `ready` -> `attached`, or `cancelled` -> `deleted`. The API registers the row before writing storage; UUID replay must match owner/kind/target/hash. Ready drafts expire after 24 hours. Binding locks the row within the record/audit transaction and verifies ownership, context, reference, readiness and expiry. Attached files are never selected by draft cleanup.

Explicit cancellation attempts immediate object removal, retaining the cancelled row until expiry to catch late writes. The existing scheduled sync locks expired uncommitted rows with `SKIP LOCKED`, removes at most ten objects and marks expired rows deleted only after storage succeeds. Failed removals remain retryable. Production scheduler execution was not independently verified.

RLS is enabled and all anon/authenticated privileges revoked. Server routes enforce permissions/ownership through the privileged connection. Both buckets are private; driver files are JPG/PNG 5MB, vehicle files JPG/PNG/PDF 10MB with server signature checks. Authorized readers receive one-hour signed previews; canonical keys are persisted.

Live proof: migration 157 applied with the runner and schema refreshed. All 80 relations passed the live contract; the anon HTTP probe explicitly refused this table. Its 48 older empty results are externally inconclusive and resolved by the paired catalog contract. Both buckets were private; ledger anon SELECT/TRUNCATE and authenticated SELECT were denied. Synthetic browser QA left four cancelled rows and zero matching storage objects; tombstones intentionally remain until expiry.
