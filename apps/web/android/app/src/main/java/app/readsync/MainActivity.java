package app.readsync;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // The site build's APK installer; nothing in the Google Play build (src/site, src/play).
        StorePlugins.register(this);
        super.onCreate(savedInstanceState);
    }
}
