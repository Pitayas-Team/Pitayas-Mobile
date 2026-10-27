package com.pitayas.mobile;

import android.content.Context;
import android.os.Bundle;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    static final String PREFS = "pitayas";
    static final String FULLSCREEN = "fullscreen";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PitayasDevicePlugin.class);   // aplikacja domowa, start po włączeniu, jasność ekranu, pełny ekran
        super.onCreate(savedInstanceState);
        applyFullscreen();
    }

    // System pokazuje paski po powrocie z tła, po klawiaturze i po przeciągnięciu od krawędzi — chowamy je ponownie
    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) applyFullscreen();
    }

    // Pełny ekran (domyślnie włączony): bez paska stanu i paska nawigacji; przeciągnięcie od krawędzi pokazuje je na chwilę
    void applyFullscreen() {
        boolean on = getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(FULLSCREEN, true);
        WindowInsetsControllerCompat c = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        if (on) {
            c.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            c.hide(WindowInsetsCompat.Type.systemBars());
        } else {
            c.show(WindowInsetsCompat.Type.systemBars());
        }
    }
}
