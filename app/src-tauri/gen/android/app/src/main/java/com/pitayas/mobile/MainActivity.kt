package com.pitayas.mobile

import android.content.Intent
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts

class MainActivity : TauriActivity() {
  private var shell: WebView? = null

  // Odtwarzacz modułu Watch zamyka się i oddaje czas oglądania modułowi (zdarzenie pitayas-watch-closed)
  private val watchResult = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
    val d = r.data
    val seconds = d?.getLongExtra(WatchPlayerActivity.SECONDS, 0) ?: 0
    val url = org.json.JSONObject.quote(d?.getStringExtra(WatchPlayerActivity.URL) ?: "")
    shell?.evaluateJavascript("window.dispatchEvent(new CustomEvent('pitayas-watch-closed',{detail:{seconds:$seconds,url:$url}}))", null)
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  override fun onWebViewCreate(webView: WebView) {
    shell = webView
    webView.addJavascriptInterface(object {
      @JavascriptInterface
      fun open(url: String, title: String, desktop: Boolean) {
        if (!url.startsWith("https://")) return
        runOnUiThread {
          watchResult.launch(Intent(this@MainActivity, WatchPlayerActivity::class.java)
            .putExtra(WatchPlayerActivity.URL, url)
            .putExtra(WatchPlayerActivity.TITLE, title)
            .putExtra(WatchPlayerActivity.DESKTOP, desktop))
        }
      }
    }, "PitayasWatchNative")
  }
}
