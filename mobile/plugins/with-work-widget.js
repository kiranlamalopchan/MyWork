const { withFinalizedMod } = require("expo/config-plugins");
const fs = require("node:fs");
const path = require("node:path");

// Expo's Android widget runtime is isolated. Open the clock using the native
// receiver even when the app process has been killed; don't rely on a JS listener.
module.exports = function withWorkWidget(config) {
  return withFinalizedMod(config, ["android", async (mod) => {
    const pkg = mod.android.package;
    const directory = path.join(mod.modRequest.platformProjectRoot, "app/src/main/java", ...pkg.split("."));
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, "WorkClockProvider.kt"), `package ${pkg}

import android.content.Context
import android.content.Intent
import android.net.Uri
import expo.modules.widgets.ExpoWidgetsAppWidgetProvider

class WorkClockProvider : ExpoWidgetsAppWidgetProvider("WorkClock") {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action == "expo.modules.widgets.ACTION_WIDGET_INTERACTION") {
      val open = Intent(Intent.ACTION_VIEW, Uri.parse("mywork://clock"))
        .setPackage(context.packageName)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
      context.startActivity(open)
      return
    }
    super.onReceive(context, intent)
  }
}
`);
    return mod;
  }]);
};
