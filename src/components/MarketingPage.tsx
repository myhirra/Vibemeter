import Image from 'next/image';

const HIGHLIGHTS = [
  ['Quota runway', 'Claude Code and Codex 5h / 7-day windows, burn-rate, and reset visibility.'],
  ['Project cost context', 'Sessions, projects, spend, tokens, and activity history for client or project review.'],
  ['macOS helper', 'Floating meter and optional completion alerts when long-running agents finish.'],
];

const SOURCES = [
  '~/.claude/projects/**/*.jsonl',
  '~/.codex/state_5.sqlite',
  'Cursor workspaceStorage',
];

export function MarketingPage() {
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <section className="mx-auto grid max-w-6xl items-center gap-10 px-6 pb-8 pt-10 lg:min-h-[78vh] lg:grid-cols-[0.86fr_1.14fr]">
        <div className="min-w-0">
          <p className="mb-3 text-xs font-medium uppercase tracking-[0.24em] text-violet-300">AI coding quota runway</p>
          <h1 className="text-4xl font-semibold tracking-tight text-zinc-50 sm:text-5xl">Vibemeter</h1>
          <p className="mt-4 max-w-xl text-sm leading-7 text-zinc-400">
            Don’t let Claude Code or Codex hit limits mid-task. Vibemeter reads local files to show quota runway, burn-rate, a macOS floating meter, and completion alerts when long-running agents finish.
          </p>

          <ul className="mt-5 space-y-2 text-sm text-zinc-400">
            <li><span className="text-zinc-200">No cloud:</span> reads files already on your disk.</li>
            <li><span className="text-zinc-200">Runway view:</span> 5h / 7-day windows for Claude Code and Codex.</li>
            <li><span className="text-zinc-200">macOS helper:</span> floating meter plus optional spoken completion alerts.</li>
          </ul>

          <div className="mt-7 min-w-0 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900 p-4 font-mono">
            <p className="mb-2 text-xs uppercase tracking-wider text-zinc-500">one-command install</p>
            <code className="block whitespace-pre-wrap break-all rounded-md bg-zinc-950 px-3 py-3 text-sm text-zinc-100">
              curl -fsSL &apos;https://vibemeter.siney.top/install.sh?src=site-copy&apos; | bash
            </code>
          </div>

          <div className="mt-5 flex flex-wrap gap-3 text-xs text-zinc-400">
            <a className="rounded-full border border-violet-500/40 bg-violet-500/10 px-4 py-2 text-violet-100 transition-colors hover:bg-violet-500/20" href="/install.sh?src=site-button">
              install.sh
            </a>
            <a className="rounded-full border border-zinc-700 px-4 py-2 transition-colors hover:border-zinc-500 hover:text-zinc-100" href="https://www.npmjs.com/package/@hirra/vibemeter">
              npm
            </a>
          </div>
        </div>

        <div className="min-w-0 space-y-4">
          <Image
            src="/float-expanded.png"
            alt="Vibemeter expanded floating meter"
            width={520}
            height={360}
            className="mx-auto block h-auto w-full max-w-[420px] rounded-lg border border-zinc-800 bg-zinc-900 shadow-2xl shadow-black/50"
            priority
          />
          <Image
            src="/float-collapsed.png"
            alt="Vibemeter collapsed progress bar"
            width={520}
            height={260}
            className="mx-auto block h-auto w-full max-w-[420px] rounded-lg border border-zinc-800 bg-zinc-900"
          />
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-14">
        <div className="grid gap-3 md:grid-cols-3">
          {HIGHLIGHTS.map(([title, body]) => (
            <div key={title} className="rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-4">
              <h2 className="text-sm font-semibold text-zinc-100">{title}</h2>
              <p className="mt-2 text-xs leading-6 text-zinc-500">{body}</p>
            </div>
          ))}
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_0.72fr]">
          <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
            <h2 className="text-sm font-semibold text-zinc-100">Data stays local</h2>
            <p className="mt-2 text-xs leading-6 text-zinc-500">
              Vibemeter reads the files your tools already write. No account, no telemetry, no cloud database.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {SOURCES.map((source) => (
                <code key={source} className="rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-[11px] text-zinc-400">
                  {source}
                </code>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
            <h2 className="text-sm font-semibold text-zinc-100">Voice notifications</h2>
            <p className="mt-2 text-xs leading-6 text-zinc-500">
              On macOS, Vibemeter can install Claude Code hooks and Codex notify config, then speak when an agent finishes.
            </p>
            <a className="mt-4 inline-block rounded-md border border-zinc-700 px-3 py-2 text-xs text-zinc-300 transition-colors hover:border-zinc-500 hover:text-zinc-100" href="/settings">
              Settings
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}
