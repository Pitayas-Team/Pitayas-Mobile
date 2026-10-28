package com.pitayas.mobile;

import android.content.Context;
import android.content.res.Configuration;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.WindowManager;

import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    static final String PREFS = "pitayas";
    static final String FULLSCREEN = "fullscreen";

    private final Handler handler = new Handler(Looper.getMainLooper());
    private boolean imeWasVisible = false;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PitayasDevicePlugin.class);   // aplikacja domowa, start po włączeniu, jasność ekranu, pełny ekran
        super.onCreate(savedInstanceState);
        // Treść pod paskami systemu (jak w iOS) — inaczej po ukryciu pasków zostaje pusty margines
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        // Po zamknięciu klawiatury system potrafi przywrócić paski — wtedy chowamy je od razu
        final View decor = getWindow().getDecorView();
        decor.getViewTreeObserver().addOnGlobalLayoutListener(() -> {
            WindowInsetsCompat insets = ViewCompat.getRootWindowInsets(decor);
            if (insets == null) return;
            boolean ime = insets.isVisible(WindowInsetsCompat.Type.ime());
            if (imeWasVisible && !ime) applyFullscreenSoon();
            imeWasVisible = ime;
        });
        applyFullscreenSoon();
    }

    // Paski wracają po powrocie z tła, po rozwinięciu powiadomień i zmianie orientacji — chowamy je za każdym razem
    @Override
    public void onResume() {
        super.onResume();
        applyFullscreenSoon();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) applyFullscreenSoon();
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        applyFullscreenSoon();
    }

    // Jedno wywołanie czasem nie działa (okno jeszcze się układa) — powtarzamy po chwili; powtórka niczego nie psuje
    void applyFullscreenSoon() {
        applyFullscreen();
        handler.removeCallbacksAndMessages(null);
        handler.postDelayed(this::applyFullscreen, 250);
        handler.postDelayed(this::applyFullscreen, 900);
    }

    // Pełny ekran (domyślnie włączony): bez paska stanu i nawigacji; przeciągnięcie od krawędzi pokazuje je na chwilę
    void applyFullscreen() {
        boolean on = getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(FULLSCREEN, true);
        WindowInsetsControllerCompat c = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        // Wycięcie kamery: bez tego po ukryciu paska stanu u góry zostaje czarny pas
        if (Build.VERSION.SDK_INT >= 28) {
            WindowManager.LayoutParams lp = getWindow().getAttributes();
            int mode = !on ? WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_DEFAULT
                : Build.VERSION.SDK_INT >= 30 ? WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
                : WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            if (lp.layoutInDisplayCutoutMode != mode) {
                lp.layoutInDisplayCutoutMode = mode;
                getWindow().setAttributes(lp);
            }
        }
        if (on) {
            c.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            c.hide(WindowInsetsCompat.Type.systemBars());
        } else {
            c.show(WindowInsetsCompat.Type.systemBars());
        }
    }
}
