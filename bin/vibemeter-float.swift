import Cocoa
import Foundation
import UserNotifications

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
    let pace5hExhaustMin: Int?
    let pace5hPctPerMin: Double?
}

struct CodexAccountRef: Decodable {
    let accountId: String
    let label: String
    let isCurrent: Bool
}

struct LastSessionRef: Decodable {
    let id: String
    let tool: String
    let project: String
    let cwd: String?
    let title: String?
    let startedAt: Double
    let transcriptPath: String?
}

struct ToolCount: Decodable {
    let tool: String
    let count: Int
}

struct AgentSessionStats: Decodable {
    let agent: String
    let todaySessions: Int
    let totalSessions: Int
}

struct LastSession: Decodable {
    let id: String?
    let tool: String
    let project: String
    let cwd: String?
    let title: String?
    let startedAt: Double
    let transcriptPath: String?
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

struct RecentSession: Decodable {
    let id: String
    let tool: String
    let project: String
    let title: String?
    let startedAt: Double
    let endedAt: Double?
    let durationMs: Double
    let tokens: Int?
}

struct ProjectSummary: Decodable {
    let project: String
    let sessions: Int
    let durationMs: Double
    let tokens: Int?
    let tools: [ToolCount]
}

struct ActiveContext: Decodable {
    let sessionId: String
    let project: String
    let tokens: Int
    let limit: Int
    let pct: Int
    let capturedAt: Double
    let warning: Bool
}

struct FloatStats: Decodable {
    let generatedAt: Double
    let primary: FloatQuota?
    let quotas: [FloatQuota]
    let liveByAgent: [AgentLive]
    let recentSessions: [RecentSession]?
    let projectStats: [ProjectSummary]?
    let todaySessions: Int
    let totalSessions: Int
    let sessionStatsByAgent: [AgentSessionStats]?
    let todayByTool: [ToolCount]
    let lastSession: LastSession?
    let activeContext: ActiveContext?
    let pausedUntil: Double?
    let codexAccounts: [CodexAccountRef]?
}

private func menuBarRemainingPercentText(_ remaining: Double) -> String {
    let clamped = max(0, min(100, remaining))
    return "\(clamped >= 100 ? 100 : Int(floor(clamped)))%"
}

enum FloatLanguage: String {
    case zh
    case en

    static func normalize(_ value: String?) -> FloatLanguage? {
        guard let value else { return nil }
        if value == "en" { return .en }
        if value == "zh" { return .zh }
        return nil
    }

    static func from(url: URL) -> FloatLanguage? {
        URLComponents(url: url, resolvingAgainstBaseURL: false)?
            .queryItems?
            .first(where: { $0.name == "locale" })
            .flatMap { normalize($0.value) }
    }
}

private let floatCopy: [FloatLanguage: [String: String]] = [
    .zh: [
        "status.loading": "加载中",
        "status.apiUnavailable": "API 不可用",
        "status.noSnapshot": "暂无快照",
        "status.loaded": "已加载",
        "status.decodeFailed": "解析失败",
        "tooltip.noSnapshot": "暂无快照",
        "tooltip.noSnapshotYet": "还没有快照",
        "tooltip.left": "剩余",
        "window.noSnapshot": "暂无快照",
        "window.fiveHRemaining": "5h 剩余",
        "window.weeklyRemaining": "本周剩余",
        "window.noQuota": "暂无 quota",
        "action.muted": "已静音 · {n}m",
        "action.mute": "静音 30m",
        "action.dashboard": "仪表盘",
        "action.openLast": "打开上次",
        "action.openLastMissing": "已删除",
        "action.switchCodex": "切 Codex",
        "menu.collapse": "收起",
        "menu.expand": "展开",
        "menu.refresh": "刷新",
        "menu.openDashboard": "打开仪表盘",
        "menu.quitFloat": "退出 Vibemeter 浮窗",
        "menu.displayStyle": "显示样式",
        "menu.styleBall": "圆球",
        "menu.stylePill": "横条",
        "menu.showAgents": "显示 Agent",
        "menu.claudeOnly": "仅 Claude",
        "menu.codexOnly": "仅 Codex",
        "menu.both": "两者",
        "menu.showFloat": "显示浮窗",
        "menu.quit": "退出",
        "metric.today": "今天",
        "metric.total": "累计",
        "metric.weekly": "本周",
        "session.active": "活跃",
        "session.done": "完成",
        "session.latest": "最近",
        "session.noRecent": "没有最近的 {tool} 会话",
        "session.noRecentShort": "暂无最近会话",
        "footer.hint": "双击打开仪表盘 · 任意处拖拽",
        "context": "上下文",
        "reset.none": "无重置时间",
        "reset.expired": "快照已过期",
        "reset.in": "{time} 后重置",
        "pace.exhausts": "约 {n} 后耗尽",
    ],
    .en: [
        "status.loading": "loading",
        "status.apiUnavailable": "api unavailable",
        "status.noSnapshot": "no snapshot",
        "status.loaded": "loaded",
        "status.decodeFailed": "decode failed",
        "tooltip.noSnapshot": "no snapshot",
        "tooltip.noSnapshotYet": "no snapshot yet",
        "tooltip.left": "left",
        "window.noSnapshot": "no snapshot",
        "window.fiveHRemaining": "5h remaining",
        "window.weeklyRemaining": "weekly remaining",
        "window.noQuota": "no quota",
        "action.muted": "Muted · {n}m",
        "action.mute": "Mute 30m",
        "action.dashboard": "Dashboard",
        "action.openLast": "Open last",
        "action.openLastMissing": "Gone",
        "action.switchCodex": "Switch Codex",
        "menu.collapse": "Collapse",
        "menu.expand": "Expand",
        "menu.refresh": "Refresh",
        "menu.openDashboard": "Open Dashboard",
        "menu.quitFloat": "Quit Vibemeter Float",
        "menu.displayStyle": "Display Style",
        "menu.styleBall": "Ball",
        "menu.stylePill": "Pill (horizontal)",
        "menu.showAgents": "Show Agents",
        "menu.claudeOnly": "Claude only",
        "menu.codexOnly": "Codex only",
        "menu.both": "Both",
        "menu.showFloat": "Show Float",
        "menu.quit": "Quit",
        "metric.today": "today",
        "metric.total": "total",
        "metric.weekly": "weekly",
        "session.active": "active",
        "session.done": "done",
        "session.latest": "latest",
        "session.noRecent": "No recent {tool} session",
        "session.noRecentShort": "no recent session",
        "footer.hint": "double-click dashboard · drag anywhere",
        "context": "context",
        "reset.none": "no reset time",
        "reset.expired": "snapshot expired",
        "reset.in": "resets in {time}",
        "pace.exhausts": "exhausts in ~{n}",
    ],
]

final class FloatingPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}

final class FloatView: NSView {
    struct HitRects {
        var ring: NSRect = .zero
        var title: NSRect = .zero
        var refresh: [NSRect] = []
        var close: NSRect = .zero
        var openDashboard: NSRect = .zero
        var claudeToggle: NSRect = .zero
        var codexToggle: NSRect = .zero
        var pause: NSRect = .zero
        var openTranscript: NSRect = .zero
        var switchCodex: NSRect = .zero
    }

    static let displayStyleKey = "VMFloatDisplayStyle"
    static let agentDisplayKey = "VMFloatAgentDisplay"
    static let localeKey = "VMFloatLocale"

    var stats: FloatStats?
    var statusTextKey = "status.loading"
    // Transient override for the "打开上次" button label — the openLastTranscript
    // POST silently 404s when the recorded transcript file got cleaned up, so we
    // flash a "not found" label on the button itself for a couple seconds. Kept
    // separate from statusTextKey because that only shows when there's no quota
    // snapshot at all.
    var openLastFlashKey: String?
    private var openLastFlashTimer: Timer?
    var language: FloatLanguage = .zh
    var isExpanded = false
    var displayStyle = "ball"
    var agentDisplay = "claude-code"
    var onRefresh: (() -> Void)?
    var onOpenDashboard: (() -> Void)?
    var onHide: (() -> Void)?
    var onSettingsChanged: (() -> Void)?
    var onTogglePause: (() -> Void)?
    var onOpenLastTranscript: (() -> Void)?
    var onCycleCodex: (() -> Void)?
    private var dragMouseStart: NSPoint?
    private var dragWindowStart: NSPoint?
    private var didDrag = false
    private var hitRects = HitRects()

    override var isFlipped: Bool { true }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

    func loadSettings(defaultLanguage: FloatLanguage? = nil) {
        let defaults = UserDefaults.standard
        if let style = defaults.string(forKey: Self.displayStyleKey), style == "ball" || style == "pill" {
            displayStyle = style
        }
        if let agent = defaults.string(forKey: Self.agentDisplayKey),
           agent == "claude-code" || agent == "codex" || agent == "both" {
            agentDisplay = agent
        }
        _ = loadLocale(defaultLanguage: defaultLanguage)
    }

    @discardableResult
    func loadLocale(defaultLanguage: FloatLanguage? = nil) -> Bool {
        let next = FloatLanguage.normalize(UserDefaults.standard.string(forKey: Self.localeKey))
            ?? defaultLanguage
            ?? .zh
        let changed = next != language
        language = next
        return changed
    }

    func setStatus(_ key: String) {
        statusTextKey = key
    }

    func flashOpenLastLabel(_ key: String, durationSec: TimeInterval = 2.0) {
        openLastFlashKey = key
        openLastFlashTimer?.invalidate()
        openLastFlashTimer = Timer.scheduledTimer(withTimeInterval: durationSec, repeats: false) { [weak self] _ in
            self?.openLastFlashKey = nil
            self?.needsDisplay = true
        }
        needsDisplay = true
    }

    func tr(_ key: String, _ vars: [String: String] = [:]) -> String {
        var text = floatCopy[language]?[key] ?? floatCopy[.en]?[key] ?? key
        for (name, value) in vars {
            text = text.replacingOccurrences(of: "{\(name)}", with: value)
        }
        return text
    }

    /// Build a one-line hover tooltip like `Claude · 64% left · reset in 38m`
    /// using the same `quotaWindow` data the bubble already shows. Falls back
    /// to a short status string when no quota snapshot exists.
    func tooltipText() -> String {
        guard let stats else { return "Vibemeter · \(tr("tooltip.noSnapshot"))" }
        let agents = agentsToShow
        let parts: [String] = agents.compactMap { agent in
            let q = quota(for: agent)
            let window = quotaWindow(q)
            guard let remaining = window.remaining else { return nil }
            let pct = Int(floor(max(0, min(100, remaining))))
            let name = toolName(agent)
            let reset = resetText(window.resetAt)
            return "\(name) · \(pct)% \(tr("tooltip.left")) · \(reset)"
        }
        if parts.isEmpty {
            if stats.quotas.isEmpty { return "Vibemeter · \(tr("tooltip.noSnapshotYet"))" }
            return "Vibemeter · \(tr(statusTextKey))"
        }
        return parts.joined(separator: "\n")
    }

    func setDisplayStyle(_ value: String) {
        guard displayStyle != value else { return }
        displayStyle = value
        UserDefaults.standard.set(value, forKey: Self.displayStyleKey)
        onSettingsChanged?()
    }

    func setAgentDisplay(_ value: String) {
        guard agentDisplay != value else { return }
        agentDisplay = value
        UserDefaults.standard.set(value, forKey: Self.agentDisplayKey)
        onSettingsChanged?()
    }

    private var agentsToShow: [String] {
        if agentDisplay == "both" { return ["claude-code", "codex"] }
        return [agentDisplay]
    }

    private func quota(for agent: String) -> FloatQuota? {
        stats?.quotas.first(where: { $0.agent == agent })
    }

    private func quotaWindow(_ quota: FloatQuota?) -> (remaining: Double?, resetAt: Double?, label: String) {
        guard let quota else { return (nil, nil, tr("window.noSnapshot")) }
        if let five = quota.remaining5h {
            return normalizeWindow(remaining: five, resetAt: quota.resetAt5h, windowSeconds: 5 * 3600, label: tr("window.fiveHRemaining"))
        }
        if let weekly = quota.remainingWeekly {
            return normalizeWindow(remaining: weekly, resetAt: quota.resetAtWeekly, windowSeconds: 7 * 24 * 3600, label: tr("window.weeklyRemaining"))
        }
        return (nil, nil, tr("window.noQuota"))
    }

    private func normalizeWindow(remaining: Double, resetAt: Double?, windowSeconds: TimeInterval, label: String) -> (remaining: Double?, resetAt: Double?, label: String) {
        guard let resetAt else {
            return (max(0, min(100, remaining)), nil, label)
        }
        let nowMs = Date().timeIntervalSince1970 * 1000
        if resetAt <= nowMs {
            let windowMs = windowSeconds * 1000
            let elapsed = floor((nowMs - resetAt) / windowMs) + 1
            return (100, resetAt + elapsed * windowMs, label)
        }
        return (max(0, min(100, remaining)), resetAt, label)
    }

    private func remainingPercentText(_ remaining: Double?) -> String {
        guard let remaining else { return "--" }
        let clamped = max(0, min(100, remaining))
        return "\(clamped >= 100 ? 100 : Int(floor(clamped)))%"
    }

    private func live(for agent: String) -> AgentLive? {
        stats?.liveByAgent.first(where: { $0.agent == agent })
    }

    private func sessionStats(for agent: String) -> (today: Int, total: Int) {
        if agent == "both" {
            let claude = sessionStats(for: "claude-code")
            let codex = sessionStats(for: "codex")
            return (claude.today + codex.today, claude.total + codex.total)
        }

        if let byAgent = stats?.sessionStatsByAgent,
           let row = byAgent.first(where: { $0.agent == agent }) {
            return (row.todaySessions, row.totalSessions)
        }

        let today = stats?.todayByTool.first(where: { $0.tool == agent })?.count ?? 0
        return (today, stats?.totalSessions ?? 0)
    }

    private var focusAgent: String {
        if agentDisplay == "both" { return "claude-code" }
        return agentDisplay
    }

    func preferredSize() -> NSSize {
        if isExpanded {
            // 296 fits header + ring block + stats tiles + action row with a
            // comfortable bottom margin. 552 → 390 in dual mode mirrors the
            // same trim plus the +94 ring offset.
            return NSSize(width: 360, height: agentDisplay == "both" ? 390 : 296)
        }
        switch (displayStyle, agentDisplay) {
        case ("pill", "both"):
            return NSSize(width: 280, height: 96)
        case ("pill", _):
            return NSSize(width: 280, height: 56)
        case (_, "both"):
            return NSSize(width: 132, height: 220)
        default:
            return NSSize(width: 112, height: 112)
        }
    }

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        guard let context = NSGraphicsContext.current?.cgContext else { return }
        hitRects = HitRects()

        let rect = bounds.insetBy(dx: 8, dy: 8)
        drawPanel(in: rect)

        if !isExpanded {
            if displayStyle == "pill" {
                drawPillsCollapsed(context: context, in: rect)
            } else if agentDisplay == "both" {
                drawDualBallCollapsed(context: context, in: rect)
            } else {
                drawBallCollapsed(context: context, in: rect, agent: agentDisplay)
            }
            return
        }

        drawHeader(in: rect)
        if agentDisplay == "both" {
            drawRingBlock(context: context, in: rect, agent: "claude-code", yOffset: -8)
            drawRingBlock(context: context, in: rect, agent: "codex", yOffset: 86)
        } else {
            drawRingBlock(context: context, in: rect, agent: agentDisplay, yOffset: 0)
        }
        drawStats(in: rect)
        drawActions(in: rect)
    }

    private func drawActions(in rect: NSRect) {
        let dual = agentDisplay == "both"
        let offset: CGFloat = dual ? 94 : 0
        let y = rect.minY + 224 + offset
        var x = rect.minX + 20

        let paused = (stats?.pausedUntil ?? 0) > Date().timeIntervalSince1970 * 1000
        let pauseLabel: String
        if paused {
            let leftMs = (stats!.pausedUntil!) - Date().timeIntervalSince1970 * 1000
            let leftMin = max(0, Int((leftMs / 60_000).rounded()))
            pauseLabel = tr("action.muted", ["n": "\(leftMin)"])
        } else {
            pauseLabel = tr("action.mute")
        }
        let pauseRect = drawActionButton(label: pauseLabel, x: x, y: y, accent: paused)
        hitRects.pause = pauseRect
        x = pauseRect.maxX + 6

        let dashboardRect = drawActionButton(label: tr("action.dashboard"), x: x, y: y, accent: false)
        hitRects.openDashboard = dashboardRect
        x = dashboardRect.maxX + 6

        if let session = stats?.lastSession, let path = session.transcriptPath, !path.isEmpty {
            let openLabel = tr(openLastFlashKey ?? "action.openLast")
            let openRect = drawActionButton(label: openLabel, x: x, y: y, accent: false)
            hitRects.openTranscript = openRect
            x = openRect.maxX + 6
        }
        let showCodex = agentDisplay == "codex" || agentDisplay == "both"
        if showCodex, let accounts = stats?.codexAccounts, accounts.count >= 2 {
            let switchRect = drawActionButton(label: tr("action.switchCodex"), x: x, y: y, accent: false)
            hitRects.switchCodex = switchRect
        }
    }

    private func drawActionButton(label: String, x: CGFloat, y: CGFloat, accent: Bool) -> NSRect {
        let attrs: [NSAttributedString.Key: Any] = [
            .font: NSFont.systemFont(ofSize: 10, weight: .medium),
        ]
        let textSize = (label as NSString).size(withAttributes: attrs)
        let width = textSize.width + 16
        let height: CGFloat = 22
        let rect = NSRect(x: x, y: y, width: width, height: height)
        if accent {
            NSColor(calibratedRed: 0.62, green: 0.45, blue: 0.12, alpha: 0.42).setFill()
        } else {
            NSColor.white.withAlphaComponent(0.06).setFill()
        }
        NSBezierPath(roundedRect: rect, xRadius: 11, yRadius: 11).fill()
        (accent ? NSColor.systemYellow.withAlphaComponent(0.6) : NSColor.white.withAlphaComponent(0.10)).setStroke()
        NSBezierPath(roundedRect: rect, xRadius: 11, yRadius: 11).stroke()
        let textColor = accent ? NSColor.systemYellow : NSColor.white.withAlphaComponent(0.82)
        drawText(label, rect: NSRect(x: rect.minX, y: rect.minY + 5, width: rect.width, height: 14), size: 10, weight: .medium, color: textColor, alignment: .center)
        return rect
    }

    override func mouseDown(with event: NSEvent) {
        // Anchor the drag in screen coordinates so the reference frame doesn't
        // shift as the window moves (using locationInWindow caused jitter).
        dragMouseStart = NSEvent.mouseLocation
        dragWindowStart = window?.frame.origin
        didDrag = false
        if event.clickCount == 2 {
            onOpenDashboard?()
        }
    }

    override func mouseDragged(with event: NSEvent) {
        guard let window, let mouseStart = dragMouseStart, let windowStart = dragWindowStart else { return }
        let current = NSEvent.mouseLocation
        let dx = current.x - mouseStart.x
        let dy = current.y - mouseStart.y
        if abs(dx) > 2 || abs(dy) > 2 {
            didDrag = true
        }
        window.setFrameOrigin(NSPoint(x: windowStart.x + dx, y: windowStart.y + dy))
    }

    override func mouseUp(with event: NSEvent) {
        dragMouseStart = nil
        dragWindowStart = nil
        if didDrag { return }
        if event.clickCount != 1 { return }

        let point = convert(event.locationInWindow, from: nil)

        if hitRects.refresh.contains(where: { $0.contains(point) }) {
            onRefresh?()
            return
        }
        if isExpanded {
            if hitRects.close.contains(point) {
                onHide?()
                return
            }
            if hitRects.title.contains(point) {
                onOpenDashboard?()
                return
            }
            if hitRects.pause != .zero && hitRects.pause.contains(point) {
                onTogglePause?()
                return
            }
            if hitRects.openDashboard != .zero && hitRects.openDashboard.contains(point) {
                onOpenDashboard?()
                return
            }
            if hitRects.openTranscript != .zero && hitRects.openTranscript.contains(point) {
                onOpenLastTranscript?()
                return
            }
            if hitRects.switchCodex != .zero && hitRects.switchCodex.contains(point) {
                onCycleCodex?()
                return
            }
            if hitRects.claudeToggle != .zero && hitRects.claudeToggle.contains(point) {
                setAgentDisplay("claude-code")
                return
            }
            if hitRects.codexToggle != .zero && hitRects.codexToggle.contains(point) {
                setAgentDisplay("codex")
                return
            }
            if hitRects.ring != .zero && hitRects.ring.contains(point) {
                isExpanded = false
                applyWindowSize()
                toolTip = tooltipText()
                needsDisplay = true
                return
            }
            return
        }

        // collapsed: any click expands
        isExpanded = true
        applyWindowSize()
        toolTip = nil
        needsDisplay = true
    }

    override func rightMouseUp(with event: NSEvent) {
        let menu = NSMenu()
        let toggle = NSMenuItem(title: isExpanded ? tr("menu.collapse") : tr("menu.expand"), action: #selector(toggleFromMenu), keyEquivalent: "e")
        toggle.target = self
        menu.addItem(toggle)
        let refresh = NSMenuItem(title: tr("menu.refresh"), action: #selector(refreshFromMenu), keyEquivalent: "r")
        refresh.target = self
        menu.addItem(refresh)
        let dash = NSMenuItem(title: tr("menu.openDashboard"), action: #selector(openDashboardFromMenu), keyEquivalent: "o")
        dash.target = self
        menu.addItem(dash)
        menu.addItem(NSMenuItem.separator())
        menu.addItem(buildDisplayStyleMenuItem())
        menu.addItem(buildAgentDisplayMenuItem())
        menu.addItem(NSMenuItem.separator())
        let quit = NSMenuItem(title: tr("menu.quitFloat"), action: #selector(quitFromMenu), keyEquivalent: "q")
        quit.target = self
        menu.addItem(quit)
        NSMenu.popUpContextMenu(menu, with: event, for: self)
    }

    func buildDisplayStyleMenuItem() -> NSMenuItem {
        let item = NSMenuItem(title: tr("menu.displayStyle"), action: nil, keyEquivalent: "")
        let sub = NSMenu()
        for (title, value) in [(tr("menu.styleBall"), "ball"), (tr("menu.stylePill"), "pill")] {
            let mi = NSMenuItem(title: title, action: #selector(setDisplayStyleFromMenu(_:)), keyEquivalent: "")
            mi.target = self
            mi.representedObject = value
            mi.state = displayStyle == value ? .on : .off
            sub.addItem(mi)
        }
        item.submenu = sub
        return item
    }

    func buildAgentDisplayMenuItem() -> NSMenuItem {
        let item = NSMenuItem(title: tr("menu.showAgents"), action: nil, keyEquivalent: "")
        let sub = NSMenu()
        let options: [(String, String)] = [
            (tr("menu.claudeOnly"), "claude-code"),
            (tr("menu.codexOnly"), "codex"),
            (tr("menu.both"), "both"),
        ]
        for (title, value) in options {
            let mi = NSMenuItem(title: title, action: #selector(setAgentDisplayFromMenu(_:)), keyEquivalent: "")
            mi.target = self
            mi.representedObject = value
            mi.state = agentDisplay == value ? .on : .off
            sub.addItem(mi)
        }
        item.submenu = sub
        return item
    }

    @objc private func toggleFromMenu() {
        isExpanded.toggle()
        applyWindowSize()
        toolTip = isExpanded ? nil : tooltipText()
        needsDisplay = true
    }
    @objc private func refreshFromMenu() { onRefresh?() }
    @objc private func openDashboardFromMenu() { onOpenDashboard?() }
    @objc private func quitFromMenu() { NSApp.terminate(nil) }

    @objc private func setDisplayStyleFromMenu(_ sender: NSMenuItem) {
        guard let value = sender.representedObject as? String else { return }
        setDisplayStyle(value)
        applyWindowSize()
        needsDisplay = true
    }

    @objc private func setAgentDisplayFromMenu(_ sender: NSMenuItem) {
        guard let value = sender.representedObject as? String else { return }
        setAgentDisplay(value)
        applyWindowSize()
        needsDisplay = true
    }

    func applyWindowSize() {
        resizeWindowKeepingTopRight(preferredSize())
    }

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
        let title = NSRect(x: rect.minX + 20, y: rect.minY + 18, width: 94, height: 18)
        drawText("Vibemeter", rect: title, size: 13, weight: .semibold, color: NSColor.white.withAlphaComponent(0.94))
        hitRects.title = title

        if agentDisplay != "both" {
            let switchRect = NSRect(x: rect.maxX - 180, y: rect.minY + 10, width: 114, height: 27)
            drawAgentSwitch(in: switchRect)
            hitRects.claudeToggle = NSRect(x: switchRect.minX, y: switchRect.minY, width: switchRect.width / 2, height: switchRect.height)
            hitRects.codexToggle = NSRect(x: switchRect.midX, y: switchRect.minY, width: switchRect.width / 2, height: switchRect.height)
        }

        let refreshRect = NSRect(x: rect.maxX - 59, y: rect.minY + 10, width: 27, height: 27)
        drawIconButton("↻", rect: refreshRect, active: true)
        hitRects.refresh.append(refreshRect)

        let closeGlyph = NSRect(x: rect.maxX - 22, y: rect.minY + 14, width: 14, height: 16)
        drawText("×", rect: closeGlyph, size: 14, weight: .medium, color: NSColor.white.withAlphaComponent(0.54), alignment: .center)
        hitRects.close = closeGlyph.insetBy(dx: -8, dy: -6)
    }

    private func drawAgentSwitch(in rect: NSRect) {
        NSColor.black.withAlphaComponent(0.22).setFill()
        NSBezierPath(roundedRect: rect, xRadius: 13.5, yRadius: 13.5).fill()
        let isCodex = agentDisplay == "codex"
        let activeRect = isCodex
            ? NSRect(x: rect.midX, y: rect.minY + 2, width: rect.width / 2 - 2, height: rect.height - 4)
            : NSRect(x: rect.minX + 2, y: rect.minY + 2, width: rect.width / 2 - 2, height: rect.height - 4)
        NSColor(calibratedRed: 0.40, green: 0.28, blue: 0.74, alpha: 0.65).setFill()
        NSBezierPath(roundedRect: activeRect, xRadius: 11.5, yRadius: 11.5).fill()
        NSColor.white.withAlphaComponent(0.08).setStroke()
        NSBezierPath(roundedRect: rect, xRadius: 13.5, yRadius: 13.5).stroke()
        drawText("Claude", rect: NSRect(x: rect.minX, y: rect.minY + 7, width: rect.width / 2, height: 12), size: 9.5, weight: .medium, color: NSColor.white.withAlphaComponent(agentDisplay == "claude-code" ? 0.92 : 0.52), alignment: .center)
        drawText("Codex", rect: NSRect(x: rect.midX, y: rect.minY + 7, width: rect.width / 2, height: 12), size: 9.5, weight: .medium, color: NSColor.white.withAlphaComponent(isCodex ? 0.92 : 0.52), alignment: .center)
    }

    private func drawBallCollapsed(context: CGContext, in rect: NSRect, agent: String) {
        let q = quota(for: agent)
        let window = quotaWindow(q)
        let remaining = window.remaining
        let progress = CGFloat(max(0, min(100, remaining ?? 0)) / 100)
        let center = CGPoint(x: rect.midX, y: rect.midY)
        let radius: CGFloat = min(rect.width, rect.height) / 2 - 15
        let color = ringColor(for: agent, remaining: remaining)

        // Main quota ring (existing behavior).
        context.setLineWidth(8)
        context.setLineCap(.round)
        context.setStrokeColor(NSColor.white.withAlphaComponent(0.10).cgColor)
        context.addArc(center: center, radius: radius, startAngle: -.pi / 2, endAngle: 1.5 * .pi, clockwise: false)
        context.strokePath()

        context.setStrokeColor(color.cgColor)
        context.addArc(center: center, radius: radius, startAngle: -.pi / 2, endAngle: -.pi / 2 + progress * 2 * .pi, clockwise: false)
        context.strokePath()

        // 5h (or weekly) elapsed ring — thin outer ring just outside the main
        // ring. Fills clockwise as the reset window progresses.
        drawElapsedRing(context: context, center: center, radius: radius + 8, window: window, lineWidth: 1.5)

        let value = remainingPercentText(remaining)
        drawText(value, rect: NSRect(x: rect.minX + 12, y: center.y - 15, width: rect.width - 24, height: 30), size: 24, weight: .bold, color: .white, alignment: .center)
        hitRects.ring = rect
    }

    private func drawElapsedRing(context: CGContext, center: CGPoint, radius: CGFloat, window: (remaining: Double?, resetAt: Double?, label: String), lineWidth: CGFloat) {
        let now = Date().timeIntervalSince1970
        guard let resetAtMs = window.resetAt else { return }
        let resetAt = resetAtMs / 1000
        guard resetAt > now else { return }
        let windowSeconds: TimeInterval = window.label.hasPrefix("5h") ? 5 * 3600 : 7 * 24 * 3600
        let elapsedRatio = max(0, min(1, (windowSeconds - (resetAt - now)) / windowSeconds))
        context.saveGState()
        context.setLineWidth(lineWidth)
        context.setLineCap(.round)
        context.setStrokeColor(NSColor.white.withAlphaComponent(0.12).cgColor)
        context.addArc(center: center, radius: radius, startAngle: -.pi / 2, endAngle: 1.5 * .pi, clockwise: false)
        context.strokePath()
        if elapsedRatio > 0.005 {
            context.setStrokeColor(NSColor.white.withAlphaComponent(0.65).cgColor)
            context.addArc(center: center, radius: radius, startAngle: -.pi / 2, endAngle: -.pi / 2 + CGFloat(elapsedRatio) * 2 * .pi, clockwise: false)
            context.strokePath()
        }
        context.restoreGState()
    }

    private func drawDualBallCollapsed(context: CGContext, in rect: NSRect) {
        let half = rect.height / 2
        let topRect = NSRect(x: rect.minX, y: rect.minY, width: rect.width, height: half)
        let bottomRect = NSRect(x: rect.minX, y: rect.minY + half, width: rect.width, height: half)
        drawSmallBall(context: context, in: topRect, agent: "claude-code")
        drawSmallBall(context: context, in: bottomRect, agent: "codex")
        hitRects.ring = rect
    }

    private func drawSmallBall(context: CGContext, in rect: NSRect, agent: String) {
        let q = quota(for: agent)
        let window = quotaWindow(q)
        let remaining = window.remaining
        let progress = CGFloat(max(0, min(100, remaining ?? 0)) / 100)
        let center = CGPoint(x: rect.midX, y: rect.midY)
        let radius: CGFloat = min(rect.width, rect.height) / 2 - 14
        let color = ringColor(for: agent, remaining: remaining)

        context.setLineWidth(6)
        context.setLineCap(.round)
        context.setStrokeColor(NSColor.white.withAlphaComponent(0.10).cgColor)
        context.addArc(center: center, radius: radius, startAngle: -.pi / 2, endAngle: 1.5 * .pi, clockwise: false)
        context.strokePath()

        context.setStrokeColor(color.cgColor)
        context.addArc(center: center, radius: radius, startAngle: -.pi / 2, endAngle: -.pi / 2 + progress * 2 * .pi, clockwise: false)
        context.strokePath()

        drawElapsedRing(context: context, center: center, radius: radius + 6, window: window, lineWidth: 1.2)

        let value = remainingPercentText(remaining)
        drawText(value, rect: NSRect(x: rect.minX, y: center.y - 13, width: rect.width, height: 20), size: 15, weight: .bold, color: .white, alignment: .center)
        drawText(toolName(agent), rect: NSRect(x: rect.minX, y: center.y + 8, width: rect.width, height: 12), size: 9, weight: .semibold, color: NSColor.white.withAlphaComponent(0.55), alignment: .center)
    }

    private func drawPillsCollapsed(context: CGContext, in rect: NSRect) {
        let agents = agentsToShow
        let pillHeight: CGFloat = 36
        let gap: CGFloat = 8
        let count = CGFloat(agents.count)
        let totalHeight = count * pillHeight + max(0, count - 1) * gap
        let startY = rect.minY + (rect.height - totalHeight) / 2

        for (i, agent) in agents.enumerated() {
            let y = startY + CGFloat(i) * (pillHeight + gap)
            let pillRect = NSRect(x: rect.minX + 8, y: y, width: rect.width - 16, height: pillHeight)
            drawAgentPill(context: context, in: pillRect, agent: agent)
        }
        hitRects.ring = rect
    }

    private func drawAgentPill(context: CGContext, in rect: NSRect, agent: String) {
        let q = quota(for: agent)
        let window = quotaWindow(q)
        let remaining = window.remaining
        let color = ringColor(for: agent, remaining: remaining)

        let radius = rect.height / 2
        NSColor.black.withAlphaComponent(0.30).setFill()
        NSBezierPath(roundedRect: rect, xRadius: radius, yRadius: radius).fill()
        let stroke = NSBezierPath(roundedRect: rect, xRadius: radius, yRadius: radius)
        NSColor.white.withAlphaComponent(0.08).setStroke()
        stroke.lineWidth = 1
        stroke.stroke()

        let labelRect = NSRect(x: rect.minX + 14, y: rect.minY + 11, width: 52, height: 14)
        drawText(toolName(agent), rect: labelRect, size: 11, weight: .semibold, color: NSColor.white.withAlphaComponent(0.88))

        let pctText = remainingPercentText(remaining)
        let pctRect = NSRect(x: rect.minX + 66, y: rect.minY + 10, width: 38, height: 15)
        drawText(pctText, rect: pctRect, size: 12, weight: .bold, color: .white)

        let iconSize: CGFloat = 22
        let iconRect = NSRect(x: rect.maxX - iconSize - 8, y: rect.minY + (rect.height - iconSize) / 2, width: iconSize, height: iconSize)

        let barX = rect.minX + 108
        let barRight = iconRect.minX - 8
        let barWidth = max(0, barRight - barX)
        let barHeight: CGFloat = 8
        let barY = rect.minY + (rect.height - barHeight) / 2
        let trackRect = NSRect(x: barX, y: barY, width: barWidth, height: barHeight)
        NSColor.white.withAlphaComponent(0.10).setFill()
        NSBezierPath(roundedRect: trackRect, xRadius: barHeight / 2, yRadius: barHeight / 2).fill()
        let fillWidth = barWidth * CGFloat(max(0, min(100, remaining ?? 0)) / 100)
        if fillWidth > 0.5 {
            color.setFill()
            let fillRect = NSRect(x: barX, y: barY, width: fillWidth, height: barHeight)
            NSBezierPath(roundedRect: fillRect, xRadius: barHeight / 2, yRadius: barHeight / 2).fill()
        }

        // 5h (or weekly) elapsed ring around the refresh button — full ring
        // means the window is about to reset. Subtle white so the underlying
        // purple button stays the primary affordance. API timestamps are
        // milliseconds; convert before comparing.
        let now = Date().timeIntervalSince1970
        if let resetAtMs = window.resetAt {
            let resetAt = resetAtMs / 1000
            if resetAt > now {
            let windowSeconds: TimeInterval = window.label.hasPrefix("5h") ? 5 * 3600 : 7 * 24 * 3600
            let elapsedRatio = max(0, min(1, (windowSeconds - (resetAt - now)) / windowSeconds))
            let center = CGPoint(x: iconRect.midX, y: iconRect.midY)
            let ringRadius: CGFloat = iconRect.width / 2 + 2.5
            context.saveGState()
            context.setLineWidth(1.5)
            context.setLineCap(.round)
            context.setStrokeColor(NSColor.white.withAlphaComponent(0.10).cgColor)
            context.addArc(center: center, radius: ringRadius, startAngle: -.pi / 2, endAngle: 1.5 * .pi, clockwise: false)
            context.strokePath()
            if elapsedRatio > 0.005 {
                context.setStrokeColor(NSColor.white.withAlphaComponent(0.55).cgColor)
                context.addArc(center: center, radius: ringRadius, startAngle: -.pi / 2, endAngle: -.pi / 2 + CGFloat(elapsedRatio) * 2 * .pi, clockwise: false)
                context.strokePath()
            }
            context.restoreGState()
            }
        }

        drawIconButton("↻", rect: iconRect, active: true)
        hitRects.refresh.append(iconRect)
    }

    private func drawRingBlock(context: CGContext, in rect: NSRect, agent: String, yOffset: CGFloat) {
        let dual = agentDisplay == "both"
        let q = quota(for: agent)
        let window = quotaWindow(q)
        let remaining = window.remaining
        let progress = CGFloat(max(0, min(100, remaining ?? 0)) / 100)
        let center = CGPoint(x: rect.minX + 70, y: rect.minY + 99 + yOffset)
        let radius: CGFloat = dual ? 34 : 43
        let color = ringColor(for: agent, remaining: remaining)

        context.setLineWidth(dual ? 7 : 9)
        context.setLineCap(.round)
        context.setStrokeColor(NSColor.white.withAlphaComponent(0.10).cgColor)
        context.addArc(center: center, radius: radius, startAngle: -.pi / 2, endAngle: 1.5 * .pi, clockwise: false)
        context.strokePath()

        context.setStrokeColor(color.cgColor)
        context.addArc(center: center, radius: radius, startAngle: -.pi / 2, endAngle: -.pi / 2 + progress * 2 * .pi, clockwise: false)
        context.strokePath()

        let innerHalf: CGFloat = dual ? 26 : 34
        let inner = NSRect(x: center.x - innerHalf, y: center.y - innerHalf, width: innerHalf * 2, height: innerHalf * 2)
        NSColor(calibratedRed: 0.035, green: 0.037, blue: 0.045, alpha: 1).setFill()
        NSBezierPath(ovalIn: inner).fill()

        let value = remainingPercentText(remaining)
        let valueSize: CGFloat = dual ? 17 : 23
        drawText(value, rect: NSRect(x: center.x - 36, y: center.y - 13, width: 72, height: 26), size: valueSize, weight: .bold, color: .white, alignment: .center)

        let x = rect.minX + 134
        let textWidth = max(120, rect.maxX - x - 18)
        let hasPace = (q?.pace5hExhaustMin ?? 0) > 0
        let hasAccount = q?.accountLabel?.isEmpty == false && !dual
        let textBlockHeight: CGFloat = hasPace
            ? (dual ? 65 : 78)
            : (hasAccount ? 81 : (dual ? 51 : 62))
        let baseY = center.y - textBlockHeight / 2
        drawText(q?.label ?? toolName(agent), rect: NSRect(x: x, y: baseY, width: textWidth, height: 22), size: dual ? 14 : 18, weight: .semibold, color: .white)
        drawText(q == nil ? tr(statusTextKey) : window.label, rect: NSRect(x: x, y: baseY + (dual ? 18 : 25), width: textWidth, height: 16), size: 11, weight: .regular, color: NSColor.white.withAlphaComponent(0.46))
        drawText(resetText(window.resetAt), rect: NSRect(x: x, y: baseY + (dual ? 35 : 46), width: textWidth, height: 16), size: 11, weight: .regular, color: NSColor.white.withAlphaComponent(0.64))
        if let exhaust = q?.pace5hExhaustMin, exhaust > 0 {
            let paceColor = exhaust < 30 ? NSColor.systemPink : NSColor.systemYellow
            drawText(tr("pace.exhausts", ["n": paceText(exhaust)]), rect: NSRect(x: x, y: baseY + (dual ? 51 : 64), width: textWidth, height: 14), size: 10, weight: .medium, color: paceColor)
        } else if let account = q?.accountLabel, !account.isEmpty, !dual {
            drawText(account, rect: NSRect(x: x, y: baseY + 67, width: textWidth, height: 14), size: 10, weight: .regular, color: NSColor.white.withAlphaComponent(0.32))
        }

        if yOffset <= 0 {
            hitRects.ring = NSRect(x: center.x - radius - 8, y: center.y - radius - 8, width: radius * 2 + 16, height: radius * 2 + 16)
        }
    }

    private func drawStats(in rect: NSRect) {
        let dual = agentDisplay == "both"
        let offset: CGFloat = dual ? 94 : 0
        let top = rect.minY + 164 + offset
        let gap: CGFloat = 10
        let width = (rect.width - 40 - gap * 2) / 3
        let counts = sessionStats(for: dual ? "both" : focusAgent)
        drawMetric(title: tr("metric.today"), value: "\(counts.today)", rect: NSRect(x: rect.minX + 20, y: top, width: width, height: 50))
        drawMetric(title: tr("metric.total"), value: "\(counts.total)", rect: NSRect(x: rect.minX + 20 + width + gap, y: top, width: width, height: 50))
        let weeklyRect = NSRect(x: rect.minX + 20 + (width + gap) * 2, y: top, width: width, height: 50)
        if dual {
            drawDualWeekly(rect: weeklyRect)
        } else {
            let q = quota(for: focusAgent)
            // Reset countdown lives under the % so the user can answer "when
            // does this week refresh" without opening the dashboard. Falls back
            // to the title-only layout when there's no snapshot.
            let sub = q.flatMap { weeklyResetText($0.resetAtWeekly) }
            drawMetric(title: tr("metric.weekly"), value: remainingPercentText(q?.remainingWeekly), subtitle: sub, rect: weeklyRect)
        }
    }

    private func drawDualWeekly(rect: NSRect) {
        NSColor.black.withAlphaComponent(0.20).setFill()
        NSBezierPath(roundedRect: rect, xRadius: 14, yRadius: 14).fill()
        NSColor.white.withAlphaComponent(0.06).setStroke()
        NSBezierPath(roundedRect: rect, xRadius: 14, yRadius: 14).stroke()
        drawText(tr("metric.weekly"), rect: NSRect(x: rect.minX, y: rect.minY + 6, width: rect.width, height: 12), size: 9, weight: .medium, color: NSColor.white.withAlphaComponent(0.38), alignment: .center)
        let c = quota(for: "claude-code")?.remainingWeekly
        let x = quota(for: "codex")?.remainingWeekly
        let cText = "Claude \(remainingPercentText(c))"
        let xText = "Codex \(remainingPercentText(x))"
        drawText(cText, rect: NSRect(x: rect.minX, y: rect.minY + 22, width: rect.width, height: 13), size: 10, weight: .semibold, color: .white, alignment: .center)
        drawText(xText, rect: NSRect(x: rect.minX, y: rect.minY + 36, width: rect.width, height: 13), size: 10, weight: .semibold, color: NSColor(calibratedRed: 0.66, green: 0.39, blue: 0.95, alpha: 1), alignment: .center)
    }

    private func drawFooter(in rect: NSRect) {
        if agentDisplay == "both" {
            let topY = rect.maxY - 32
            let bottomY = rect.maxY - 16
            drawFooterLine(agent: "claude-code", rect: NSRect(x: rect.minX + 22, y: topY, width: rect.width - 44, height: 14))
            drawFooterLine(agent: "codex", rect: NSRect(x: rect.minX + 22, y: bottomY, width: rect.width - 44, height: 14))
            return
        }
        let l = live(for: focusAgent)
        let session = l?.activeSession ?? l?.recentSession
        let prefix = sessionPrefix(l?.state)
        let agentName = toolName(focusAgent)
        let line = session == nil
            ? tr("session.noRecent", ["tool": agentName])
            : "\(prefix) · \(session!.project) · \(durationText(session!.durationMs))"
        drawText(line, rect: NSRect(x: rect.minX + 22, y: rect.maxY - 32, width: rect.width - 74, height: 16), size: 11, weight: .medium, color: NSColor.white.withAlphaComponent(0.72))

        if focusAgent == "claude-code", let ctx = stats?.activeContext {
            drawContextBar(in: NSRect(x: rect.minX + 22, y: rect.maxY - 16, width: rect.width - 44, height: 12), ctx: ctx)
        } else if let title = session?.title, !title.isEmpty {
            drawText(title, rect: NSRect(x: rect.minX + 22, y: rect.maxY - 17, width: rect.width - 74, height: 14), size: 10, weight: .regular, color: NSColor.white.withAlphaComponent(0.38))
        } else {
            drawText(tr("footer.hint"), rect: NSRect(x: rect.minX + 22, y: rect.maxY - 17, width: rect.width - 74, height: 14), size: 10, weight: .regular, color: NSColor.white.withAlphaComponent(0.35))
        }
    }

    private func contextColor(pct: Int) -> NSColor {
        if pct >= 90 { return NSColor.systemPink }
        if pct >= 80 { return NSColor.systemOrange }
        if pct >= 60 { return NSColor(calibratedRed: 0.66, green: 0.39, blue: 0.95, alpha: 1) }
        return NSColor.systemGreen
    }

    private func formatTokens(_ n: Int) -> String {
        if n >= 1_000_000 { return String(format: "%.1fM", Double(n) / 1_000_000) }
        if n >= 1_000 { return "\(n / 1_000)k" }
        return String(n)
    }

    private func drawContextBar(in rect: NSRect, ctx: ActiveContext) {
        let labelRect = NSRect(x: rect.minX, y: rect.minY, width: 50, height: rect.height)
        drawText(tr("context"), rect: labelRect, size: 9, weight: .medium, color: NSColor.white.withAlphaComponent(0.50))

        let tokensText = "\(formatTokens(ctx.tokens))/\(formatTokens(ctx.limit))"
        let tokensWidth: CGFloat = 78
        let tokensRect = NSRect(x: rect.maxX - tokensWidth, y: rect.minY, width: tokensWidth, height: rect.height)
        let tokensColor = ctx.warning ? NSColor.systemOrange : NSColor.white.withAlphaComponent(0.62)
        drawText(tokensText, rect: tokensRect, size: 9, weight: .medium, color: tokensColor, alignment: .right)

        let barX = labelRect.maxX + 6
        let barRight = tokensRect.minX - 6
        let barWidth = max(0, barRight - barX)
        let barHeight: CGFloat = 5
        let barY = rect.minY + (rect.height - barHeight) / 2
        let trackRect = NSRect(x: barX, y: barY, width: barWidth, height: barHeight)
        NSColor.white.withAlphaComponent(0.10).setFill()
        NSBezierPath(roundedRect: trackRect, xRadius: barHeight / 2, yRadius: barHeight / 2).fill()
        let pct = max(0, min(100, ctx.pct))
        let fillWidth = barWidth * CGFloat(pct) / 100
        if fillWidth > 0.5 {
            contextColor(pct: pct).setFill()
            let fillRect = NSRect(x: barX, y: barY, width: fillWidth, height: barHeight)
            NSBezierPath(roundedRect: fillRect, xRadius: barHeight / 2, yRadius: barHeight / 2).fill()
        }
    }

    private func drawFooterLine(agent: String, rect: NSRect) {
        let l = live(for: agent)
        let session = l?.activeSession ?? l?.recentSession
        let prefix = sessionPrefix(l?.state)
        let name = toolName(agent)
        let line = session == nil
            ? "\(name) · \(tr("session.noRecentShort"))"
            : "\(name) · \(prefix) · \(session!.project) · \(durationText(session!.durationMs))"
        let labelColor = agent == "codex" ? NSColor(calibratedRed: 0.66, green: 0.39, blue: 0.95, alpha: 0.95) : NSColor.white.withAlphaComponent(0.72)
        drawText(line, rect: rect, size: 11, weight: .medium, color: labelColor)
    }

    private func sessionPrefix(_ state: String?) -> String {
        if state == "active" { return tr("session.active") }
        if state == "recent" { return tr("session.done") }
        return tr("session.latest")
    }

    private func drawMetric(title: String, value: String, subtitle: String? = nil, rect: NSRect) {
        NSColor.black.withAlphaComponent(0.20).setFill()
        NSBezierPath(roundedRect: rect, xRadius: 14, yRadius: 14).fill()
        NSColor.white.withAlphaComponent(0.06).setStroke()
        NSBezierPath(roundedRect: rect, xRadius: 14, yRadius: 14).stroke()
        let hasSub = subtitle != nil
        // Slide the title up a hair and shrink the value when a subtitle is
        // present, so the 50px tile still fits the third line without clipping.
        let titleY = hasSub ? rect.minY + 6 : rect.minY + 9
        let valueY = hasSub ? rect.minY + 20 : rect.minY + 25
        let valueSize: CGFloat = hasSub ? 13 : 15
        drawText(title, rect: NSRect(x: rect.minX, y: titleY, width: rect.width, height: 13), size: 9, weight: .medium, color: NSColor.white.withAlphaComponent(0.38), alignment: .center)
        drawText(value, rect: NSRect(x: rect.minX, y: valueY, width: rect.width, height: 18), size: valueSize, weight: .semibold, color: .white, alignment: .center)
        if let subtitle {
            drawText(subtitle, rect: NSRect(x: rect.minX, y: rect.minY + 36, width: rect.width, height: 11), size: 9, weight: .regular, color: NSColor.white.withAlphaComponent(0.38), alignment: .center)
        }
    }

    private func drawIconButton(_ text: String, rect: NSRect, active: Bool) {
        (active ? NSColor(calibratedRed: 0.31, green: 0.19, blue: 0.62, alpha: 0.55) : NSColor.white.withAlphaComponent(0.07)).setFill()
        NSBezierPath(ovalIn: rect).fill()
        NSColor.white.withAlphaComponent(active ? 0.12 : 0.08).setStroke()
        NSBezierPath(ovalIn: rect).stroke()
        let textY = rect.minY + (rect.height - 14) / 2
        drawText(text, rect: NSRect(x: rect.minX, y: textY, width: rect.width, height: 14), size: 12, weight: .semibold, color: NSColor.white.withAlphaComponent(0.82), alignment: .center)
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

    private func ringColor(for agent: String, remaining: Double?) -> NSColor {
        if agentDisplay == "both" && agent == "codex" {
            return NSColor(calibratedRed: 0.66, green: 0.39, blue: 0.95, alpha: 1)
        }
        return accentColor(remaining: remaining)
    }

    private func resetText(_ value: Double?) -> String {
        guard let value else { return tr("reset.none") }
        let diff = (value / 1000) - Date().timeIntervalSince1970
        if diff <= 0 { return tr("reset.expired") }
        let hours = Int(diff) / 3600
        let minutes = (Int(diff) % 3600) / 60
        let rel = hours > 0 ? "\(hours)h \(minutes)m" : "\(minutes)m"
        return tr("reset.in", ["time": rel])
    }

    private func paceText(_ minutes: Int) -> String {
        if minutes < 60 { return "\(minutes)m" }
        return "\(minutes / 60)h \(minutes % 60)m"
    }

    private func weeklyResetText(_ value: Double?) -> String? {
        guard let value else { return nil }
        let diff = (value / 1000) - Date().timeIntervalSince1970
        if diff <= 0 { return nil }
        let totalMinutes = Int(diff) / 60
        let days = totalMinutes / (24 * 60)
        let hours = (totalMinutes % (24 * 60)) / 60
        let minutes = totalMinutes % 60
        if days > 0 { return "\(days)d \(hours)h" }
        if hours > 0 { return "\(hours)h \(minutes)m" }
        return "\(minutes)m"
    }

    private func toolName(_ value: String) -> String {
        if value == "claude-code" { return "Claude" }
        if value == "codex" { return "Codex" }
        if value == "cursor" { return "Cursor" }
        return value
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
    private let initialLanguage: FloatLanguage?
    private let apiURL: URL
    private let importURL: URL
    private let pauseURL: URL
    private let openURL: URL
    private let codexAccountsURL: URL
    private var panel: FloatingPanel?
    private var contentView: FloatView?
    private var timer: Timer?
    private var statusItem: NSStatusItem?
    private var refreshInFlight = false

    init(pageURL: URL) {
        self.pageURL = pageURL
        let language = FloatLanguage.from(url: pageURL)
        self.initialLanguage = language
        if let language {
            UserDefaults.standard.set(language.rawValue, forKey: FloatView.localeKey)
        }
        var components = URLComponents(url: pageURL, resolvingAgainstBaseURL: false)!
        components.path = "/api/float"
        components.query = nil
        self.apiURL = components.url!
        components.path = "/api/import-sessions"
        self.importURL = components.url!
        components.path = "/api/pause"
        self.pauseURL = components.url!
        components.path = "/api/open"
        self.openURL = components.url!
        components.path = "/api/codex-accounts"
        self.codexAccountsURL = components.url!
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        let view = FloatView(frame: NSRect(x: 0, y: 0, width: 112, height: 112))
        view.loadSettings(defaultLanguage: initialLanguage)
        let initial = view.preferredSize()

        let panel = FloatingPanel(
            contentRect: NSRect(x: 0, y: 0, width: initial.width, height: initial.height),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.level = .statusBar
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
        panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false
        // Dragging is handled manually in FloatView.mouseDragged; leaving the
        // system mover on too makes both fight over the frame and flicker.
        panel.isMovableByWindowBackground = false
        panel.backgroundColor = .clear
        panel.isOpaque = false
        panel.hasShadow = false
        panel.setFrameAutosaveName("VibemeterFloatingWindow")

        view.frame = panel.contentView?.bounds ?? NSRect(origin: .zero, size: initial)
        view.autoresizingMask = [.width, .height]
        view.wantsLayer = true
        view.layer?.backgroundColor = NSColor.clear.cgColor
        view.onRefresh = { [weak self] in self?.refreshNow() }
        view.onSettingsChanged = { [weak self] in
            self?.refreshNow()
            self?.rebuildStatusMenu()
        }
        view.onHide = { [weak self] in self?.hidePanel() }
        view.onOpenDashboard = { [weak self] in
            guard let self else { return }
            NSWorkspace.shared.open(self.pageURL.deletingLastPathComponent())
        }
        view.onTogglePause = { [weak self] in self?.togglePause() }
        view.onOpenLastTranscript = { [weak self] in self?.openLastTranscript() }
        view.onCycleCodex = { [weak self] in self?.cycleCodex() }

        panel.contentView = view
        placeAtTopRight(panel)
        panel.orderFrontRegardless()
        self.panel = panel
        self.contentView = view
        setupStatusItem(initialView: view)

        refreshNow()
        timer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in
            self?.refreshNow()
        }
        setupWakeObservers()
    }

    /// After display wake / session unlock, the 5s polling timer can be late by
    /// up to a full interval and the data shown is stale (often pre-sleep). Force
    /// an immediate refresh whenever the system reports wake/unlock so the
    /// widget catches up the moment the user is looking at it again.
    private func setupWakeObservers() {
        let ws = NSWorkspace.shared.notificationCenter
        ws.addObserver(forName: NSWorkspace.didWakeNotification, object: nil, queue: .main) { [weak self] _ in
            self?.refreshNow()
        }
        ws.addObserver(forName: NSWorkspace.screensDidWakeNotification, object: nil, queue: .main) { [weak self] _ in
            self?.refreshNow()
        }
        ws.addObserver(forName: NSWorkspace.sessionDidBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            self?.refreshNow()
        }
        // Lock-screen unlock fires here even when sleep/wake doesn't.
        DistributedNotificationCenter.default().addObserver(
            forName: Notification.Name("com.apple.screenIsUnlocked"),
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.refreshNow()
        }
        // Display config changed (monitor plugged/unplugged, resolution
        // change). If the bubble's last frame is now off every screen, drag
        // it back to the main display.
        NotificationCenter.default.addObserver(
            forName: NSApplication.didChangeScreenParametersNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.ensurePanelOnScreen()
        }
        // The CLI singleton path (`vibemeter float` while already running)
        // calls `existing.activate()` and exits. Use the resulting
        // didBecomeActive to also rescue an off-screen panel — otherwise the
        // user sees "already running — focused" but no bubble.
        NotificationCenter.default.addObserver(
            forName: NSApplication.didBecomeActiveNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.ensurePanelOnScreen()
        }
    }

    private func setupStatusItem(initialView: FloatView) {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        item.button?.title = "Vibe"
        statusItem = item
        rebuildStatusMenu()
    }

    private func rebuildStatusMenu() {
        guard let statusItem else { return }
        let menu = NSMenu()
        let show = NSMenuItem(title: menuText("menu.showFloat"), action: #selector(showPanelFromMenu), keyEquivalent: "s")
        show.target = self
        menu.addItem(show)
        let refresh = NSMenuItem(title: menuText("menu.refresh"), action: #selector(refreshFromMenu), keyEquivalent: "r")
        refresh.target = self
        menu.addItem(refresh)
        let dash = NSMenuItem(title: menuText("menu.openDashboard"), action: #selector(openDashboardFromMenu), keyEquivalent: "o")
        dash.target = self
        menu.addItem(dash)
        menu.addItem(NSMenuItem.separator())
        if let view = contentView {
            menu.addItem(view.buildDisplayStyleMenuItem())
            menu.addItem(view.buildAgentDisplayMenuItem())
            menu.addItem(NSMenuItem.separator())
        }
        let quit = NSMenuItem(title: menuText("menu.quit"), action: #selector(quitFromMenu), keyEquivalent: "q")
        quit.target = self
        menu.addItem(quit)
        statusItem.menu = menu
    }

    private func menuText(_ key: String) -> String {
        contentView?.tr(key) ?? floatCopy[.zh]?[key] ?? floatCopy[.en]?[key] ?? key
    }

    private func syncLocaleFromDefaults() {
        guard let view = contentView else { return }
        if view.loadLocale(defaultLanguage: initialLanguage) {
            rebuildStatusMenu()
            view.toolTip = view.isExpanded ? nil : view.tooltipText()
            view.needsDisplay = true
        }
    }

    private func hidePanel() {
        panel?.orderOut(nil)
    }

    @objc private func showPanelFromMenu() {
        guard let panel else { return }
        if !isPanelOnAnyScreen(panel) {
            placeAtTopRight(panel)
        }
        panel.orderFrontRegardless()
        refreshNow()
    }

    /// Returns true iff the panel rect overlaps any current screen's visible
    /// area by at least `minOverlap` pixels in both dimensions. The
    /// `origin.x < 0 || origin.y < 0` check this replaces missed the common
    /// case where the user had dragged the bubble onto a secondary display
    /// that was later disconnected — the saved frame stays at e.g. x=1740
    /// on a 1680-wide main display and the bubble is invisible.
    private func isPanelOnAnyScreen(_ panel: NSPanel) -> Bool {
        let minOverlap: CGFloat = 24
        let frame = panel.frame
        for screen in NSScreen.screens {
            let hit = frame.intersection(screen.visibleFrame)
            if hit.width >= minOverlap && hit.height >= minOverlap {
                return true
            }
        }
        return false
    }

    private func ensurePanelOnScreen() {
        guard let panel else { return }
        if !isPanelOnAnyScreen(panel) {
            placeAtTopRight(panel)
            panel.orderFrontRegardless()
        }
    }

    @objc private func refreshFromMenu() {
        refreshNow()
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

    private func togglePause() {
        let stats = contentView?.stats
        let nowMs = Date().timeIntervalSince1970 * 1000
        let paused = (stats?.pausedUntil ?? 0) > nowMs
        var request = URLRequest(url: pauseURL)
        request.httpMethod = paused ? "DELETE" : "POST"
        if !paused {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = "{\"minutes\":30}".data(using: .utf8)
        }
        URLSession.shared.dataTask(with: request) { [weak self] _, _, _ in
            DispatchQueue.main.async { self?.refreshNow() }
        }.resume()
    }

    private func openLastTranscript() {
        guard let path = contentView?.stats?.lastSession?.transcriptPath, !path.isEmpty else { return }
        var request = URLRequest(url: openURL)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let body: [String: String] = ["path": path]
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        URLSession.shared.dataTask(with: request) { [weak self] _, response, error in
            // Surface failures in the button itself — silent failures here are
            // confusing because pressing the button can do nothing visible:
            // /api/open 404s when Claude Code has rotated the transcript file
            // off disk, and macOS may have no `.jsonl` handler either.
            let code = (response as? HTTPURLResponse)?.statusCode ?? 0
            let ok = error == nil && (200...299).contains(code)
            if !ok {
                DispatchQueue.main.async {
                    self?.contentView?.flashOpenLastLabel("action.openLastMissing")
                }
            }
        }.resume()
    }

    private func cycleCodex() {
        guard let accounts = contentView?.stats?.codexAccounts, accounts.count >= 2 else { return }
        let currentIdx = accounts.firstIndex(where: { $0.isCurrent }) ?? 0
        let next = accounts[(currentIdx + 1) % accounts.count]
        var request = URLRequest(url: codexAccountsURL)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let body: [String: String] = ["action": "switch", "accountId": next.accountId]
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        URLSession.shared.dataTask(with: request) { [weak self] _, _, _ in
            DispatchQueue.main.async { self?.refreshNow() }
        }.resume()
    }

    private func refreshNow() {
        syncLocaleFromDefaults()
        if refreshInFlight { return }
        refreshInFlight = true

        var components = URLComponents(url: apiURL, resolvingAgainstBaseURL: false)!
        components.queryItems = [
            URLQueryItem(name: "refresh", value: "usage"),
            URLQueryItem(name: "t", value: "\(Int(Date().timeIntervalSince1970 * 1000))"),
        ]
        var request = URLRequest(url: components.url!)
        request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData

        URLSession.shared.dataTask(with: request) { [weak self] data, _, _ in
            guard let self else { return }
            defer {
                DispatchQueue.main.async {
                    self.refreshInFlight = false
                }
            }
            guard let data else {
                DispatchQueue.main.async {
                    self.contentView?.setStatus("status.apiUnavailable")
                    self.contentView?.needsDisplay = true
                }
                return
            }
            do {
                let stats = try JSONDecoder().decode(FloatStats.self, from: data)
                DispatchQueue.main.async {
                    self.syncLocaleFromDefaults()
                    self.contentView?.stats = stats
                    self.contentView?.setStatus(stats.quotas.isEmpty ? "status.noSnapshot" : "status.loaded")
                    // Hover tooltip — only the collapsed bubble needs it. In
                    // the expanded popover all that info is already on screen,
                    // so the tooltip overlapping the Dashboard button is just
                    // noise.
                    self.contentView?.toolTip = (self.contentView?.isExpanded == true)
                        ? nil
                        : self.contentView?.tooltipText()
                    self.contentView?.needsDisplay = true
                    self.updateStatusItem(stats)
                    if self.panel?.isVisible == true {
                        self.panel?.orderFrontRegardless()
                    }
                }
            } catch {
                DispatchQueue.main.async {
                    self.contentView?.setStatus("status.decodeFailed")
                    self.contentView?.needsDisplay = true
                }
            }
        }.resume()
    }

    private func updateStatusItem(_ stats: FloatStats) {
        guard let view = contentView else { return }
        if view.agentDisplay == "both" {
            let c = stats.quotas.first(where: { $0.agent == "claude-code" })?.remaining5h
            let x = stats.quotas.first(where: { $0.agent == "codex" })?.remaining5h
            switch (c, x) {
            case let (cv?, xv?):
                statusItem?.button?.title = "C \(menuBarRemainingPercentText(cv)) · X \(menuBarRemainingPercentText(xv))"
            case let (cv?, nil):
                statusItem?.button?.title = "C \(menuBarRemainingPercentText(cv))"
            case let (nil, xv?):
                statusItem?.button?.title = "X \(menuBarRemainingPercentText(xv))"
            default:
                statusItem?.button?.title = "Vibe"
            }
        } else {
            let agent = view.agentDisplay
            let remaining = stats.quotas.first(where: { $0.agent == agent })?.remaining5h
            if let remaining {
                let prefix = agent == "claude-code" ? "C" : "X"
                statusItem?.button?.title = "\(prefix) \(menuBarRemainingPercentText(remaining))"
            } else {
                statusItem?.button?.title = "Vibe"
            }
        }
    }
}

// ── --notify mode ────────────────────────────────────────────────────────
// Usage: Vibemeter --notify "<title>" "<body>" ["<thread-id>"]
// Posts a native UNUserNotificationCenter banner from the Vibemeter bundle
// and exits. Because this binary lives inside Vibemeter.app, the system can
// resolve our CFBundleIdentifier and accept the request — a plain `swiftc`
// output without a bundle would be silently dropped.
func runNotifyMode(title: String, body: String, threadId: String?) -> Never {
    let center = UNUserNotificationCenter.current()
    let group = DispatchGroup()

    var deliveryFinished = false

    group.enter()
    center.requestAuthorization(options: [.alert, .sound]) { _, _ in
        let content = UNMutableNotificationContent()
        content.title = title
        if !body.isEmpty { content.body = body }
        if let threadId, !threadId.isEmpty { content.threadIdentifier = threadId }

        let request = UNNotificationRequest(
            identifier: "vibemeter-notify-\(Int(Date().timeIntervalSince1970 * 1000))",
            content: content,
            trigger: nil
        )
        center.add(request) { _ in
            deliveryFinished = true
            group.leave()
        }
    }

    // Allow the request to be delivered; exit even if authorization is denied
    // so the calling hook doesn't block forever.
    _ = group.wait(timeout: .now() + 2.0)
    if !deliveryFinished {
        fputs("Vibemeter notify: authorization or delivery timeout\n", stderr)
        exit(2)
    }
    // Give the notification system a brief moment to enqueue before we tear
    // down — exiting too fast occasionally drops the banner.
    Thread.sleep(forTimeInterval: 0.15)
    exit(0)
}

let rawArgs = Array(CommandLine.arguments.dropFirst())
if let first = rawArgs.first, first == "--notify" {
    let title = rawArgs.count > 1 ? rawArgs[1] : "Vibemeter"
    let body = rawArgs.count > 2 ? rawArgs[2] : ""
    let threadId = rawArgs.count > 3 ? rawArgs[3] : nil
    runNotifyMode(title: title, body: body, threadId: threadId)
}

// Singleton: if another Vibemeter floater is already running, focus it and
// exit. Without this, repeated `vibemeter float` (e.g. by the autostart
// LaunchAgent + a manual run) would stack multiple windows.
let bundleId = Bundle.main.bundleIdentifier ?? "com.hirra.vibemeter"
let myPid = ProcessInfo.processInfo.processIdentifier
let peers = NSRunningApplication.runningApplications(withBundleIdentifier: bundleId)
    .filter { $0.processIdentifier != myPid }
if let existing = peers.first {
    if #available(macOS 14.0, *) {
        existing.activate()
    } else {
        existing.activate(options: [.activateIgnoringOtherApps])
    }
    exit(0)
}

let urlString = rawArgs.first ?? "http://localhost:9527/float"
guard let url = URL(string: urlString) else {
    fputs("Invalid Vibemeter float URL: \(urlString)\n", stderr)
    exit(1)
}

let app = NSApplication.shared
let delegate = FloatingWindowController(pageURL: url)
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
