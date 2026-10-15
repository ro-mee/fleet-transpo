package expo.modules.fleetopstripbubble

import android.app.Service
import android.content.Intent
import android.os.IBinder

// Scaffold only: Task 2 replaces this with the acknowledged overlay lifecycle.
class FleetOpsTripBubbleService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    stopSelf()
    return START_NOT_STICKY
  }
}
