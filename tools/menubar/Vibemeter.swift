import Cocoa

let APP_LABEL = "com.hirra.vibemeter"
let DASHBOARD_URL = URL(string: "http://localhost:9527")!
let LOG_PATH = NSString(string: "~/.vibemeter/vibemeter.log").expandingTildeInPath

final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate {
    var statusItem: NSStatusItem!
    var statusMenuItem: NSMenuItem!

    func applicationDidFinishLaunching(_ notification: Notification) {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)

        if let button = statusItem.button {
            // SF Symbol — gauge fits the "meter" theme; falls back to ⌖ on older macOS
            if let img = NSImage(systemSymbolName: "gauge.with.dots.needle.67percent",
                                 accessibilityDescription: "Vibemeter") {
                img.isTemplate = true
                button.image = img
            } else {
                button.title = "⌖"
            }
        }

        let menu = NSMenu()
        menu.delegate = self

        statusMenuItem = NSMenuItem(title: "Checking…", action: nil, keyEquivalent: "")
        statusMenuItem.isEnabled = false
        menu.addItem(statusMenuItem)
        menu.addItem(NSMenuItem.separator())

        let open = NSMenuItem(title: "Open Dashboard",
                              action: #selector(openDashboard),
                              keyEquivalent: "o")
        open.target = self
        menu.addItem(open)

        let log = NSMenuItem(title: "View Log",
                             action: #selector(viewLog),
                             keyEquivalent: "l")
        log.target = self
        menu.addItem(log)

        let restart = NSMenuItem(title: "Restart Service",
                                 action: #selector(restartService),
                                 keyEquivalent: "r")
        restart.target = self
        menu.addItem(restart)

        menu.addItem(NSMenuItem.separator())

        let quit = NSMenuItem(title: "Quit Vibemeter Menubar",
                              action: #selector(NSApplication.terminate(_:)),
                              keyEquivalent: "q")
        menu.addItem(quit)

        statusItem.menu = menu
    }

    // Refresh status line right before user sees the menu.
    func menuWillOpen(_ menu: NSMenu) {
        checkServerStatus { reachable in
            DispatchQueue.main.async {
                self.statusMenuItem.title = reachable
                    ? "● running · localhost:9527"
                    : "○ not responding"
            }
        }
    }

    @objc func openDashboard() {
        NSWorkspace.shared.open(DASHBOARD_URL)
    }

    @objc func viewLog() {
        if FileManager.default.fileExists(atPath: LOG_PATH) {
            NSWorkspace.shared.open(URL(fileURLWithPath: LOG_PATH))
        } else {
            let alert = NSAlert()
            alert.messageText = "No log yet"
            alert.informativeText = "\(LOG_PATH) does not exist. Has the daemon been installed?"
            alert.runModal()
        }
    }

    @objc func restartService() {
        let task = Process()
        task.launchPath = "/bin/launchctl"
        task.arguments = ["kickstart", "-k", "gui/\(getuid())/\(APP_LABEL)"]
        do {
            try task.run()
            task.waitUntilExit()
        } catch {
            NSLog("kickstart failed: \(error)")
        }
    }

    private func checkServerStatus(completion: @escaping (Bool) -> Void) {
        var req = URLRequest(url: DASHBOARD_URL)
        req.httpMethod = "HEAD"
        req.timeoutInterval = 1.0
        let task = URLSession.shared.dataTask(with: req) { _, response, _ in
            if let http = response as? HTTPURLResponse, (200..<500).contains(http.statusCode) {
                completion(true)
            } else {
                completion(false)
            }
        }
        task.resume()
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)  // hides Dock icon
app.run()
