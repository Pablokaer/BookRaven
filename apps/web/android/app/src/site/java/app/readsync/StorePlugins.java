package app.readsync;

import com.getcapacitor.BridgeActivity;

/**
 * The "site" build (the APK on our own server): it updates itself, so it brings the plugin that
 * opens Android's installer for a downloaded APK (src/lib/appUpdate.ts).
 */
final class StorePlugins {

    private StorePlugins() {}

    static void register(BridgeActivity activity) {
        activity.registerPlugin(ApkInstallerPlugin.class);
    }
}
