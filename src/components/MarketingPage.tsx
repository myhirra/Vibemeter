import Image from 'next/image';

export function MarketingPage() {
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <section className="mx-auto grid min-h-screen max-w-6xl items-center gap-10 px-6 py-10 lg:grid-cols-[0.86fr_1.14fr]">
        <div>
          <p className="mb-3 text-xs font-medium uppercase tracking-[0.24em] text-violet-300">local-first AI coding meter</p>
          <h1 className="text-4xl font-semibold tracking-tight text-zinc-50 sm:text-5xl">Vibemeter</h1>
          <p className="mt-4 max-w-xl text-sm leading-7 text-zinc-400">
            A local dashboard and macOS floating widget for Claude Code, Codex, and Cursor sessions. Your data stays on your machine.
          </p>

          <div className="mt-7 rounded-lg border border-zinc-800 bg-zinc-900 p-4 font-mono">
            <p className="mb-2 text-xs uppercase tracking-wider text-zinc-500">one-command install</p>
            <code className="block overflow-x-auto whitespace-nowrap rounded-md bg-zinc-950 px-3 py-3 text-sm text-zinc-100">
              curl -fsSL https://vibemeter.siney.top/install.sh | bash
            </code>
          </div>

          <div className="mt-5 flex flex-wrap gap-3 text-xs text-zinc-400">
            <a className="rounded-full border border-violet-500/40 bg-violet-500/10 px-4 py-2 text-violet-100 transition-colors hover:bg-violet-500/20" href="/install.sh">
              install.sh
            </a>
            <a className="rounded-full border border-zinc-700 px-4 py-2 transition-colors hover:border-zinc-500 hover:text-zinc-100" href="https://github.com/myhirra/Vibemeter">
              GitHub
            </a>
            <a className="rounded-full border border-zinc-700 px-4 py-2 transition-colors hover:border-zinc-500 hover:text-zinc-100" href="https://www.npmjs.com/package/@hirra/vibemeter">
              npm
            </a>
          </div>
        </div>

        <div className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900 shadow-2xl shadow-black/50">
          <Image
            src="/demo1.png"
            alt="Vibemeter dashboard"
            width={1440}
            height={900}
            className="block aspect-[16/10] h-auto w-full object-cover object-left-top"
            priority
          />
        </div>
      </section>
    </main>
  );
}
