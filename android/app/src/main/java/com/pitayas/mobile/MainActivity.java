package com.pitayas.mobile;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PitayasDevicePlugin.class);   // aplikacja domowa, start po włączeniu, jasność ekranu
        super.onCreate(savedInstanceState);
    }
}
