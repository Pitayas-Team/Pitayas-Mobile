package com.pitayas.mobile;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

// Start aplikacji po włączeniu telefonu (włączany w Ustawienia → Developer)
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String a = intent.getAction();
        if (!Intent.ACTION_BOOT_COMPLETED.equals(a) && !"android.intent.action.QUICKBOOT_POWERON".equals(a)) return;
        Intent start = new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try { context.startActivity(start); } catch (Exception ignored) {}
    }
}
