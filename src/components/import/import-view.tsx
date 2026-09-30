import { PageShell, PageHeader } from "@/components/ui/page-header";
import { cx } from "@/components/ui/cx";
import { importPage as t } from "@/lib/i18n/strings";

// /import — Frontend V1 unit 7B. Controlled reconstruction of the stored
// trade history, in the order the investor works through it: what the
// history holds now, which way to add to it, the chosen path, then the
// stock splits the position math applies. The page owns every piece of
// state and every procedure call; the components only present them.

export type ImportMode = "file" | "manual";

export function ImportLayout({
  history,
  mode,
  onMode,
  children,
  splits,
}: {
  history: React.ReactNode;
  mode: ImportMode;
  onMode: (mode: ImportMode) => void;
  children: React.ReactNode;
  splits: React.ReactNode;
}) {
  return (
    <PageShell width="narrow">
      <PageHeader title={t.title} description={t.description} />
      {history}
      <ModeChoice mode={mode} onMode={onMode} />
      {children}
      <div className="border-t border-rule pt-8">{splits}</div>
    </PageShell>
  );
}

// Two ways into the same history, not two quality levels.
function ModeChoice({ mode, onMode }: { mode: ImportMode; onMode: (mode: ImportMode) => void }) {
  const options: { value: ImportMode; label: string; hint: string }[] = [
    { value: "file", label: t.fileMode, hint: t.fileModeHint },
    { value: "manual", label: t.manualMode, hint: t.manualModeHint },
  ];
  return (
    <section aria-labelledby="mode-title" className="flex flex-col gap-3">
      <h2 id="mode-title" className="text-base font-semibold text-ink">
        {t.modeLabel}
      </h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {options.map((o) => {
          const selected = mode === o.value;
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={selected}
              onClick={() => onMode(o.value)}
              className={cx(
                "flex flex-col items-start gap-1 rounded-lg border px-4 py-3 text-start",
                selected ? "border-accent bg-surface ring-1 ring-accent" : "border-rule bg-surface hover:bg-surface-2"
              )}
            >
              <span className="text-sm font-semibold text-ink">{o.label}</span>
              <span className="text-xs text-ink-2">{o.hint}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
