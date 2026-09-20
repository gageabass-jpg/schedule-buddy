import Foundation
import UIKit
import UserNotifications
import Capacitor
import WidgetKit

/// Registers app-local Capacitor plugins.
///
/// Capacitor 8 does NOT auto-discover plugins by scanning for `CAPBridgedPlugin`
/// conformance — `CapacitorBridge.registerPlugins()` only loads classes named in
/// `packageClassList` inside the bundled `capacitor.config.json`, which `npx cap
/// sync` generates from installed npm packages. A plugin that lives in the app
/// target (like WidgetBridgePlugin) is therefore never registered, and the web
/// app sees no `Capacitor.Plugins.WidgetBridge`.
///
/// `registerPluginInstance(_:)` is the supported escape hatch — unlike
/// `registerPluginType(_:)` it has no `autoRegisterPlugins` guard. Doing it here
/// survives `cap sync`, whereas hand-editing capacitor.config.json would not.
///
/// Wired up via Main.storyboard (customClass = MainViewController).
class MainViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(WidgetBridgePlugin())
    }
}

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
        CAPPluginMethod(name: "writeSnapshot", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearBadge", returnType: CAPPluginReturnPromise)
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

    /// Zero the app-icon badge and clear delivered notifications.
    ///
    /// The push payload now carries a real count, but nothing ever reset it —
    /// so the badge stuck to the icon permanently. The web app calls this when
    /// it comes to the foreground.
    @objc func clearBadge(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let center = UNUserNotificationCenter.current()
            center.removeAllDeliveredNotifications()
            if #available(iOS 16.0, *) {
                center.setBadgeCount(0) { _ in }
            } else {
                UIApplication.shared.applicationIconBadgeNumber = 0
            }
            call.resolve(["ok": true])
        }
    }
}
