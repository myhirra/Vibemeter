import Cocoa
import Foundation

struct FloatQuota: Decodable {
    let agent: String
    let label: String
    let accountLabel: String?
    let remaining5h: Double?
    let used5h: Double?
    let remainingWeekly: Double?
    let usedWeekly: Double?
    let resetAt5h: Double?
    let resetAtWeekly: Double?
    let capturedAt: Double?
}

struct ToolCount: Decodable {
    let tool: String
    let count: Int
}

struct LastSession: Decodable {
    let tool: String
    let project: String
    let title: String?
    let startedAt: Double
}

struct LiveSession: Decodable {
    let id: String
    let tool: String
    let project: String
    let title: String?
    let startedAt: Double
    let endedAt: Double?
    let durationMs: Double
}

struct AgentLive: Decodable {
    let agent: String
    let state: String
    let quotaLevel: String
    let activeSession: LiveSession?
    let recentSession: LiveSession?
}

struct FloatStats: Decodable {
    let generatedAt: Double
    let primary: FloatQuota?
    let quotas: [FloatQuota]
    let liveByAgent: [AgentLive]
    let todaySessions: Int
    let totalSessions: Int
    let todayByTool: [ToolCount]
    let lastSession: LastSession?
}

final class FloatingPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}

final class FloatView: NSView {
    var stats: FloatStats?
    var statusText = "loading"
    var isExpanded = false
    var selectedAgent = "claude-code"
    var onRefresh: (() -> Void)?
    var onOpenDashboard: (() -> Void)?
    var onHide: (() -> Void)?
    private var dragStart: NSPoint?
    private var didDrag = false

    override var isFlipped: Bool { true }

    private var displayedQuota: FloatQuota? {
        if let quota = stats?.quotas.first(where: { $0.agent == selectedAgent }) {
            return quota
        }
        return nil
    }

    private var displayedWindow: (remaining: Double?, resetAt: Double?, label: String) {
        guard let quota = displayedQuota else { return (nil, nil, "no snapshot") }
        if let five = quota.remaining5h {
            return (five, quota.resetAt5h, "5h remaining")
        }
        if let weekly = quota.remainingWeekly { return (weekly, quota.resetAtWeekly, "weekly remaining") }
        return (nil, nil, "no quota")
    }

    private var displayedLive: AgentLive? {
        stats?.liveByAgent.first(where: { $0.agent == selectedAgent })
    }

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        guard let context = NSGraphicsContext.current?.cgContext else { return }

        let rect = bounds.insetBy(dx: 8, dy: 8)
        drawPanel(in: rect)
        if !isExpanded {
            drawCollapsed(context: context, in: rect)
            return
        }
        drawHeader(in: rect)
        drawRing(context: context, in: rect)
        drawPrimary(in: rect)
        if isExpanded {
            drawStats(in: rect)
            drawFooter(in: rect)
        }
        drawFoldButton(in: rect)
    }

    override func mouseDown(with event: NSEvent) {
        dragStart = event.locationInWindow
        didDrag = false
        if event.clickCount == 2 {
            onOpenDashboard?()
        }
    }

    override func mouseDragged(with event: NSEvent) {
        guard let window, let start = dragStart else { return }
        let current = event.locationInWindow
        var origin = window.frame.origin
        origin.x += current.x - start.x
        origin.y += current.y - start.y
        if abs(current.x - start.x) > 2 || abs(current.y - start.y) > 2 {
            didDrag = true
        }
        window.setFrameOrigin(origin)
    }

    override func mouseUp(with event: NSEvent) {
        dragStart = nil
        if didDrag { return }
        if event.clickCount == 1 {
            let point = convert(event.locationInWindow, from: nil)
            if !isExpanded {
                isExpanded = true
                resizeWindowKeepingTopRight(NSSize(width: 306, height: 260))
                needsDisplay = true
            } else if NSRect(x: 20, y: 18, width: 94, height: 18).contains(point) {
                onOpenDashboard?()
            } else if foldButtonRect().contains(point) {
                isExpanded = false
                resizeWindowKeepingTopRight(NSSize(width: 112, height: 112))
                needsDisplay = true
            } else if NSRect(x: bounds.width - 27, y: 18, width: 22, height: 27).contains(point) {
                onHide?()
            } else if NSRect(x: bounds.width - 47, y: 18, width: 27, height: 27).contains(point) {
                onRefresh?()
            } else if NSRect(x: bounds.width - 161, y: 18, width: 57, height: 27).contains(point) {
                selectedAgent = "claude-code"
                needsDisplay = true
            } else if NSRect(x: bounds.width - 104, y: 18, width: 57, height: 27).contains(point) {
                selectedAgent = "codex"
                needsDisplay = true
            }
        }
    }

    override func rightMouseUp(with event: NSEvent) {
        let menu = NSMenu()
        menu.addItem(withTitle: isExpanded ? "Collapse" : "Expand", action: #selector(toggleFromMenu), keyEquivalent: "e")
        menu.addItem(withTitle: "Refresh", action: #selector(refreshFromMenu), keyEquivalent: "r")
        menu.addItem(withTitle: "Open Dashboard", action: #selector(openDashboardFromMenu), keyEquivalent: "o")
        menu.addItem(NSMenuItem.separator())
        menu.addItem(withTitle: "Quit Vibemeter Float", action: #selector(quitFromMenu), keyEquivalent: "q")
        NSMenu.popUpContextMenu(menu, with: event, for: self)
    }

    @objc private func toggleFromMenu() {
        isExpanded.toggle()
        resizeWindowKeepingTopRight(NSSize(width: isExpanded ? 306 : 112, height: isExpanded ? 260 : 112))
        needsDisplay = true
    }
    @objc private func refreshFromMenu() { onRefresh?() }
    @objc private func openDashboardFromMenu() { onOpenDashboard?() }
    @objc private func quitFromMenu() { NSApp.terminate(nil) }

    private func drawPanel(in rect: NSRect) {
        let shadow = NSShadow()
        shadow.shadowBlurRadius = 22
        shadow.shadowOffset = NSSize(width: 0, height: -8)
        shadow.shadowColor = NSColor.black.withAlphaComponent(0.45)
        shadow.set()

        NSColor(calibratedRed: 0.055, green: 0.057, blue: 0.067, alpha: 0.94).setFill()
        let path = NSBezierPath(roundedRect: rect, xRadius: 26, yRadius: 26)
        path.fill()

        NSColor.white.withAlphaComponent(0.08).setStroke()
        path.lineWidth = 1
        path.stroke()
    }

    private func drawHeader(in rect: NSRect) {
        drawText("Vibemeter", rect: NSRect(x: rect.minX + 20, y: rect.minY + 18, width: 94, height: 18), size: 13, weight: .semibold, color: NSColor.white.withAlphaComponent(0.94))
        drawAgentSwitch(in: NSRect(x: rect.maxX - 180, y: rect.minY + 10, width: 114, height: 27))
        drawIconButton("↻", rect: NSRect(x: rect.maxX - 59, y: rect.minY + 10, width: 27, height: 27), active: true)
        drawText("×", rect: NSRect(x: rect.maxX - 22, y: rect.minY + 14, width: 14, height: 16), size: 14, weight: .medium, color: NSColor.white.withAlphaComponent(0.54), alignment: .center)
    }

    private func drawCollapsed(context: CGContext, in rect: NSRect) {
        let remaining = displayedWindow.remaining
        let progress = CGFloat(max(0, min(100, remaining ?? 0)) / 100)
        let center = CGPoint(x: rect.midX, y: rect.midY)
        let radius: CGFloat = min(rect.width, rect.height) / 2 - 15
        let color = accentColor(remaining: remaining)

        context.setLineWidth(8)
        context.setLineCap(.round)
        context.setStrokeColor(NSColor.white.withAlphaComponent(0.10).cgColor)
        context.addArc(center: center, radius: radius, startAngle: -.pi / 2, endAngle: 1.5 * .pi, clockwise: false)
        context.strokePath()

        context.setStrokeColor(color.cgColor)
        context.addArc(center: center, radius: radius, startAngle: -.pi / 2, endAngle: -.pi / 2 + progress * 2 * .pi, clockwise: false)
        context.strokePath()

        let value = remaining == nil ? "--" : "\(Int(round(remaining!)))%"
        drawText(value, rect: NSRect(x: rect.minX + 12, y: center.y - 15, width: rect.width - 24, height: 30), size: 24, weight: .bold, color: .white, alignment: .center)
    }

    private func drawRing(context: CGContext, in rect: NSRect) {
        let remaining = displayedWindow.remaining
        let progress = CGFloat(max(0, min(100, remaining ?? 0)) / 100)
        let center = CGPoint(x: rect.minX + 74, y: rect.minY + 99)
        let radius: CGFloat = 43
        let color = accentColor(remaining: remaining)

        context.setLineWidth(9)
        context.setLineCap(.round)
        context.setStrokeColor(NSColor.white.withAlphaComponent(0.10).cgColor)
        context.addArc(center: center, radius: radius, startAngle: -.pi / 2, endAngle: 1.5 * .pi, clockwise: false)
        context.strokePath()

        context.setStrokeColor(color.cgColor)
        context.addArc(center: center, radius: radius, startAngle: -.pi / 2, endAngle: -.pi / 2 + progress * 2 * .pi, clockwise: false)
        context.strokePath()

        let inner = NSRect(x: center.x - 34, y: center.y - 34, width: 68, height: 68)
        NSColor(calibratedRed: 0.035, green: 0.037, blue: 0.045, alpha: 1).setFill()
        NSBezierPath(ovalIn: inner).fill()

        let value = remaining == nil ? "--" : "\(Int(round(remaining!)))%"
        drawText(value, rect: NSRect(x: center.x - 36, y: center.y - 16, width: 72, height: 29), size: 23, weight: .bold, color: .white, alignment: .center)
    }

    private func drawPrimary(in rect: NSRect) {
        let quota = displayedQuota
        let window = displayedWindow
        let x = rect.minX + 138
        drawText(quota?.label ?? selectedAgentLabel(), rect: NSRect(x: x, y: rect.minY + 72, width: 130, height: 22), size: 18, weight: .semibold, color: .white)
        drawText(quota == nil ? statusText : window.label, rect: NSRect(x: x, y: rect.minY + 97, width: 132, height: 16), size: 11, weight: .regular, color: NSColor.white.withAlphaComponent(0.46))
        drawText(resetText(window.resetAt), rect: NSRect(x: x, y: rect.minY + 118, width: 132, height: 16), size: 11, weight: .regular, color: NSColor.white.withAlphaComponent(0.64))
        if let account = quota?.accountLabel, !account.isEmpty {
            drawText(account, rect: NSRect(x: x, y: rect.minY + 139, width: 132, height: 14), size: 10, weight: .regular, color: NSColor.white.withAlphaComponent(0.32))
        }
    }

    private func drawStats(in rect: NSRect) {
        let top = rect.minY + 164
        drawMetric(title: "today", value: "\(stats?.todaySessions ?? 0)", rect: NSRect(x: rect.minX + 20, y: top, width: 74, height: 50))
        drawMetric(title: "total", value: "\(stats?.totalSessions ?? 0)", rect: NSRect(x: rect.minX + 104, y: top, width: 74, height: 50))
        let weekly = displayedQuota?.remainingWeekly
        drawMetric(title: "weekly", value: weekly == nil ? "--" : "\(Int(round(weekly!)))%", rect: NSRect(x: rect.minX + 188, y: top, width: 74, height: 50))
    }

    private func drawFooter(in rect: NSRect) {
        let live = displayedLive
        let session = live?.activeSession ?? live?.recentSession
        let prefix = live?.state == "active" ? "active" : live?.state == "recent" ? "done" : "latest"
        let line = session == nil ? "No recent \(selectedAgentLabel()) session" : "\(prefix) · \(session!.project) · \(durationText(session!.durationMs))"
        drawText(line, rect: NSRect(x: rect.minX + 22, y: rect.maxY - 32, width: rect.width - 74, height: 16), size: 11, weight: .medium, color: NSColor.white.withAlphaComponent(0.72))
        if let title = session?.title, !title.isEmpty {
            drawText(title, rect: NSRect(x: rect.minX + 22, y: rect.maxY - 17, width: rect.width - 74, height: 14), size: 10, weight: .regular, color: NSColor.white.withAlphaComponent(0.38))
        } else {
            drawText("double-click dashboard · drag anywhere", rect: NSRect(x: rect.minX + 22, y: rect.maxY - 17, width: rect.width - 74, height: 14), size: 10, weight: .regular, color: NSColor.white.withAlphaComponent(0.35))
        }
    }

    private func drawMetric(title: String, value: String, rect: NSRect) {
        NSColor.black.withAlphaComponent(0.20).setFill()
        NSBezierPath(roundedRect: rect, xRadius: 14, yRadius: 14).fill()
        NSColor.white.withAlphaComponent(0.06).setStroke()
        NSBezierPath(roundedRect: rect, xRadius: 14, yRadius: 14).stroke()
        drawText(title, rect: NSRect(x: rect.minX, y: rect.minY + 9, width: rect.width, height: 13), size: 9, weight: .medium, color: NSColor.white.withAlphaComponent(0.38), alignment: .center)
        drawText(value, rect: NSRect(x: rect.minX, y: rect.minY + 25, width: rect.width, height: 20), size: 15, weight: .semibold, color: .white, alignment: .center)
    }

    private func drawPill(_ text: String, rect: NSRect, active: Bool) {
        (active ? NSColor(calibratedRed: 0.31, green: 0.19, blue: 0.62, alpha: 0.45) : NSColor.white.withAlphaComponent(0.06)).setFill()
        NSBezierPath(roundedRect: rect, xRadius: 12, yRadius: 12).fill()
        drawText(text, rect: NSRect(x: rect.minX, y: rect.minY + 6, width: rect.width, height: 13), size: 10, weight: .medium, color: NSColor.white.withAlphaComponent(0.80), alignment: .center)
    }

    private func drawAgentSwitch(in rect: NSRect) {
        NSColor.black.withAlphaComponent(0.22).setFill()
        NSBezierPath(roundedRect: rect, xRadius: 13.5, yRadius: 13.5).fill()
        let activeRect = selectedAgent == "codex"
            ? NSRect(x: rect.midX, y: rect.minY + 2, width: rect.width / 2 - 2, height: rect.height - 4)
            : NSRect(x: rect.minX + 2, y: rect.minY + 2, width: rect.width / 2 - 2, height: rect.height - 4)
        NSColor(calibratedRed: 0.40, green: 0.28, blue: 0.74, alpha: 0.65).setFill()
        NSBezierPath(roundedRect: activeRect, xRadius: 11.5, yRadius: 11.5).fill()
        NSColor.white.withAlphaComponent(0.08).setStroke()
        NSBezierPath(roundedRect: rect, xRadius: 13.5, yRadius: 13.5).stroke()
        drawText("Claude", rect: NSRect(x: rect.minX, y: rect.minY + 7, width: rect.width / 2, height: 12), size: 9.5, weight: .medium, color: NSColor.white.withAlphaComponent(selectedAgent == "claude-code" ? 0.92 : 0.52), alignment: .center)
        drawText("Codex", rect: NSRect(x: rect.midX, y: rect.minY + 7, width: rect.width / 2, height: 12), size: 9.5, weight: .medium, color: NSColor.white.withAlphaComponent(selectedAgent == "codex" ? 0.92 : 0.52), alignment: .center)
    }

    private func drawIconButton(_ text: String, rect: NSRect, active: Bool) {
        (active ? NSColor(calibratedRed: 0.31, green: 0.19, blue: 0.62, alpha: 0.55) : NSColor.white.withAlphaComponent(0.07)).setFill()
        NSBezierPath(ovalIn: rect).fill()
        NSColor.white.withAlphaComponent(active ? 0.12 : 0.08).setStroke()
        NSBezierPath(ovalIn: rect).stroke()
        drawText(text, rect: NSRect(x: rect.minX, y: rect.minY + 6, width: rect.width, height: 14), size: 12, weight: .semibold, color: NSColor.white.withAlphaComponent(0.82), alignment: .center)
    }

    private func drawFoldButton(in rect: NSRect) {
        drawIconButton(isExpanded ? "⌄" : "⌃", rect: foldButtonRect(in: rect), active: false)
    }

    private func foldButtonRect(in rect: NSRect? = nil) -> NSRect {
        let base = rect ?? bounds.insetBy(dx: 8, dy: 8)
        let y = base.minY + 96
        return NSRect(x: base.maxX - 38, y: y, width: 26, height: 26)
    }

    private func resizeWindowKeepingTopRight(_ size: NSSize) {
        guard let window else { return }
        let frame = window.frame
        let topRight = NSPoint(x: frame.maxX, y: frame.maxY)
        let next = NSRect(
            x: topRight.x - size.width,
            y: topRight.y - size.height,
            width: size.width,
            height: size.height
        )
        window.setFrame(next, display: true, animate: false)
    }

    private func drawText(_ text: String, rect: NSRect, size: CGFloat, weight: NSFont.Weight, color: NSColor, alignment: NSTextAlignment = .left) {
        let paragraph = NSMutableParagraphStyle()
        paragraph.alignment = alignment
        paragraph.lineBreakMode = .byTruncatingTail
        let attrs: [NSAttributedString.Key: Any] = [
            .font: NSFont.systemFont(ofSize: size, weight: weight),
            .foregroundColor: color,
            .paragraphStyle: paragraph,
        ]
        (text as NSString).draw(in: rect, withAttributes: attrs)
    }

    private func accentColor(remaining: Double?) -> NSColor {
        guard let remaining else { return NSColor.systemGray }
        if remaining < 20 { return NSColor.systemPink }
        if remaining < 45 { return NSColor.systemOrange }
        return NSColor.systemGreen
    }

    private func resetText(_ value: Double?) -> String {
        guard let value else { return "no reset time" }
        let diff = (value / 1000) - Date().timeIntervalSince1970
        if diff <= 0 { return "snapshot expired" }
        let hours = Int(diff) / 3600
        let minutes = (Int(diff) % 3600) / 60
        return hours > 0 ? "resets in \(hours)h \(minutes)m" : "resets in \(minutes)m"
    }

    private func toolName(_ value: String) -> String {
        if value == "claude-code" { return "Claude" }
        if value == "codex" { return "Codex" }
        if value == "cursor" { return "Cursor" }
        return value
    }

    private func selectedAgentLabel() -> String {
        selectedAgent == "claude-code" ? "Claude" : "Codex"
    }

    private func durationText(_ ms: Double) -> String {
        let seconds = max(0, Int(ms / 1000))
        let hours = seconds / 3600
        let minutes = (seconds % 3600) / 60
        if hours > 0 { return "\(hours)h \(minutes)m" }
        return "\(minutes)m"
    }
}

final class FloatingWindowController: NSObject, NSApplicationDelegate {
    private let pageURL: URL
    private let apiURL: URL
    private let importURL: URL
    private var panel: FloatingPanel?
    private var contentView: FloatView?
    private var timer: Timer?
    private var statusItem: NSStatusItem?

    init(pageURL: URL) {
        self.pageURL = pageURL
        var components = URLComponents(url: pageURL, resolvingAgainstBaseURL: false)!
        components.path = "/api/float"
        components.query = nil
        self.apiURL = components.url!
        components.path = "/api/import-sessions"
        self.importURL = components.url!
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        let panel = FloatingPanel(
            contentRect: NSRect(x: 0, y: 0, width: 112, height: 112),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.level = .statusBar
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
        panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false
        panel.isMovableByWindowBackground = true
        panel.backgroundColor = .clear
        panel.isOpaque = false
        panel.hasShadow = false
        panel.setFrameAutosaveName("VibemeterFloatingWindow")

        let view = FloatView(frame: panel.contentView?.bounds ?? NSRect(x: 0, y: 0, width: 112, height: 112))
        view.autoresizingMask = [.width, .height]
        view.wantsLayer = true
        view.layer?.backgroundColor = NSColor.clear.cgColor
        view.onRefresh = { [weak self] in self?.refreshNow(importFirst: true) }
        view.onHide = { [weak self] in self?.hidePanel() }
        view.onOpenDashboard = { [weak self] in
            guard let self else { return }
            NSWorkspace.shared.open(self.pageURL.deletingLastPathComponent())
        }

        setupStatusItem()
        panel.contentView = view
        placeAtTopRight(panel)
        panel.orderFrontRegardless()
        self.panel = panel
        self.contentView = view

        refreshNow(importFirst: true)
        timer = Timer.scheduledTimer(withTimeInterval: 20, repeats: true) { [weak self] _ in
            self?.refreshNow(importFirst: true)
        }
    }

    private func setupStatusItem() {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        item.button?.title = "Vibe"
        let menu = NSMenu()
        menu.addItem(withTitle: "Show Float", action: #selector(showPanelFromMenu), keyEquivalent: "s")
        menu.addItem(withTitle: "Refresh", action: #selector(refreshFromMenu), keyEquivalent: "r")
        menu.addItem(withTitle: "Open Dashboard", action: #selector(openDashboardFromMenu), keyEquivalent: "o")
        menu.addItem(NSMenuItem.separator())
        menu.addItem(withTitle: "Quit", action: #selector(quitFromMenu), keyEquivalent: "q")
        for item in menu.items { item.target = self }
        item.menu = menu
        statusItem = item
    }

    private func hidePanel() {
        panel?.orderOut(nil)
    }

    @objc private func showPanelFromMenu() {
        guard let panel else { return }
        if panel.frame.origin.x < 0 || panel.frame.origin.y < 0 {
            placeAtTopRight(panel)
        }
        panel.orderFrontRegardless()
    }

    @objc private func refreshFromMenu() {
        refreshNow(importFirst: true)
        showPanelFromMenu()
    }

    @objc private func openDashboardFromMenu() {
        NSWorkspace.shared.open(pageURL.deletingLastPathComponent())
    }

    @objc private func quitFromMenu() {
        NSApp.terminate(nil)
    }

    private func placeAtTopRight(_ panel: NSPanel) {
        let screen = NSScreen.main ?? NSScreen.screens.first
        guard let frame = screen?.visibleFrame else {
            panel.center()
            return
        }
        let margin: CGFloat = 18
        let origin = NSPoint(
            x: frame.maxX - panel.frame.width - margin,
            y: frame.maxY - panel.frame.height - margin
        )
        panel.setFrameOrigin(origin)
    }

    private func refreshNow(importFirst: Bool = false) {
        if importFirst {
            var request = URLRequest(url: importURL)
            request.httpMethod = "POST"
            URLSession.shared.dataTask(with: request) { [weak self] _, _, _ in
                self?.refreshNow()
            }.resume()
            return
        }

        URLSession.shared.dataTask(with: apiURL) { [weak self] data, _, _ in
            guard let self else { return }
            guard let data else {
                DispatchQueue.main.async {
                    self.contentView?.statusText = "api unavailable"
                    self.contentView?.needsDisplay = true
                }
                return
            }
            do {
                let stats = try JSONDecoder().decode(FloatStats.self, from: data)
                DispatchQueue.main.async {
                    self.contentView?.stats = stats
                    self.contentView?.statusText = stats.quotas.contains(where: { $0.agent == self.contentView?.selectedAgent }) ? "loaded" : "no snapshot"
                    self.contentView?.needsDisplay = true
                    self.updateStatusItem(stats)
                    if self.panel?.isVisible == true {
                        self.panel?.orderFrontRegardless()
                    }
                }
            } catch {
                DispatchQueue.main.async {
                    self.contentView?.statusText = "decode failed"
                    self.contentView?.needsDisplay = true
                }
            }
        }.resume()
    }

    private func updateStatusItem(_ stats: FloatStats) {
        let agent = contentView?.selectedAgent ?? "claude-code"
        let quota = stats.quotas.first(where: { $0.agent == agent })
        if let remaining = quota?.remaining5h {
            let prefix = agent == "claude-code" ? "C" : "X"
            statusItem?.button?.title = "\(prefix) \(Int(round(remaining)))%"
        } else {
            statusItem?.button?.title = "Vibe"
        }
    }
}

let urlString = CommandLine.arguments.dropFirst().first ?? "http://localhost:9527/float"
guard let url = URL(string: urlString) else {
    fputs("Invalid Vibemeter float URL: \(urlString)\n", stderr)
    exit(1)
}

let app = NSApplication.shared
let delegate = FloatingWindowController(pageURL: url)
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
