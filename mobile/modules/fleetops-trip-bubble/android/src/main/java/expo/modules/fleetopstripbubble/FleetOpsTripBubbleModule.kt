package expo.modules.fleetopstripbubble

import android.content.Intent
import android.net.Uri
import android.provider.Settings
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

    AsyncFunction("showTripBubble") { tripId: String ->
      val context = appContext.reactContext
      when {
        tripId.isBlank() -> mapOf("shown" to false, "reason" to "invalid-trip")
        context == null -> mapOf("shown" to false, "reason" to "start-failed")
        !Settings.canDrawOverlays(context) -> mapOf("shown" to false, "reason" to "permission-denied")
        // Task 2 must acknowledge a real window before this can report shown.
        else -> mapOf("shown" to false, "reason" to "start-failed")
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("hideTripBubble") {
      appContext.reactContext?.let { context ->
        context.stopService(Intent(context, FleetOpsTripBubbleService::class.java))
      }
      Unit
    }.runOnQueue(Queues.MAIN)
  }
}
