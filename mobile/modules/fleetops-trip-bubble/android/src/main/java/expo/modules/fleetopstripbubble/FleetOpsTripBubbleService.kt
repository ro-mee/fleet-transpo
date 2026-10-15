package expo.modules.fleetopstripbubble

import android.app.Service
import android.app.ActivityOptions
import android.app.AppOpsManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.graphics.PixelFormat
import android.graphics.Rect
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.provider.Settings
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.WindowInsets
import android.view.WindowManager
import android.widget.ImageButton
import kotlin.math.roundToInt

class FleetOpsTripBubbleService : Service() {
  private lateinit var windows: WindowManager
  private lateinit var appOps: AppOpsManager
  private var bubble: ImageButton? = null
  private var layout: WindowManager.LayoutParams? = null
  private var tapIntent: PendingIntent? = null
  private var ownedRequest = 0L
  private var watchingPermission = false
  private val permissionListener = AppOpsManager.OnOpChangedListener { _, changedPackage ->
    if (changedPackage == packageName) main.post {
      if (!Settings.canDrawOverlays(this)) failAndStop("permission-denied")
    }
  }

  override fun onCreate() {
    super.onCreate()
    instance = this
    windows = getSystemService(WindowManager::class.java)
    appOps = getSystemService(AppOpsManager::class.java)
    try {
      appOps.startWatchingMode(AppOpsManager.OPSTR_SYSTEM_ALERT_WINDOW, packageName, permissionListener)
      watchingPermission = true
    } catch (_: RuntimeException) {
      // Permission is also checked before every window operation and tap.
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == HIDE) {
      requestHide(this)
      return START_NOT_STICKY
    }
    val request = intent?.getLongExtra(REQUEST, 0L) ?: 0L
    if (intent?.action != SHOW || request != generation || pending == null) {
      if (bubble == null) stopSelfResult(startId)
      return START_NOT_STICKY
    }
    ownedRequest = request
    val tripId = intent.getStringExtra(TRIP_ID)
    if (tripId.isNullOrBlank()) {
      failAndStop("invalid-trip")
    } else if (!Settings.canDrawOverlays(this)) {
      failAndStop("permission-denied")
    } else {
      try {
        show(tripId, request)
      } catch (_: Exception) {
        failAndStop(if (Settings.canDrawOverlays(this)) "start-failed" else "permission-denied")
      }
    }
    return START_NOT_STICKY
  }

  private fun show(tripId: String, request: Long) {
    val link = Uri.parse("fleetops:///redirect-trip").buildUpon()
      .appendQueryParameter("tripId", tripId).build()
    val intent = Intent(Intent.ACTION_VIEW, link).setPackage(packageName)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    val nextTap = PendingIntent.getActivity(
      this, 0, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
    )
    if (tapIntent != nextTap) tapIntent?.cancel()
    tapIntent = nextTap
    val view = bubble ?: ImageButton(this).apply {
      contentDescription = "Return to active trip"
      setImageResource(R.drawable.fleetops_trip_bubble_icon)
      setBackgroundResource(R.drawable.fleetops_trip_bubble_background)
      val padding = dp(14)
      setPadding(padding, padding, padding, padding)
      elevation = dp(8).toFloat()
      isClickable = true
      isFocusable = true
      importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_YES
      setOnClickListener { openTrip() }
      attachDrag(this)
    }.also { newView ->
      val size = dp(56)
      val params = WindowManager.LayoutParams(
        size, size, WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
          WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
          (if (Build.VERSION.SDK_INT >= 30) WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN else 0),
        PixelFormat.TRANSLUCENT
      ).apply {
        gravity = Gravity.TOP or Gravity.LEFT
        x = 0
        y = dp(120)
        if (Build.VERSION.SDK_INT >= 30) {
          setFitInsetsTypes(0)
        } else {
          softInputMode = WindowManager.LayoutParams.SOFT_INPUT_ADJUST_NOTHING
          if (Build.VERSION.SDK_INT >= 28) {
            layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_NEVER
          }
        }
      }
      bubble = newView
      layout = params
      position(params, snap = true)
      windows.addView(newView, params)
      newView.setOnApplyWindowInsetsListener { _, insets ->
        updatePosition(snap = true)
        insets
      }
    }
    view.post {
      if (request != generation || ownedRequest != request || bubble !== view) return@post
      updatePosition(snap = true)
      if (bubble !== view) return@post
      if (!Settings.canDrawOverlays(this)) {
        failAndStop("permission-denied")
      } else if (!view.isAttachedToWindow) {
        failAndStop("start-failed")
      } else {
        acknowledge(request, mapOf("shown" to true))
      }
    }
  }

  private fun attachDrag(view: ImageButton) {
    val slop = ViewConfiguration.get(this).scaledTouchSlop
    var downX = 0f
    var downY = 0f
    var startX = 0
    var startY = 0
    var dragging = false
    view.setOnTouchListener { _, event ->
      val params = layout ?: return@setOnTouchListener false
      when (event.actionMasked) {
        MotionEvent.ACTION_DOWN -> {
          downX = event.rawX
          downY = event.rawY
          startX = params.x
          startY = params.y
          dragging = false
          view.isPressed = true
          true
        }
        MotionEvent.ACTION_MOVE -> {
          val dx = event.rawX - downX
          val dy = event.rawY - downY
          if (dx * dx + dy * dy > slop * slop) dragging = true
          if (dragging) {
            view.isPressed = false
            params.x = startX + dx.roundToInt()
            params.y = startY + dy.roundToInt()
            updatePosition(snap = false)
          }
          true
        }
        MotionEvent.ACTION_UP -> {
          view.isPressed = false
          val dx = event.rawX - downX
          val dy = event.rawY - downY
          if (!dragging && dx * dx + dy * dy <= slop * slop) view.performClick()
          else updatePosition(snap = true)
          true
        }
        MotionEvent.ACTION_CANCEL -> {
          view.isPressed = false
          updatePosition(snap = true)
          true
        }
        else -> false
      }
    }
  }

  private fun position(params: WindowManager.LayoutParams, snap: Boolean) {
    if (Build.VERSION.SDK_INT < 30) {
      val view = bubble ?: return
      if (!view.isAttachedToWindow) return
      // Without LAYOUT_IN_SCREEN, Android supplies a bar/cutout-safe parent frame.
      // Both the offsets and the helper's clamp use that frame's local origin.
      val frame = Rect()
      view.getWindowVisibleDisplayFrame(frame)
      check(frame.width() >= params.width && frame.height() >= params.height)
      params.x = BubblePosition.frameX(params.x, params.width, frame.left, frame.right, snap)
      params.y = BubblePosition.frameY(params.y, params.height, frame.top, frame.bottom)
      return
    }
    val metrics = windows.currentWindowMetrics
    val insets = metrics.windowInsets.getInsetsIgnoringVisibility(
      WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout()
    )
    val width = metrics.bounds.width()
    val height = metrics.bounds.height()
    val left = insets.left
    val top = insets.top
    val right = insets.right
    val bottom = insets.bottom
    params.x = if (snap) BubblePosition.snapX(params.x, params.width, width, left, right)
      else BubblePosition.clampX(params.x, params.width, width, left, right)
    params.y = BubblePosition.clampY(params.y, top, height - bottom - params.height)
  }

  private fun updatePosition(snap: Boolean) {
    val view = bubble ?: return
    val params = layout ?: return
    try {
      if (!Settings.canDrawOverlays(this)) {
        failAndStop("permission-denied")
        return
      }
      position(params, snap)
      windows.updateViewLayout(view, params)
    } catch (_: Exception) {
      failAndStop("start-failed")
    }
  }

  private fun openTrip() {
    if (!Settings.canDrawOverlays(this)) {
      failAndStop("permission-denied")
      return
    }
    try {
      if (Build.VERSION.SDK_INT >= 34) {
        val options = ActivityOptions.makeBasic().apply {
          setPendingIntentBackgroundActivityStartMode(
            if (Build.VERSION.SDK_INT >= 36) ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOW_IF_VISIBLE
            else ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED
          )
        }
        tapIntent?.send(this, 0, null, null, null, null, options.toBundle())
      } else {
        tapIntent?.send()
      }
    } catch (_: Exception) {
      failAndStop("start-failed")
    }
  }

  private fun removeBubble() {
    val view = bubble
    try {
      if (view != null) windows.removeViewImmediate(view)
    } catch (_: IllegalArgumentException) {
      // Android may have removed the window when permission was revoked.
    }
    bubble = null
    layout = null
    tapIntent?.cancel()
    tapIntent = null
  }

  private fun failAndStop(reason: String) {
    acknowledge(ownedRequest, mapOf("shown" to false, "reason" to reason))
    try { removeBubble() } catch (_: RuntimeException) { /* Service teardown retries removal. */ }
    stopSelf()
  }

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    updatePosition(snap = true)
  }

  override fun onDestroy() {
    acknowledge(ownedRequest, mapOf("shown" to false, "reason" to "start-failed"))
    if (instance === this) instance = null
    if (watchingPermission) try { appOps.stopWatchingMode(permissionListener) } catch (_: RuntimeException) { }
    try { removeBubble() } catch (_: RuntimeException) { }
    super.onDestroy()
  }

  private fun dp(value: Int) = (value * resources.displayMetrics.density).roundToInt()

  companion object {
    const val SHOW = "expo.modules.fleetopstripbubble.SHOW"
    const val HIDE = "expo.modules.fleetopstripbubble.HIDE"
    private const val TRIP_ID = "tripId"
    private const val REQUEST = "request"
    private val main = Handler(Looper.getMainLooper())
    private var instance: FleetOpsTripBubbleService? = null
    private var generation = 0L
    private var pending: ((Map<String, Any>) -> Unit)? = null
    private var timeout: Runnable? = null

    // All bridge calls and service callbacks run on Android's main queue.
    fun requestShow(context: Context, tripId: String, complete: (Map<String, Any>) -> Unit) {
      cancelPending()
      val request = ++generation
      val reason = when {
        tripId.isBlank() -> "invalid-trip"
        !Settings.canDrawOverlays(context) -> "permission-denied"
        else -> null
      }
      if (reason != null) {
        requestHide(context)
        complete(mapOf("shown" to false, "reason" to reason))
        return
      }
      pending = complete
      val expiry = Runnable {
        if (generation == request && pending != null) {
          requestHide(context)
        }
      }
      timeout = expiry
      main.postDelayed(expiry, 5000)
      try {
        val started = context.startService(Intent(context, FleetOpsTripBubbleService::class.java)
          .setAction(SHOW).putExtra(TRIP_ID, tripId).putExtra(REQUEST, request))
        if (started == null) requestHide(context)
      } catch (_: Exception) {
        requestHide(context)
      }
    }

    fun requestHide(context: Context?): Boolean {
      ++generation
      cancelPending()
      val service = instance
      var removed = true
      try {
        service?.removeBubble()
      } catch (_: RuntimeException) {
        removed = false
      }
      try {
        service?.stopSelf()
        context?.stopService(Intent(context, FleetOpsTripBubbleService::class.java))
      } catch (_: RuntimeException) {
        removed = false
      }
      return removed
    }

    private fun cancelPending() {
      timeout?.let { main.removeCallbacks(it) }
      timeout = null
      val complete = pending
      pending = null
      complete?.invoke(mapOf("shown" to false, "reason" to "start-failed"))
    }

    private fun acknowledge(request: Long, result: Map<String, Any>) {
      if (request != generation) return
      timeout?.let { main.removeCallbacks(it) }
      timeout = null
      val complete = pending
      pending = null
      complete?.invoke(result)
    }
  }
}
