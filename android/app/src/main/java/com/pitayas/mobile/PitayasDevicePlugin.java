package com.pitayas.mobile;

import android.content.ComponentName;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.view.WindowManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// ═══════ PITAYAS DEVICE (Android) ═══════
// Opcje z Ustawienia → Developer: aplikacja domowa, start po włączeniu telefonu, ekran zawsze włączony i jasność (przyciemnianie).
@CapacitorPlugin(name = "PitayasDevice")
public class PitayasDevicePlugin extends Plugin {

    private ComponentName homeAlias() { return new ComponentName(getContext(), "com.pitayas.mobile.HomeAlias"); }
    private ComponentName bootReceiver() { return new ComponentName(getContext(), BootReceiver.class); }

    private boolean enabled(ComponentName c) {
        return getContext().getPackageManager().getComponentEnabledSetting(c) == PackageManager.COMPONENT_ENABLED_STATE_ENABLED;
    }

    private void setEnabled(ComponentName c, boolean on) {
        getContext().getPackageManager().setComponentEnabledSetting(c,
            on ? PackageManager.COMPONENT_ENABLED_STATE_ENABLED : PackageManager.COMPONENT_ENABLED_STATE_DISABLED, PackageManager.DONT_KILL_APP);
    }

    private boolean isDefaultHome() {
        Intent i = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME);
        ResolveInfo r = getContext().getPackageManager().resolveActivity(i, PackageManager.MATCH_DEFAULT_ONLY);
        return r != null && r.activityInfo != null && getContext().getPackageName().equals(r.activityInfo.packageName);
    }

    private boolean canOverlay() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(getContext());
    }

    @PluginMethod
    public void getState(PluginCall call) {
        JSObject r = new JSObject();
        r.put("home", enabled(homeAlias()));
        r.put("defaultHome", isDefaultHome());
        r.put("boot", enabled(bootReceiver()));
        r.put("overlay", canOverlay());
        r.put("fullscreen", getContext().getSharedPreferences(MainActivity.PREFS, android.content.Context.MODE_PRIVATE).getBoolean(MainActivity.FULLSCREEN, true));
        call.resolve(r);
    }

    // Aplikacja domowa: włącza wpis „HOME”, a wybór domyślnego ekranu głównego robi system (otwieramy jego ustawienia)
    @PluginMethod
    public void setHome(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        setEnabled(homeAlias(), on);
        try {
            Intent i = new Intent(Settings.ACTION_HOME_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
        } catch (Exception e) {
            getContext().startActivity(new Intent(Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        }
        call.resolve();
    }

    // Start po włączeniu telefonu: Android 10+ pozwala na to tylko z uprawnieniem „Wyświetlanie nad innymi aplikacjami”
    @PluginMethod
    public void setBoot(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        setEnabled(bootReceiver(), on);
        if (on && !canOverlay()) {
            Intent i = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + getContext().getPackageName()))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
        }
        call.resolve();
    }

    @PluginMethod
    public void keepScreenOn(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
        getActivity().runOnUiThread(() -> {
            if (on) getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            else getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            call.resolve();
        });
    }

    // Jasność tylko tego okna: 0.01–1, albo -1 = jak w systemie
    @PluginMethod
    public void setBrightness(PluginCall call) {
        float v = call.getFloat("value", -1f);
        getActivity().runOnUiThread(() -> {
            WindowManager.LayoutParams lp = getActivity().getWindow().getAttributes();
            lp.screenBrightness = v < 0 ? WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE : Math.max(0.01f, Math.min(1f, v));
            getActivity().getWindow().setAttributes(lp);
            call.resolve();
        });
    }

    // Pełny ekran (paski systemu schowane) — zapamiętane, działa od startu aplikacji
    @PluginMethod
    public void setFullscreen(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("enabled", true));
        getContext().getSharedPreferences(MainActivity.PREFS, android.content.Context.MODE_PRIVATE).edit().putBoolean(MainActivity.FULLSCREEN, on).apply();
        getActivity().runOnUiThread(() -> {
            ((MainActivity) getActivity()).applyFullscreen();
            call.resolve();
        });
    }

    // ═══════ AKTUALIZACJA APLIKACJI (APK) ═══════
    // Pobiera nowe APK do pamięci podręcznej i otwiera systemowy instalator. Android zawsze pyta o potwierdzenie
    // („Zainstaluj”) — bez uprawnień właściciela urządzenia nie da się zainstalować po cichu.
    // Za pierwszym razem trzeba zezwolić Pitayas na „instalowanie nieznanych aplikacji” (otwieramy te ustawienia).
    @PluginMethod
    public void canInstall(PluginCall call) {
        JSObject r = new JSObject();
        r.put("allowed", Build.VERSION.SDK_INT < Build.VERSION_CODES.O || getContext().getPackageManager().canRequestPackageInstalls());
        call.resolve(r);
    }

    @PluginMethod
    public void installApk(PluginCall call) {
        String url = call.getString("url");
        if (url == null || !url.startsWith("https://")) { call.reject("Zły adres APK"); return; }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !getContext().getPackageManager().canRequestPackageInstalls()) {
            Intent s = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()));
            s.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(s);
            call.reject("Zezwól Pitayas na instalowanie aplikacji i spróbuj ponownie", "PERMISSION");
            return;
        }
        new Thread(() -> {
            java.io.File out = new java.io.File(getContext().getCacheDir(), "pitayas-update.apk");
            try {
                java.net.HttpURLConnection c = null;
                String u = url;
                for (int hop = 0; hop < 6; hop++) {   // GitHub przekierowuje na serwer z plikami
                    c = (java.net.HttpURLConnection) new java.net.URL(u).openConnection();
                    c.setInstanceFollowRedirects(false);
                    c.setConnectTimeout(15000);
                    c.setReadTimeout(30000);
                    int code = c.getResponseCode();
                    if (code >= 300 && code < 400) { u = c.getHeaderField("Location"); c.disconnect(); continue; }
                    if (code != 200) throw new java.io.IOException("HTTP " + code);
                    break;
                }
                long total = c.getContentLengthLong(), done = 0, lastPct = -1;
                try (java.io.InputStream in = c.getInputStream(); java.io.FileOutputStream fo = new java.io.FileOutputStream(out)) {
                    byte[] buf = new byte[64 * 1024];
                    int n;
                    while ((n = in.read(buf)) > 0) {
                        fo.write(buf, 0, n);
                        done += n;
                        long pct = total > 0 ? done * 100 / total : -1;
                        if (pct != lastPct) {
                            lastPct = pct;
                            JSObject ev = new JSObject();
                            ev.put("percent", pct);
                            notifyListeners("apkProgress", ev);
                        }
                    }
                }
                Uri uri = androidx.core.content.FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", out);
                Intent i = new Intent(Intent.ACTION_VIEW);
                i.setDataAndType(uri, "application/vnd.android.package-archive");
                i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(i);
                call.resolve();
            } catch (Exception e) {
                call.reject("Nie udało się pobrać aktualizacji: " + e.getMessage());
            }
        }).start();
    }
}
