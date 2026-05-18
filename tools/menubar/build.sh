#!/usr/bin/env bash
# Builds Vibemeter.app — a menubar shortcut to the local dashboard.
# Usage: ./tools/menubar/build.sh [install]
#   install    install to /Applications and register as a Login Item

set -euo pipefail
cd "$(dirname "$0")"

APP_NAME="Vibemeter"
BUNDLE_ID="cn.hirra.vibemeter.menubar"
APP_BUNDLE="${APP_NAME}.app"
BIN_NAME="Vibemeter"

rm -rf "$APP_BUNDLE"
mkdir -p "${APP_BUNDLE}/Contents/MacOS"
mkdir -p "${APP_BUNDLE}/Contents/Resources"

# Compile
echo "→ compiling Swift binary…"
swiftc Vibemeter.swift \
  -o "${APP_BUNDLE}/Contents/MacOS/${BIN_NAME}" \
  -O -framework Cocoa

# Info.plist
cat > "${APP_BUNDLE}/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key><string>${BIN_NAME}</string>
    <key>CFBundleIdentifier</key><string>${BUNDLE_ID}</string>
    <key>CFBundleName</key><string>${APP_NAME}</string>
    <key>CFBundleDisplayName</key><string>${APP_NAME}</string>
    <key>CFBundleShortVersionString</key><string>0.1.0</string>
    <key>CFBundleVersion</key><string>1</string>
    <key>CFBundlePackageType</key><string>APPL</string>
    <key>LSMinimumSystemVersion</key><string>11.0</string>
    <key>LSUIElement</key><true/>
    <key>NSHumanReadableCopyright</key><string>MIT — hirra</string>
</dict>
</plist>
EOF

echo "✓ built ${APP_BUNDLE}"

if [ "${1:-}" = "install" ]; then
  echo "→ installing to /Applications…"
  rm -rf "/Applications/${APP_BUNDLE}"
  cp -R "$APP_BUNDLE" /Applications/
  # Ad-hoc sign so launchd won't complain
  codesign --force --deep --sign - "/Applications/${APP_BUNDLE}" 2>/dev/null || true

  echo "→ launching now…"
  open "/Applications/${APP_BUNDLE}"

  echo "→ registering as Login Item via AppleScript…"
  osascript -e 'tell application "System Events" to make login item at end with properties {path:"/Applications/Vibemeter.app", hidden:true}' 2>/dev/null || true

  echo ""
  echo "  ✓ installed: /Applications/${APP_BUNDLE}"
  echo "  ✓ launched (look for the gauge icon in your menu bar)"
  echo "  ✓ will auto-start on login"
  echo ""
fi
