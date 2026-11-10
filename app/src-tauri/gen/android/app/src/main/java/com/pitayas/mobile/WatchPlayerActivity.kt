package com.pitayas.mobile

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.content.pm.ActivityInfo
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.os.SystemClock
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.CookieManager
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout

// ═══════ PITAYAS WATCH — ODTWARZACZ ═══════
// WebView dla oficjalnych stron serwisów VOD (Netflix, Disney+, Prime Video…):
//  • DRM: strona prosi o RESOURCE_PROTECTED_MEDIA_ID (Widevine) — zgadzamy się w onPermissionRequest,
//  • tryb komputera: User-Agent przeglądarki na komputer, żeby serwis nie odsyłał do swojej aplikacji,
//  • pełny ekran filmu i licznik czasu z otwartym odtwarzaczem (wynik wraca do modułu Watch).
class WatchPlayerActivity : Activity() {
  companion object {
    const val URL = "url"
    const val TITLE = "title"
    const val DESKTOP = "desktop"
    const val SECONDS = "seconds"
    const val DESKTOP_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
  }

  private lateinit var root: FrameLayout
  private lateinit var web: WebView
  private var fullView: View? = null
  private var fullCallback: WebChromeClient.CustomViewCallback? = null
  private var watched = 0L      // ms z odtwarzaczem na wierzchu
  private var resumedAt = 0L

  @SuppressLint("SetJavaScriptEnabled")
  override fun onCreate(state: Bundle?) {
    super.onCreate(state)
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    if (state != null) watched = state.getLong(SECONDS, 0)

    root = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }
    web = WebView(this)
    root.addView(web, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
    setContentView(root)

    web.settings.apply {
      javaScriptEnabled = true
      domStorageEnabled = true
      mediaPlaybackRequiresUserGesture = false
      javaScriptCanOpenWindowsAutomatically = false
      setSupportMultipleWindows(false)
      mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW
      allowFileAccess = false
      allowContentAccess = false
      if (intent.getBooleanExtra(DESKTOP, true)) {
        userAgentString = DESKTOP_UA
        useWideViewPort = true
        loadWithOverviewMode = true
        setSupportZoom(true)
        builtInZoomControls = true
        displayZoomControls = false
      }
    }
    // Logowanie w serwisie ma przetrwać zamknięcie odtwarzacza
    CookieManager.getInstance().setAcceptCookie(true)
    CookieManager.getInstance().setAcceptThirdPartyCookies(web, true)

    web.webViewClient = object : WebViewClient() {
      // Zostajemy w WebView; linki do aplikacji serwisu (intent://, market://) pomijamy
      override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
        val scheme = request.url.scheme
        return scheme != "https" && scheme != "http"
      }
    }
    web.webChromeClient = object : WebChromeClient() {
      // Tylko identyfikator chronionych multimediów (Widevine); kamery i mikrofonu nie dajemy
      override fun onPermissionRequest(request: PermissionRequest) {
        val grant = request.resources.filter { it == PermissionRequest.RESOURCE_PROTECTED_MEDIA_ID }.toTypedArray()
        runOnUiThread { if (grant.isNotEmpty()) request.grant(grant) else request.deny() }
      }

      override fun onShowCustomView(view: View, callback: CustomViewCallback) {
        if (fullView != null) { callback.onCustomViewHidden(); return }
        fullView = view
        fullCallback = callback
        root.addView(view, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        web.visibility = View.GONE
        requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
        hideBars(true)
      }

      override fun onHideCustomView() = leaveFull()
    }

    if (state == null || web.restoreState(state) == null) {
      val u = Uri.parse(intent.getStringExtra(URL) ?: "")
      if (u.scheme != "https") { finish(); return }
      web.loadUrl(u.toString())
    }
  }

  private fun leaveFull() {
    val v = fullView ?: return
    root.removeView(v)
    fullView = null
    web.visibility = View.VISIBLE
    fullCallback?.onCustomViewHidden()
    fullCallback = null
    requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
    hideBars(false)
  }

  @Suppress("DEPRECATION")
  private fun hideBars(hide: Boolean) {
    window.decorView.systemUiVisibility = if (hide)
      View.SYSTEM_UI_FLAG_FULLSCREEN or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
    else View.SYSTEM_UI_FLAG_VISIBLE
  }

  private fun seconds(): Long = (watched + if (resumedAt > 0) SystemClock.elapsedRealtime() - resumedAt else 0) / 1000

  override fun onResume() {
    super.onResume()
    resumedAt = SystemClock.elapsedRealtime()
    web.onResume()
  }

  override fun onPause() {
    if (resumedAt > 0) watched += SystemClock.elapsedRealtime() - resumedAt
    resumedAt = 0
    web.onPause()
    CookieManager.getInstance().flush()
    super.onPause()
  }

  override fun onSaveInstanceState(out: Bundle) {
    super.onSaveInstanceState(out)
    out.putLong(SECONDS, watched)
    web.saveState(out)
  }

  @Suppress("DEPRECATION", "OVERRIDE_DEPRECATION")
  override fun onBackPressed() {
    when {
      fullView != null -> leaveFull()
      web.canGoBack() -> web.goBack()
      else -> finish()
    }
  }

  override fun finish() {
    setResult(RESULT_OK, Intent().putExtra(SECONDS, seconds()).putExtra(URL, web.url ?: ""))
    super.finish()
  }

  override fun onDestroy() {
    root.removeView(web)
    web.destroy()
    super.onDestroy()
  }
}
