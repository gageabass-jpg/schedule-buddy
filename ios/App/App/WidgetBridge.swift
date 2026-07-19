import Foundation
import Capacitor
import WidgetKit

/// Capacitor plugin (JS name: `WidgetBridge`) that persists the schedule
/// snapshot handed over from the web app into the shared App Group container,
/// then asks WidgetKit to reload the home-screen widgets.
///
/// Capacitor 6+ auto-registers pure-Swift plugins that conform to
/// `CAPBridgedPlugin` — no `.m` bridging file required.
@objc(WidgetBridgePlugin)
public class WidgetBridgePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WidgetBridgePlugin"
    public let jsName = "WidgetBridge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "writeSnapshot", returnType: CAPPluginReturnPromise)
    ]

    /// Must match the App Group enabled on BOTH the app and widget targets,
    /// and `SnapshotStore.appGroup` in the widget extension.
    static let appGroup = "group.com.gagebass.schedulebuddy"
    static let fileName = "widget-snapshot.json"

    @objc func writeSnapshot(_ call: CAPPluginCall) {
        guard let json = call.getString("json") else {
            call.reject("Missing 'json' argument")
            return
        }
        guard let dir = FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: WidgetBridgePlugin.appGroup) else {
            call.reject("App Group '\(WidgetBridgePlugin.appGroup)' is not configured on this target")
            return
        }
        let url = dir.appendingPathComponent(WidgetBridgePlugin.fileName)
        do {
            try Data(json.utf8).write(to: url, options: .atomic)
            if #available(iOS 14.0, *) {
                WidgetCenter.shared.reloadAllTimelines()
            }
            call.resolve(["ok": true])
        } catch {
            call.reject("Failed to write snapshot: \(error.localizedDescription)")
        }
    }
}
