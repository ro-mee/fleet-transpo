package expo.modules.fleetopstripbubble

import android.content.Intent
import android.net.Uri
import android.provider.Settings
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class FleetOpsTripBubbleModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("FleetOpsTripBubble")

    AsyncFunction("canDrawOverlays") {
      appContext.reactContext?.let { Settings.canDrawOverlays(it) } ?: false
    }

    AsyncFunction("openOverlaySettings") {
      val context = appContext.reactContext
      if (context == null) {
        false
      } else {
        try {
          context.startActivity(
            Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:${context.packageName}"))
              .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
          )
          true
        } catch (_: Exception) {
          false
        }
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("showTripBubble") { tripId: String, promise: Promise ->
      val context = appContext.reactContext
      if (context == null) {
        promise.resolve(mapOf("shown" to false, "reason" to "start-failed"))
      } else {
        FleetOpsTripBubbleService.requestShow(context, tripId) { promise.resolve(it) }
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("hideTripBubble") { promise: Promise ->
      if (FleetOpsTripBubbleService.requestHide(appContext.reactContext)) {
        promise.resolve()
      } else {
        promise.reject("ERR_TRIP_BUBBLE_HIDE", "Could not remove the trip bubble", null)
      }
    }.runOnQueue(Queues.MAIN)
  }
}
