// Plain-English guide content; operational state and effects belong to the screens.
const GUIDES = [
  {
    "id": "welcome",
    "version": 1,
    "variant": "common",
    "route": "/",
    "title": "Welcome and Home",
    "section": "welcome",
    "steps": [
      {
        "id": "welcome.common.intro",
        "targetId": null,
        "title": "Welcome and Home",
        "body": "FleetOps will explain important steps as you need them. You can skip tips and reopen a guide from Help & Support.",
        "details": "Your Home screen shows your current duty, assigned vehicle and trips. Check that these match the work Dispatch gave you. If your vehicle or assignment is missing or incorrect, refresh and contact Dispatch before starting work. A tutorial does not assign a vehicle or make you ready for a trip.",
        "interaction": "observe",
        "eventType": null,
        "canSkip": true,
        "actionText": "Got it"
      }
    ]
  },
  {
    "id": "duty.start",
    "version": 1,
    "variant": "common",
    "route": "/",
    "title": "Start your shift",
    "section": "duty",
    "steps": [
      {
        "id": "duty.start.common.intro",
        "targetId": "home.preshift_start",
        "title": "Start your shift",
        "body": "Check the actual vehicle before starting your shift. This daily check does not replace the quick inspection required for each trip.",
        "details": "Choose PASS only after checking the item. Choose FAIL when there is a problem and describe what you found. Do not mark everything PASS to get through the form. A reported safety problem may block work and require the fleet team's review. Complete all required answers; follow the result shown after submission.",
        "interaction": "observe",
        "eventType": null,
        "canSkip": true,
        "actionText": "Got it"
      }
    ]
  },
  {
    "id": "inspection.quick",
    "version": 1,
    "variant": "passenger",
    "route": "/inspection",
    "title": "Quick Pre-Trip",
    "section": "inspection",
    "steps": [
      {
        "id": "inspection.quick.passenger.intro",
        "targetId": "inspection.pass_fail",
        "title": "Quick Pre-Trip",
        "body": "Inspect this trip's vehicle and answer the cabin and passenger-item checks honestly. A passed daily shift check does not clear this trip.",
        "details": "This check belongs to the trip shown here. Answer each required item and explain any failure. Use the existing lost-item or problem path when the screen requires it. Cargo securement here does not replace the separate post-load securement and departure review at pickup. Wait for the actual result; a completed tutorial is not a passed inspection.",
        "interaction": "observe",
        "eventType": null,
        "canSkip": true,
        "actionText": "Got it"
      }
    ]
  },
  {
    "id": "inspection.quick",
    "version": 1,
    "variant": "cargo",
    "route": "/inspection",
    "title": "Quick Pre-Trip",
    "section": "inspection",
    "steps": [
      {
        "id": "inspection.quick.cargo.intro",
        "targetId": "inspection.pass_fail",
        "title": "Quick Pre-Trip",
        "body": "Check the vehicle and secure the load for this trip. An unsecured load must be reported; do not mark it safe to unlock departure.",
        "details": "This check belongs to the trip shown here. Answer each required item and explain any failure. Use the existing lost-item or problem path when the screen requires it. Cargo securement here does not replace the separate post-load securement and departure review at pickup. Wait for the actual result; a completed tutorial is not a passed inspection.",
        "interaction": "observe",
        "eventType": null,
        "canSkip": true,
        "actionText": "Got it"
      }
    ]
  },
  {
    "id": "trip.readiness",
    "version": 1,
    "variant": "passenger",
    "route": "/trip",
    "title": "Assignment and readiness",
    "section": "trips",
    "steps": [
      {
        "id": "trip.readiness.passenger.intro",
        "targetId": "trip.readiness",
        "title": "Assignment and readiness",
        "body": "Check the pickup, destination, schedule and assigned vehicle. Starting the route is available only when the trip's required checks and start window allow it.",
        "details": "Refresh if the assignment looks old or the expected action is missing. If the start window has not opened, wait until the time shown. If the vehicle, driver type or job does not match, contact Dispatch. For Cargo, Start Trip begins travel to pickup; it does not confirm that goods have been collected. Follow each blocker shown by the app instead of repeating Start.",
        "interaction": "observe",
        "eventType": null,
        "canSkip": true,
        "actionText": "Got it"
      }
    ]
  },
  {
    "id": "trip.readiness",
    "version": 1,
    "variant": "cargo",
    "route": "/trip",
    "title": "Assignment and readiness",
    "section": "trips",
    "steps": [
      {
        "id": "trip.readiness.cargo.intro",
        "targetId": "trip.readiness",
        "title": "Assignment and readiness",
        "body": "Check the pickup, destination, schedule and assigned vehicle. Starting the route is available only when the trip's required checks and start window allow it.",
        "details": "Refresh if the assignment looks old or the expected action is missing. If the start window has not opened, wait until the time shown. If the vehicle, driver type or job does not match, contact Dispatch. For Cargo, Start Trip begins travel to pickup; it does not confirm that goods have been collected. Follow each blocker shown by the app instead of repeating Start.",
        "interaction": "observe",
        "eventType": null,
        "canSkip": true,
        "actionText": "Got it"
      }
    ]
  },
  {
    "id": "odometer.start",
    "version": 1,
    "variant": "common",
    "route": "/trip/odometer",
    "title": "Starting odometer",
    "section": "odometer",
    "steps": [
      {
        "id": "odometer.start.common.intro",
        "targetId": "odometer.photo",
        "title": "Starting odometer",
        "body": "Photograph the dashboard's total distance in kilometres. Check the detected reading before confirming; confirmation saves this evidence and starts the route.",
        "details": "Keep the full odometer clear and avoid glare. Use the total distance, not Trip A or Trip B. Retake the photo if digits are unclear or the reading is wrong. This photo workflow does not allow typing a replacement or substituting GPS distance. If the display is unsupported or repeated retakes fail, stop and contact your fleet team. Keep the app online while confirming, and follow the saved result before trying again.",
        "interaction": "observe",
        "eventType": null,
        "canSkip": true,
        "actionText": "Got it"
      }
    ]
  },
  {
    "id": "map.controls",
    "version": 1,
    "variant": "common",
    "route": "/map",
    "title": "Map controls and route information",
    "section": "map",
    "steps": [
      {
        "id": "map.controls.common.intro",
        "targetId": "map.controls",
        "title": "Map controls and route information",
        "body": "Use the visible map controls to inspect the route and return to your location. Read the trip status before using the action at the bottom.",
        "details": "The route and arrival estimate help you plan; they are not proof that a pickup or delivery is complete. Location permission, GPS quality and connection can affect what is shown. If location is unavailable, follow the screen's permission or retry instructions. Only explain Layers, route choices or other controls when they actually exist in this view. With no trip, this screen is standby; it does not mean an assignment is active.",
        "interaction": "observe",
        "eventType": null,
        "canSkip": true,
        "actionText": "Got it"
      }
    ]
  },
  {
    "id": "passenger.pickup",
    "version": 1,
    "variant": "passenger",
    "route": "/map",
    "title": "Passenger pickup",
    "section": "map",
    "steps": [
      {
        "id": "passenger.pickup.passenger.intro",
        "targetId": "map.trip_progression",
        "title": "Passenger pickup",
        "body": "Confirm arrival when you reach the assigned pickup. Confirm the guest is picked up only after the correct guest is safely onboard.",
        "details": "Check the assignment's guest and pickup details using your hotel's existing procedure. Reaching the map point does not mean the guest is onboard. If the guest is absent, the location is wrong or the assignment changed, contact Dispatch and keep the trip status truthful. If GPS prevents arrival confirmation, follow the actual app's retry or authorized exception path; the tutorial cannot bypass it.",
        "interaction": "observe",
        "eventType": null,
        "canSkip": true,
        "actionText": "Got it"
      }
    ]
  },
  {
    "id": "passenger.dropoff",
    "version": 1,
    "variant": "passenger",
    "route": "/map",
    "title": "Passenger destination and drop-off",
    "section": "map",
    "steps": [
      {
        "id": "passenger.dropoff.passenger.intro",
        "targetId": "map.trip_progression",
        "title": "Passenger destination and drop-off",
        "body": "Confirm the destination stage after arriving. Mark the guest dropped off only after they have safely left the vehicle at the correct destination.",
        "details": "Do not complete the trip just because the route line ends. Check that the guest handoff is complete, then follow the actual remaining trip action and ending-odometer requirement. If the destination changes or you cannot complete the handoff, contact Dispatch. Completing this guide does not update the trip.",
        "interaction": "observe",
        "eventType": null,
        "canSkip": true,
        "actionText": "Got it"
      }
    ]
  },
  {
    "id": "cargo.manifest",
    "version": 1,
    "variant": "cargo",
    "route": "/trip",
    "title": "Cargo manifest, quantities and units",
    "section": "cargo",
    "steps": [
      {
        "id": "cargo.manifest.cargo.intro",
        "targetId": "cargo.counts",
        "title": "Cargo manifest, quantities and units",
        "body": "Count what is actually present in the unit shown. Expected quantity is the requested amount; enter your own count rather than copying it.",
        "details": "Boxes, pieces and kilograms are different units. Enter zero only if none are present; a blank field means not yet counted. Whole-package items need whole counts; use the precision supported by measured units. Open the actual item reference when available. An example illustration only explains the item and is not evidence of this shipment's quantity or condition.",
        "interaction": "observe",
        "eventType": null,
        "canSkip": true,
        "actionText": "Got it"
      }
    ]
  },
  {
    "id": "cargo.issue",
    "version": 1,
    "variant": "cargo",
    "route": "/trip",
    "title": "Cargo shortage, excess and damage",
    "section": "cargo",
    "steps": [
      {
        "id": "cargo.issue.cargo.intro",
        "targetId": "cargo.issue",
        "title": "Cargo shortage, excess and damage",
        "body": "Report the actual difference or damage and explain what you found. Do not change your count to make it match the request.",
        "details": "Use Report issue on the affected item, select the supported issue and add a clear reason. An observation photo supports your report but does not authorize the load. An equal, undamaged count with a note is not a shortage report. Review the counts before continuing. If the source asks for a recount, count again and create a new observation; keep the earlier record.",
        "interaction": "observe",
        "eventType": null,
        "canSkip": true,
        "actionText": "Got it"
      }
    ]
  },
  {
    "id": "cargo.pickup_signature",
    "version": 1,
    "variant": "cargo",
    "route": "/trip",
    "title": "Cargo pickup acknowledgment",
    "section": "cargo",
    "steps": [
      {
        "id": "cargo.pickup_signature.cargo.intro",
        "targetId": "cargo.signature",
        "title": "Cargo pickup acknowledgment",
        "body": "Review the actual counts with the releasing staff member, then ask them to acknowledge and sign. Their signature records these counts; it does not clear departure.",
        "details": "Check the name and role or department. The person should review the quantities and condition before signing. If anything changes afterward, review and sign the new observation. Cancel keeps the counts without sending the signed observation. If the person refuses, keep the actual count and contact your fleet team; do not sign for them. Location may be unavailable and is not proof of authority.",
        "interaction": "observe",
        "eventType": null,
        "canSkip": true,
        "actionText": "Got it"
      }
    ]
  },
  {
    "id": "cargo.departure",
    "version": 1,
    "variant": "cargo",
    "route": "/trip",
    "title": "Cargo departure and saved states",
    "section": "cargo",
    "steps": [
      {
        "id": "cargo.departure.cargo.intro",
        "targetId": "cargo.departure_status",
        "title": "Cargo departure and saved states",
        "body": "A saved count or signature does not mean you can leave. Wait for every required source, fleet-team and post-load securement check to clear.",
        "details": "Saved on this device means the record may still need syncing. Saved by Fleet means it reached the fleet system. A partner acknowledgment means the message was received, not that the quantity was accepted. Departure permission is a separate current decision. Refresh after the responsible team reviews it. Do not depart when the app says the record is unsynced, unavailable or awaiting clearance.",
        "interaction": "observe",
        "eventType": null,
        "canSkip": true,
        "actionText": "Got it"
      }
    ]
  },
  {
    "id": "cargo.delivery",
    "version": 1,
    "variant": "cargo",
    "route": "/trip",
    "title": "Cargo delivery, receiving acknowledgment and completion",
    "section": "cargo",
    "steps": [
      {
        "id": "cargo.delivery.cargo.intro",
        "targetId": "cargo.delivery",
        "title": "Cargo delivery, receiving acknowledgment and completion",
        "body": "Record what you actually deliver and review it with the receiving staff member. Their signature and the system's receiving confirmation are separate requirements.",
        "details": "Compare requested, picked-up and delivered amounts. If 10 boxes were requested, 9 picked up and 9 delivered, the pickup shortage is 1 and the delivery shortage is 0. Record any new damage or delivery difference honestly. Obtain the receiving person's acknowledgment of the reviewed count. Keep the trip open until the app confirms the required receiving authority and completion permission. Follow the ending-odometer step when required.",
        "interaction": "observe",
        "eventType": null,
        "canSkip": true,
        "actionText": "Got it"
      }
    ]
  },
  {
    "id": "odometer.end",
    "version": 1,
    "variant": "common",
    "route": "/trip/complete",
    "title": "Ending odometer",
    "section": "odometer",
    "steps": [
      {
        "id": "odometer.end.common.intro",
        "targetId": "odometer.photo",
        "title": "Ending odometer",
        "body": "Capture and review the actual ending odometer. Confirm only after the passenger or cargo handoff and the trip's other completion requirements are satisfied.",
        "details": "Use the total kilometres, not a trip meter or map estimate. Retake an unclear or incorrect reading. A saved vehicle mileage from another trip is not this trip's ending reading. If confirmation fails or the connection drops, follow the screen's current saved status before retrying. A photo alone cannot complete Cargo while receiving approval is missing. Do not assume the trip is complete until its real status confirms it.",
        "interaction": "observe",
        "eventType": null,
        "canSkip": true,
        "actionText": "Got it"
      }
    ]
  },
  {
    "id": "fuel.request",
    "version": 1,
    "variant": "common",
    "route": "/fuel-report",
    "title": "Fuel request",
    "section": "fuel",
    "steps": [
      {
        "id": "fuel.request.common.intro",
        "targetId": "fuel.gauge_entry",
        "title": "Fuel request",
        "body": "Photograph the actual fuel gauge and review the level before requesting fuel. Wait for the request's real approval result before following the refuelling workflow.",
        "details": "Make sure the assigned vehicle is correct. The app uses the gauge, planned work and current fuel policy to calculate the request. Pending means it still needs review; it is not approval. Follow any budget, variance or vehicle warning shown. If the gauge cannot be read, use only the manual recovery available on this fuel screen; that option does not apply to odometer-photo capture. Do not create another request just because the first one is pending.",
        "interaction": "observe",
        "eventType": null,
        "canSkip": true,
        "actionText": "Got it"
      }
    ]
  },
  {
    "id": "fuel.receipt",
    "version": 1,
    "variant": "common",
    "route": "/fuel-report",
    "title": "Receipt capture and review",
    "section": "fuel",
    "steps": [
      {
        "id": "fuel.receipt.common.intro",
        "targetId": "fuel.verify",
        "title": "Receipt capture and review",
        "body": "Capture the receipt clearly, then compare the extracted details with the printed receipt. A successful scan does not mean every value is correct.",
        "details": "Check the visible station, date, litres, amount and fuel details supported by this screen. Correct editable mistakes or retake the photo; follow the existing manual recovery if scanning fails. Submit once and read whether the record is saved, waiting to sync or awaiting review. Recording a receipt is different from requesting permission to buy fuel.",
        "interaction": "observe",
        "eventType": null,
        "canSkip": true,
        "actionText": "Got it"
      }
    ]
  },
  {
    "id": "incident.report",
    "version": 1,
    "variant": "common",
    "route": "/incidents",
    "title": "Incident reporting",
    "section": "incident",
    "steps": [
      {
        "id": "incident.report.common.intro",
        "targetId": "incident.category",
        "title": "Incident reporting",
        "body": "Describe what happened and answer the safety questions honestly. Review the suggested severity and assistance before sending the report.",
        "details": "Choose the category that fits the event. The safety answers determine the recommendation; selecting a category alone does not. If you change the recommendation, give the reason the app asks for. Do not delay immediate help to finish this guide. After sending, distinguish saved or waiting-to-sync from received and acknowledged. Check the incident's real status or contact Dispatch when you need confirmation.",
        "interaction": "observe",
        "eventType": null,
        "canSkip": true,
        "actionText": "Got it"
      }
    ]
  },
  {
    "id": "sos",
    "version": 1,
    "variant": "common",
    "route": "/",
    "title": "SOS",
    "section": "sos",
    "steps": [
      {
        "id": "sos.common.intro",
        "targetId": "incident.sos",
        "title": "SOS",
        "body": "SOS is for an immediate emergency. Use it when you need urgent help; the tutorial will never ask you to trigger it for practice.",
        "details": "Read this explanation while safely parked. During a real emergency, leave the guide and use the actual emergency controls without tutorial steps. An app message is not proof that help has arrived or that emergency services were contacted. Follow your organization's emergency procedure and the actual confirmation shown.",
        "interaction": "observe",
        "eventType": null,
        "canSkip": true,
        "actionText": "Got it"
      }
    ]
  },
  {
    "id": "offline",
    "version": 1,
    "variant": "common",
    "route": "/",
    "title": "Offline, syncing and unavailable configuration",
    "section": "offline",
    "steps": [
      {
        "id": "offline.common.intro",
        "targetId": "offline.banner",
        "title": "Offline, syncing and unavailable configuration",
        "body": "You are viewing saved information. Check the sync status before assuming a change reached Fleet; some actions need a live connection.",
        "details": "A saved draft is not a confirmed trip update. Reconnect and refresh the affected screen. If this workflow supports queued submissions, use its existing retry/status controls and do not create a duplicate. Start/end odometer photos and Cargo clearance still need their existing online checks. If Cargo says its service is unavailable, retain your count as supported and contact your fleet team; a tutorial cannot enable the missing service.",
        "interaction": "observe",
        "eventType": null,
        "canSkip": true,
        "actionText": "Got it"
      }
    ]
  },
  {
    "id": "inspection.daily",
    "version": 1,
    "variant": "common",
    "route": "/inspection",
    "title": "Check the actual vehicle",
    "section": "inspection",
    "steps": [
      {
        "id": "inspection.daily.common.intro",
        "targetId": "inspection.pass_fail",
        "title": "Check the actual vehicle",
        "body": "Choose PASS only after checking the actual item. Choose FAIL when there is a problem and describe what you found.",
        "details": "Choose PASS only after checking the item. Choose FAIL when there is a problem and describe what you found. Do not mark everything PASS to get through the form. A reported safety problem may block work and require the fleet team's review. Complete all required answers; follow the result shown after submission.",
        "interaction": "observe",
        "eventType": null,
        "canSkip": true,
        "actionText": "Got it"
      }
    ]
  },
  {
    "id": "duty.end",
    "version": 1,
    "variant": "common",
    "route": "/",
    "title": "Before ending your shift",
    "section": "duty",
    "steps": [
      {
        "id": "duty.end.common.intro",
        "targetId": "home.end_duty",
        "title": "Before ending your shift",
        "body": "Report the actual vehicle condition before ending duty. Describing a problem may open maintenance work and make the vehicle unavailable for another trip.",
        "details": "Complete the End Duty Report using what you actually observed during the shift. If nothing unusual happened, use the existing no-problem option. If you noticed a fault, describe it clearly so your fleet team can review the vehicle. Do not report a fictional problem to try the tutorial. Follow the actual saved result; a completed guide does not close your shift or clear maintenance.",
        "interaction": "observe",
        "eventType": null,
        "canSkip": true,
        "actionText": "Got it"
      }
    ]
  }
];

export const LEGACY_GUIDE_IMPORTS = Object.freeze({
  "welcome": [
    "welcome"
  ],
  "duty.start": [
    "preshift"
  ],
  "duty.end": [
    "end_duty"
  ],
  "trip.readiness": [
    "trip_readiness"
  ],
  "sos": [
    "sos",
    "tour_sos"
  ],
  "incident.report": [
    "incident"
  ],
  "offline": [
    "offline"
  ],
  "fuel.receipt": [
    "fuel_scan_verify"
  ]
});

const variants = new Set(["common", "passenger", "cargo"]);
for (const guide of GUIDES) {
  guide.steps.forEach(Object.freeze); Object.freeze(guide.steps); Object.freeze(guide);
}

export function getDriverGuide(id, variant) {
  if (!variants.has(variant)) return null;
  return GUIDES.find(guide => guide.id === id && (guide.variant === variant || guide.variant === "common")) || null;
}

export function listDriverGuides(variant) {
  if (!variants.has(variant)) return [];
  return GUIDES.filter(guide => guide.variant === "common" || guide.variant === variant);
}
