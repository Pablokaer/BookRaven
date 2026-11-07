package app.readsync;

import com.getcapacitor.BridgeActivity;

/**
 * The Google Play build: Google Play installs and updates it, so it has no APK installer
 * (Play's policy forbids an app updating itself any other way).
 */
final class StorePlugins {

    private StorePlugins() {}

    static void register(BridgeActivity activity) {}
}
