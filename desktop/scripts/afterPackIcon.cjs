// electron-builder afterPack hook: put the Icon Composer icon into the Mac app.
//
// build/<name>.icon is the source (an Icon Composer document). macOS 26 and later
// draw an app's icon from a compiled asset catalog (Assets.car) named in the
// app's Info.plist as CFBundleIconName; an app with only a flat .icns is shrunk
// into a grey plate. So this compiles the .icon with Xcode's `actool`, as Xcode
// does for any app, into the app's Resources (Assets.car, plus a flat .icns that
// older macOS uses) and points Info.plist at it. electron-builder 25 can't take
// a .icon itself.
//
// Needs Xcode. Without it the build still finishes, with the flat icon from
// build/icon.png, and says so. The Dock icon while the app runs is set from
// build/icon.png / icon-dark.png (electron/main.ts); render those from the same
// .icon with Icon Composer's `ictool` when it changes.

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

exports.default = async function afterPackIcon(context) {
  if (context.electronPlatformName !== "darwin") return;

  const buildDir = path.join(context.packager.projectDir, "build");
  const source = fs.readdirSync(buildDir).find((f) => f.endsWith(".icon"));
  if (!source) { console.warn("  • afterPackIcon: no .icon in build/, keeping the flat icon"); return; }
  const name = path.basename(source, ".icon");

  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const resources = path.join(app, "Contents", "Resources");
  const plist = path.join(app, "Contents", "Info.plist");
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "nucleus-icon-"));

  try {
    execFileSync("xcrun", [
      "actool", path.join(buildDir, source),
      "--compile", resources,
      "--platform", "macosx", "--minimum-deployment-target", "26.0",
      "--app-icon", name,
      "--output-partial-info-plist", path.join(scratch, "partial.plist"),
    ], { stdio: ["ignore", "ignore", "inherit"] });

    const buddy = (command) => execFileSync("/usr/libexec/PlistBuddy", ["-c", command, plist], { stdio: "ignore" });
    const set = (key, value) => { try { buddy(`Set :${key} ${value}`); } catch { buddy(`Add :${key} string ${value}`); } };
    set("CFBundleIconFile", name);   // the flat .icns actool wrote beside Assets.car
    set("CFBundleIconName", name);   // the asset catalog entry macOS 26+ draws
    console.log(`  • afterPackIcon: compiled "${source}" into the app (CFBundleIconName=${name})`);
  } catch (err) {
    console.warn(`  • afterPackIcon: couldn't compile the .icon (${err.message}); keeping the flat icon`);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
};
