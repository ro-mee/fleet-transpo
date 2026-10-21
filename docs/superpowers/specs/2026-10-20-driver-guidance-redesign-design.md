# Driver Guidance Redesign: Passenger and Cargo

Date: 2026-10-20. Status: design for the owner-requested implementation plan; application behavior is unchanged.

## 1. Purpose and decisions

Help a driver complete a real task correctly, understand its consequences, and recover from a problem without needing another person to explain the app. The owner accepted the contextual/interactive direction and requested especially useful, well-explained details for hotel Passenger and Cargo. This document makes that direction concrete; it does not authorize deployment, cargo activation or business-data changes.

Use incremental section guides with optional practice through shared production components. A cosmetic tooltip refresh would leave the forced navigation and Passenger-only Map practice intact. A complete replacement engine before delivering a working section would increase migration risk. Preserve useful overlay measurement, safe-area, accessibility and session protections while removing their dependence on the forced tour.

Keep common guidance and distinct Passenger/Cargo workflows in one registry. The current driver workspace resolver and saved trip classification determine relevant operational content. An unknown/mismatched classification explains the assignment problem; it must not default to Passenger. Explicit sample selection changes only the sample session and never a driver's specialization.

## 2. Three forms of help

| Form | What the driver sees | Operational behavior |
|---|---|---|
| Contextual tip | One short explanation beside an actual available control | Explains real work. Does not auto-press, submit, fill, navigate or require a mutation to finish a guide. |
| More details | A small disclosure/sheet using existing native Clay patterns | Explains why, what happens next, blockers and recovery. Available again from Help. |
| Optional practice | Same production visual components with fictional sample state; persistent Practice mode label and Exit practice | Only in-memory sample changes. No operational submissions, upload, queue, autosave, dialing, GPS posting or external navigation. |

Contextual tips can say Next, Got it, More details and Not now. Real controls retain their actual labels and handlers. Successful real interaction may advance a tip after the screen reports its outcome, but reading/dismissing a guide never requires starting a trip or submitting a report. An explanation must not instruct a tap while the spotlight intercepts it. For hazardous actions, explain first and dismiss before returning the genuine control to the driver.

Practice requires explicit selection and a safely parked confirmation. It never starts from Welcome, a URL flag, or arrival at a real stage. The practice host composes extracted production views; it does not copy their layout or create imitation controls. There is no Driver Academy, reward system, exam, separate tutorial dashboard or completion percentage.

## 3. Driver writing standard

Every guide must answer five questions in plain English:

1. What am I looking at?
2. What should I do now?
3. Why does this matter?
4. What will happen after I do it?
5. If I cannot continue, what should I do instead?

Keep the first visible body to one or two short sentences, normally 20-45 words. Titles normally use 3-7 words. These are readability targets, not reasons to remove a safety consequence. Put the fuller explanation in More details, normally 60-120 words with short paragraphs or up to four steps. Never shrink text or truncate an essential rule to satisfy a word count. Split a genuinely longer workflow into separate decision steps.

Lead with the driver's next action. Use the exact visible action label. Say "Dispatch has not confirmed receipt" rather than promising that help is on its way. Say "Saved on this device" when that is all the system knows. Explain Fleet as "your fleet team" on first use. Keep internal IDs, schema fields, provider names, HTTP codes and database language out of the driver's text. Never invent an approval time, operational phone number, load limit, policy threshold or safety clearance.

Dynamic details must come from confirmed production state: checklist count, scheduled opening time, displayed units, actual status and assigned vehicle. Preserve missing/unknown values rather than inventing defaults. Times use the existing Manila/local display convention and an explicit date when necessary. The initial release uses English; do not add an unreviewed translation system.

## 4. Required content catalogue

The following bodies and details are the proposed baseline copy for the agreed direction. Bind quoted button names to the current production labels during implementation. If the label or contract differs, correct both the guide and the corresponding documentation instead of adding a tutorial-only button.

### Welcome and Home - common

Trigger: once after authenticated Home is ready. One compact Welcome; no chained guides.

**Body:** "FleetOps will explain important steps as you need them. You can skip tips and reopen a guide from Help & Support."

**Details:** "Your Home screen shows your current duty, assigned vehicle and trips. Check that these match the work Dispatch gave you. If your vehicle or assignment is missing or incorrect, refresh and contact Dispatch before starting work. A tutorial does not assign a vehicle or make you ready for a trip."

Do not introduce a tour of every Home card. Duty entry tips appear only when those actions are relevant.

### Start your shift - common

Trigger: first eligible Pre-Shift entry while the baseline is outstanding.

**Body:** "Check the actual vehicle before starting your shift. This daily check does not replace the quick inspection required for each trip."

**Details:** "Choose PASS only after checking the item. Choose FAIL when there is a problem and describe what you found. Do not mark everything PASS to get through the form. A reported safety problem may block work and require the fleet team's review. Complete all required answers; follow the result shown after submission."

Practice: optional sample PASS/FAIL and required remarks using the same checklist. Sample actions never check in, ground a vehicle or submit an inspection. No Quick Pass All shortcut.

### Quick Pre-Trip - Passenger / Cargo

Trigger: first entry into the relevant real trip's quick check. Keep daily and trip inspection progress separate.

**Passenger body:** "Inspect this trip's vehicle and answer the cabin and passenger-item checks honestly. A passed daily shift check does not clear this trip."

**Cargo body:** "Check the vehicle and secure the load for this trip. An unsecured load must be reported; do not mark it safe to unlock departure."

**Details:** "This check belongs to the trip shown here. Answer each required item and explain any failure. Use the existing lost-item or problem path when the screen requires it. Cargo securement here does not replace the separate post-load securement and departure review at pickup. Wait for the actual result; a completed tutorial is not a passed inspection."

### Assignment and readiness - Passenger / Cargo

Trigger: first genuinely actionable owned assignment; mismatches receive an explanation, not a progression guide.

**Body:** "Check the pickup, destination, schedule and assigned vehicle. Starting the route is available only when the trip's required checks and start window allow it."

**Details:** "Refresh if the assignment looks old or the expected action is missing. If the start window has not opened, wait until the time shown. If the vehicle, driver type or job does not match, contact Dispatch. For Cargo, Start Trip begins travel to pickup; it does not confirm that goods have been collected. Follow each blocker shown by the app instead of repeating Start."

Practice: sample readiness blocker and recovery explanation; never fake a change in a real start window.

### Starting odometer - common, capability-aware

Trigger: first real start-photo screen when that trip requires it.

**Body:** "Photograph the dashboard's total distance in kilometres. Check the detected reading before confirming; confirmation saves this evidence and starts the route."

**Details:** "Keep the full odometer clear and avoid glare. Use the total distance, not Trip A or Trip B. Retake the photo if digits are unclear or the reading is wrong. This photo workflow does not allow typing a replacement or substituting GPS distance. If the display is unsupported or repeated retakes fail, stop and contact your fleet team. Keep the app online while confirming, and follow the saved result before trying again."

If photo capture is not required, explain only the actual legacy controls visible on that trip. Do not claim all deployments require photos.

### Map controls and route information - common

Trigger: intentional Map entry while safely stationary and targets are visible. Separate standby and active-trip variants.

**Body:** "Use the visible map controls to inspect the route and return to your location. Read the trip status before using the action at the bottom."

**Details:** "The route and arrival estimate help you plan; they are not proof that a pickup or delivery is complete. Location permission, GPS quality and connection can affect what is shown. If location is unavailable, follow the screen's permission or retry instructions. Only explain Layers, route choices or other controls when they actually exist in this view. With no trip, this screen is standby; it does not mean an assignment is active."

Explain navigation handoff only when the existing control is present. Practice never launches an external navigation app or starts background tracking.

### Passenger pickup - hotel Passenger

Trigger: the real pickup stage, while safely stationary. Optional practice uses a fictional guest.

**Body:** "Confirm arrival when you reach the assigned pickup. Confirm the guest is picked up only after the correct guest is safely onboard."

**Details:** "Check the assignment's guest and pickup details using your hotel's existing procedure. Reaching the map point does not mean the guest is onboard. If the guest is absent, the location is wrong or the assignment changed, contact Dispatch and keep the trip status truthful. If GPS prevents arrival confirmation, follow the actual app's retry or authorized exception path; the tutorial cannot bypass it."

### Passenger destination and drop-off - hotel Passenger

**Body:** "Confirm the destination stage after arriving. Mark the guest dropped off only after they have safely left the vehicle at the correct destination."

**Details:** "Do not complete the trip just because the route line ends. Check that the guest handoff is complete, then follow the actual remaining trip action and ending-odometer requirement. If the destination changes or you cannot complete the handoff, contact Dispatch. Completing this guide does not update the trip."

Practice progression derives labels and legal stages from the shared production presentation/state rules. It must not use map-intro.js's separate Passenger-only five-stage sequence as a new source of truth.

### Cargo manifest, quantities and units - Cargo

Trigger: first relevant manifest/pickup screen with available execution data.

**Body:** "Count what is actually present in the unit shown. Expected quantity is the requested amount; enter your own count rather than copying it."

**Details:** "Boxes, pieces and kilograms are different units. Enter zero only if none are present; a blank field means not yet counted. Whole-package items need whole counts; use the precision supported by measured units. Open the actual item reference when available. An example illustration only explains the item and is not evidence of this shipment's quantity or condition."

Practice: sample expected 10 boxes, actual 9; retain the displayed unit. A separate measured-unit scenario demonstrates allowed decimals using the current validator.

### Cargo shortage, excess and damage - Cargo

**Body:** "Report the actual difference or damage and explain what you found. Do not change your count to make it match the request."

**Details:** "Use Report issue on the affected item, select the supported issue and add a clear reason. An observation photo supports your report but does not authorize the load. An equal, undamaged count with a note is not a shortage report. Review the counts before continuing. If the source asks for a recount, count again and create a new observation; keep the earlier record."

Practice: 10 expected / 9 counted, shortage reason, WAIT, then a fresh recount. Show who must review the issue; do not present the driver's signature as its resolution.

### Cargo pickup acknowledgment - Cargo

**Body:** "Review the actual counts with the releasing staff member, then ask them to acknowledge and sign. Their signature records these counts; it does not clear departure."

**Details:** "Check the name and role or department. The person should review the quantities and condition before signing. If anything changes afterward, review and sign the new observation. Cancel keeps the counts without sending the signed observation. If the person refuses, keep the actual count and contact your fleet team; do not sign for them. Location may be unavailable and is not proof of authority."

Practice uses fictional names and an in-memory sample drawing through the production signature component, with native GPS acquisition disabled. Never collect an actual person's acknowledgment for training.

### Cargo departure and saved states - Cargo

**Body:** "A saved count or signature does not mean you can leave. Wait for every required source, fleet-team and post-load securement check to clear."

**Details:** "Saved on this device means the record may still need syncing. Saved by Fleet means it reached the fleet system. A partner acknowledgment means the message was received, not that the quantity was accepted. Departure permission is a separate current decision. Refresh after the responsible team reviews it. Do not depart when the app says the record is unsynced, unavailable or awaiting clearance."

Practice presents each distinct state on the same production status display. It never changes a real approval or unlocks a real action.

### Cargo delivery, receiving acknowledgment and completion - Cargo

**Body:** "Record what you actually deliver and review it with the receiving staff member. Their signature and the system's receiving confirmation are separate requirements."

**Details:** "Compare requested, picked-up and delivered amounts. If 10 boxes were requested, 9 picked up and 9 delivered, the pickup shortage is 1 and the delivery shortage is 0. Record any new damage or delivery difference honestly. Obtain the receiving person's acknowledgment of the reviewed count. Keep the trip open until the app confirms the required receiving authority and completion permission. Follow the ending-odometer step when required."

### Ending odometer - common, capability-aware

**Body:** "Capture and review the actual ending odometer. Confirm only after the passenger or cargo handoff and the trip's other completion requirements are satisfied."

**Details:** "Use the total kilometres, not a trip meter or map estimate. Retake an unclear or incorrect reading. A saved vehicle mileage from another trip is not this trip's ending reading. If confirmation fails or the connection drops, follow the screen's current saved status before retrying. A photo alone cannot complete Cargo while receiving approval is missing. Do not assume the trip is complete until its real status confirms it."

### Fuel request - common

**Body:** "Photograph the actual fuel gauge and review the level before requesting fuel. Wait for the request's real approval result before following the refuelling workflow."

**Details:** "Make sure the assigned vehicle is correct. The app uses the gauge, planned work and current fuel policy to calculate the request. Pending means it still needs review; it is not approval. Follow any budget, variance or vehicle warning shown. If the gauge cannot be read, use only the manual recovery available on this fuel screen; that option does not apply to odometer-photo capture. Do not create another request just because the first one is pending."

### Receipt capture and review - common

**Body:** "Capture the receipt clearly, then compare the extracted details with the printed receipt. A successful scan does not mean every value is correct."

**Details:** "Check the visible station, date, litres, amount and fuel details supported by this screen. Correct editable mistakes or retake the photo; follow the existing manual recovery if scanning fails. Submit once and read whether the record is saved, waiting to sync or awaiting review. Recording a receipt is different from requesting permission to buy fuel."

Practice preserves the existing useful deliberately incorrect OCR example, but renders the actual receipt-review fields and controls. Sample 2,911.75 must be corrected to the printed 2,911.25 before that practice step succeeds. No camera, upload or model call is needed for sample review.

### Incident reporting - common

**Body:** "Describe what happened and answer the safety questions honestly. Review the suggested severity and assistance before sending the report."

**Details:** "Choose the category that fits the event. The safety answers determine the recommendation; selecting a category alone does not. If you change the recommendation, give the reason the app asks for. Do not delay immediate help to finish this guide. After sending, distinguish saved or waiting-to-sync from received and acknowledged. Check the incident's real status or contact Dispatch when you need confirmation."

Practice covers severity recommendation and review using the real form. No fake Emergency Report Sent success or claim that responders were dispatched.

### SOS - common, explanation only

**Body:** "SOS is for an immediate emergency. Use it when you need urgent help; the tutorial will never ask you to trigger it for practice."

**Details:** "Read this explanation while safely parked. During a real emergency, leave the guide and use the actual emergency controls without tutorial steps. An app message is not proof that help has arrived or that emergency services were contacted. Follow your organization's emergency procedure and the actual confirmation shown."

No SOS interactive exercise, automatic activation, call simulation or added tutorial confirmation on the genuine SOS path. Help text does not introduce new emergency numbers or medical instructions.

### Offline, syncing and unavailable configuration - common / Cargo variant

Trigger: use the existing connectivity banner on the first real offline event; no competing popup. More details remains available.

**Body:** "You are viewing saved information. Check the sync status before assuming a change reached Fleet; some actions need a live connection."

**Details:** "A saved draft is not a confirmed trip update. Reconnect and refresh the affected screen. If this workflow supports queued submissions, use its existing retry/status controls and do not create a duplicate. Start/end odometer photos and Cargo clearance still need their existing online checks. If Cargo says its service is unavailable, retain your count as supported and contact your fleet team; a tutorial cannot enable the missing service."

## 5. Triggers, progress and replay

- One active guide. Screens request their own guide after data/target readiness; guide completion never chains to an unrelated section or navigates elsewhere.
- Automatic presentation is at most one introductory tip per screen visit. Later steps in that guide are explicit Next or successful interaction. An urgent condition cancels it; no delayed timer launches after the driver leaves.
- Missing, hidden, disabled-without-explanation or stale targets do not become fake controls. Defer until a later eligible visit; never leave a blocking scrim. A disabled control may be explained only when the actual disabled target/reason is visible, with no touch-through action.
- Keep persisted status per driver, guide ID, workflow variant and content version: seen, dismissed or completed. seen alone is not completion; dismissed and completed suppress automatic repeat at that version. Interrupted/unavailable guides are not mislabeled completed. Persist no operational state or private evidence.
- A section-based Replay guide opens Help for that section and offers Read guide or eligible Practice. Replay does not delete the previous stored outcome before the replacement finishes. An interrupted replay preserves the prior status. Keep Reset all tips as a secondary explicit action affecting only the current driver, not business data.
- Migrate known old completed keys conservatively. The old boolean completion combines skip and completion, so import it as dismissed with source legacy_unknown_outcome unless a specific outcome can be proven. Do not claim the driver mastered the task. Unknown classifications receive no imported Passenger/Cargo progress. New odometer, signature and clearance content remains independently available. No automatic whole-app reset.
- Help & Support is the single replay index using existing rows/disclosures. It shows common and saved-workspace guides, unavailable-practice reasons and a clearly labeled optional other-workflow sample without changing live specialization.

## 6. Safety and isolation contract

The existing >=10 km/h moving evidence and two-minute sticky hold remain a veto; they are not proof that lower speed means parked. Add a guide-only presentation policy instead of changing global trip tracking. A recent finite low-speed observation (<=0.5 m/s and <=30 seconds old), no moving hold, foreground app, no emergency and a valid current context can allow a contextual overlay. Unknown, stale or nonfinite speed suppresses automatic overlays. Existing inline warnings/connectivity messages and manually opened text help remain available.

Interactive practice is unavailable during any active/accepted live assignment, emergency/responder work or pending operational submission. Require an explicit "I am safely parked" confirmation on each entry and a memory-only session bound to current driver/session generation. With unknown GPS, a driver with no such work can intentionally practice after this confirmation; explain that the app cannot verify movement. Do not require new location permission merely to read help. Recent positive movement always vetoes confirmation. Any observed speed >0.5 m/s or a moving hold ends practice. Stale motion during an established known-motion practice suspends interaction rather than silently switching to the unknown-motion exception. Expire a practice session after ten minutes; offer a fresh explicit start, never automatic resumption.

Abort and discard practice on background, logout, account change, assignment arrival/change, emergency entry, session expiry, explicit exit or route abandonment. Do not navigate away from a genuine urgent deep link to return to practice. Late async results are ignored using an epoch/session identity; old queued guide events cannot advance a new session. Practice is not resumable after app restart. Mark an interruption separately; do not erase real drafts.

Practice uses an in-memory capability created by an explicit provider action. A route/URL parameter can identify a host or requested topic but cannot create that capability, bypass a guard or enable a real write. Without a valid capability the practice host shows an explanation and returns to Help; it never falls through into an operational submit path.

Share view components, not operational controllers. Production controllers supply existing authorized handlers; the practice host supplies only local reducers and sample fixtures. Do not choose between a real mutation callback and sample callback at the final submit based solely on isTour. Practice view code must not import operational API clients, queues, autosaves, file-copy, GPS, phone or navigation launchers. A server-shaped sample clearance remains contained to a clearly labeled sample view, never a live profile/trip/cache.

Existing app-wide real-trip tracking and queues continue their normal responsibilities independently. Zero operational mutations means zero requests or queued work caused by practice; do not claim all application background networking stops. Measure baseline and practice-origin activity separately in acceptance.

## 7. Architecture and visual behavior

Retain CoachMarkProvider as the single overlay owner with its stable Actions/Status/State context split. Extract pure eligibility, progress transition and practice reducer logic. Add a small guide registry and practice host; no new state-machine dependency, backend table, migration or tutorial analytics service.

Extract the actual Map status/control/trip-panel JSX into reusable production components as needed, preserving layout, titles, disabled/busy behavior and SwipeButton. The real Map and sample host render the same components. Inspection, odometer, fuel and incident screens likewise retain operational controllers and expose reusable form/presentation components only where necessary. Cargo already separates CargoWorkflowScreen and CargoWorkflowContent; reuse that seam and CargoSignatureModal.

Keep the native warm ivory/forest palette, Plus Jakarta Sans, existing theme/text-size and Clay primitives. Web dashboard tokens do not apply. No new artwork is required. Use at least 44 dp touch targets or the existing larger shared target; test 320/360/390 widths, light/dark, landscape, keyboard and 200% text. Details scroll and never cover Exit, the highlighted control or genuine emergency actions. Dismissed details return accessibility focus to their opener; steps announce once without stealing focus on GPS updates. Respect reduced motion and Android Back. Help text and samples ship locally for offline reading.

## 8. Release and acceptance

Build in reviewed slices: independent Welcome/progress, safe presentation, Map plus Passenger practice, shared high-risk forms, Cargo, replay and cleanup. Use a build-time local rollout switch only during coexistence. In legacy mode keep the legacy implementation intact; in new mode disable every legacy producer, shortcut interception and URL-tour entry. Never mount two overlay engines. Do not allow changing the switch within a running session. Delete the temporary switch and obsolete code after full acceptance.

Automated checks must exercise actual component callbacks and write boundaries, not merely inspect source strings. Prove practice cannot call each operational API, upload, queue, autosave, file copy, native GPS or external launcher; prove real handlers still call their existing contracts. Verify isolation through route, account, assignment, background and late-result races. Keep relevant historical regression intent when removing legacy tests.

Physical Android acceptance is required for native gesture, highlight measurement, keyboard, TalkBack, permissions and emergency priority. Use approved staged identities for real-trip checks; do not enable Cargo production providers to pass tutorial acceptance. Validate Cargo with isolated fixtures and separately record that operating integration remains pending. Do not claim iOS acceptance from Android or browser exports.

Driver usefulness pilot target: at least three unfamiliar participants for each workflow, allowed to overlap. After one optional guide, each must complete the critical sample task unaided and correctly explain the relevant saved/approval states. Any participant interpreting practice as live, treating a signature as clearance, copying expected counts, or confirming guest pickup before boarding is a release blocker. Treat this as formative usability evidence, not statistical proof or professional driver certification. Record completion, incorrect actions, questions and recovery without storing private guest/signature data.

Definition of done: all catalogue requirements mapped to tasks; independent triggers/replay; production components reused; zero practice-origin operational mutations; correct variants and current photo/signature rules; no forced chain; existing operations preserved; strict lint, focused and final regression, encoding and Android export pass; physical/participant findings resolved or explicitly block release. Update Capstone and SYSTEM only with behavior and checks actually completed.

## 9. Evidence behind this design

Read both pasted proposals; .agents/AGENTS.md; Driver In-App Guide; Trips; Fuel; Incidents; Live Map Radar; Mobile Architecture; October20 Cargo readiness/signature records; and the October20 proposal assessment. Inspected provider/storage/definitions, production and duplicate swipe controls, Map integrations, inspection/fuel/incident tour branches, CargoWorkflowContent, Help, motion derivation and existing render-test patterns. The current motion hook treats unknown as not driving; this design deliberately adds stricter guidance eligibility without changing the underlying operational hook. No runtime result is claimed by this planning document.
