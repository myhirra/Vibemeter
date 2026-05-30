'use client';

import { useEffect, useMemo, useState } from 'react';
import type { RecapCardData, RecapHeroKind, RecapPeriod, RecapStyle, RecapVariant } from '@/lib/recap-card';
import { availableHeroAngles, recapDimensions, renderRecapSvg } from '@/lib/recap-card-render';
import { useLocale, useT } from '@/lib/i18n/client';
import type { Locale } from '@/lib/i18n';

type Status = 'idle' | 'rendering' | 'ready' | 'error';

interface GeneratedVariant {
  blob: Blob;
  url: string;
}

interface GeneratedCards {
  landscape: GeneratedVariant;
  square: GeneratedVariant;
  /** Which angle this batch of PNGs was rendered with (so we can label the UI). */
  hero: RecapHeroKind;
  /** Which visual style was used (classic single-hero vs 2x2 grid). */
  style: RecapStyle;
}

interface Props {
  card?: RecapCardData;
  today?: RecapCardData;
  weekly?: RecapCardData;
  monthly?: RecapCardData;
  compact?: boolean;
  period?: RecapPeriod;
  onPeriodChange?: (period: RecapPeriod) => void;
}

const ANGLE_LABEL_KEYS: Record<RecapHeroKind, string> = {
  roi: 'recap.angle.roi',
  value: 'recap.angle.value',
  tokens: 'recap.angle.tokens',
  cache: 'recap.angle.cache',
  sessions: 'recap.angle.sessions',
  not_enough_data: 'recap.angle.none',
};

function filename(period: RecapPeriod, variant: RecapVariant, hero: RecapHeroKind, style: RecapStyle): string {
  const dim = recapDimensions(variant);
  const stamp = new Date().toISOString().slice(0, 10);
  const heroSuffix = style === 'hero' && hero && hero !== 'not_enough_data' ? `-${hero}` : '';
  const styleSuffix = style === 'grid' ? '-grid' : '';
  return `vibemeter-recap-${period}${styleSuffix}${heroSuffix}-${dim.width}x${dim.height}-${stamp}.png`;
}

function renderPng(card: RecapCardData, variant: RecapVariant, hero: RecapHeroKind, style: RecapStyle, locale: Locale): Promise<Blob> {
  const dim = recapDimensions(variant);
  const svg = renderRecapSvg(card, variant, { heroOverride: hero, style, locale });
  const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const svgUrl = URL.createObjectURL(svgBlob);

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = dim.width;
        canvas.height = dim.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('canvas unavailable');
        ctx.drawImage(img, 0, 0, dim.width, dim.height);
        canvas.toBlob((blob) => {
          URL.revokeObjectURL(svgUrl);
          if (!blob) reject(new Error('PNG render failed'));
          else resolve(blob);
        }, 'image/png');
      } catch (error) {
        URL.revokeObjectURL(svgUrl);
        reject(error);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(svgUrl);
      reject(new Error('SVG render failed'));
    };
    img.src = svgUrl;
  });
}

function revoke(cards: GeneratedCards | null) {
  if (!cards) return;
  URL.revokeObjectURL(cards.landscape.url);
  URL.revokeObjectURL(cards.square.url);
}

function cardForPeriod(
  cards: { today?: RecapCardData; weekly?: RecapCardData; monthly?: RecapCardData },
  period: RecapPeriod,
): RecapCardData | null {
  if (period === 'today') return cards.today ?? null;
  if (period === '7d') return cards.weekly ?? null;
  return cards.monthly ?? null;
}

export function RecapShareButton({ card: fixedCard, today, weekly, monthly, compact = false, period: controlledPeriod, onPeriodChange }: Props) {
  const t = useT();
  const locale = useLocale();
  // Default to the natural sharing cadence ('7d'); Dashboard can also pin the
  // card to its current filter and bypass the local period picker entirely.
  const [internalPeriod, setInternalPeriod] = useState<RecapPeriod>('7d');
  const [style, setStyle] = useState<RecapStyle>('hero');
  const [status, setStatus] = useState<Status>('idle');
  const [generated, setGenerated] = useState<GeneratedCards | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const period = controlledPeriod ?? internalPeriod;
  const card = fixedCard ?? cardForPeriod({ today, weekly, monthly }, period);
  const showPeriodPicker = !fixedCard && !compact;

  // Available hero angles for the active card, in a stable order. Used both by
  // the "different angle" cycler and by the radio-chip UI under the preview.
  const angles = useMemo(() => card ? availableHeroAngles(card) : [], [card]);
  const [heroOverride, setHeroOverride] = useState<RecapHeroKind | null>(null);
  // If the user switches periods the previous angle override might no longer
  // make sense for the new card. We resolve the effective hero at render time
  // (no effect needed) so a stale override silently falls back to the card's
  // natural hero kind.
  const activeHero: RecapHeroKind = card && heroOverride && angles.includes(heroOverride) ? heroOverride : card?.heroKind ?? 'not_enough_data';

  const nativeShareSupported = useMemo(() => {
    if (typeof navigator === 'undefined') return false;
    return typeof navigator.share === 'function';
  }, []);

  useEffect(() => () => revoke(generated), [generated]);

  function selectPeriod(next: RecapPeriod) {
    if (next === period) return;
    setHeroOverride(null);
    if (generated) {
      revoke(generated);
      setGenerated(null);
      setStatus('idle');
      setMessage(null);
    }
    if (onPeriodChange) onPeriodChange(next);
    else setInternalPeriod(next);
  }

  async function generate(overrideHero?: RecapHeroKind, overrideStyle?: RecapStyle) {
    if (!card) return;
    setStatus('rendering');
    setMessage(null);
    const heroToUse = overrideHero ?? activeHero;
    const styleToUse = overrideStyle ?? style;
    try {
      revoke(generated);
      const [landscapeBlob, squareBlob] = await Promise.all([
        renderPng(card, 'landscape', heroToUse, styleToUse, locale),
        renderPng(card, 'square', heroToUse, styleToUse, locale),
      ]);
      setGenerated({
        landscape: { blob: landscapeBlob, url: URL.createObjectURL(landscapeBlob) },
        square: { blob: squareBlob, url: URL.createObjectURL(squareBlob) },
        hero: heroToUse,
        style: styleToUse,
      });
      setStatus('ready');
    } catch (error) {
      console.error(error);
      setStatus('error');
    }
  }

  async function selectAngle(next: RecapHeroKind) {
    setHeroOverride(next);
    if (status === 'ready') {
      await generate(next);
    }
  }

  async function selectStyle(next: RecapStyle) {
    setStyle(next);
    if (status === 'ready') {
      await generate(undefined, next);
    }
  }

  async function cycleAngle() {
    if (angles.length <= 1) return;
    const current = activeHero;
    const idx = angles.indexOf(current);
    const next = angles[(idx + 1) % angles.length];
    await selectAngle(next);
  }

  async function copyImage() {
    if (!generated) return;
    try {
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': generated.landscape.blob }),
      ]);
      setMessage(t('recap.action.copiedImage'));
    } catch {
      setMessage(t('recap.action.copyUnavailable'));
    }
  }

  function saveImage(variant: RecapVariant) {
    if (!generated) return;
    const item = generated[variant];
    const a = document.createElement('a');
    a.href = item.url;
    a.download = filename(period, variant, generated.hero, generated.style);
    document.body.append(a);
    a.click();
    a.remove();
  }

  async function shareImage() {
    if (!generated) return;
    const file = new File(
      [generated.landscape.blob],
      filename(period, 'landscape', generated.hero, generated.style),
      { type: 'image/png' },
    );
    try {
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Vibemeter recap' });
        setMessage(t('recap.action.shared'));
      } else {
        saveImage('landscape');
      }
    } catch {
      setMessage(t('recap.action.shareCanceled'));
    }
  }

  return (
    <div className={compact ? 'flex flex-wrap items-center gap-2' : 'flex flex-wrap items-center justify-end gap-2'}>
      {showPeriodPicker && (
        <div className="flex gap-1 rounded-full border border-zinc-800 bg-zinc-950 p-0.5">
          {(['today', '7d', '30d'] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => selectPeriod(item)}
              className={`rounded-full px-2 py-1 text-[10px] transition-colors ${
                period === item ? 'bg-violet-500/20 text-violet-100' : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {t(item === 'today' ? 'recap.period.today' : item === '7d' ? 'recap.period.week' : 'recap.period.30d')}
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={() => generate()}
        disabled={status === 'rendering'}
        className={`rounded-md border border-violet-500/40 bg-violet-500/10 px-3 py-1.5 text-xs text-violet-100 transition-colors hover:bg-violet-500/20 disabled:cursor-not-allowed disabled:opacity-50 ${
          compact ? 'shrink-0' : ''
        }`}
      >
        {status === 'rendering' ? t('recap.action.making') : compact ? t('recap.action.makeCard') : t('recap.action.shareCard')}
      </button>

      {status === 'error' && <span className="text-[11px] text-rose-300">{t('recap.action.renderFailed')}</span>}

      {generated && status === 'ready' && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 px-4 py-6">
          <div className="w-full max-w-3xl rounded-lg border border-zinc-800 bg-zinc-950 p-4 shadow-2xl shadow-black/60">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-wider text-zinc-500">{t('recap.action.ready')}</p>
                {message && <p className="mt-1 text-[11px] text-emerald-300">{message}</p>}
              </div>
              <button
                type="button"
                onClick={() => { revoke(generated); setGenerated(null); setStatus('idle'); setMessage(null); }}
                className="rounded-md border border-zinc-700 px-2 py-1 text-xs text-zinc-400 hover:border-zinc-500 hover:text-zinc-100"
              >
                {t('recap.action.close')}
              </button>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element -- Previewing a local Blob URL, not a remote asset. */}
            <img
              src={generated.landscape.url}
              alt="Vibemeter recap preview"
              className="block w-full rounded-md border border-zinc-800 bg-zinc-900"
            />
            {/* Style switcher — Classic single-hero vs 2x2 Grid layout */}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-[11px] uppercase tracking-wider text-zinc-500">{t('recap.action.style')}</span>
              {(['hero', 'grid'] as const).map((styleOption) => (
                <button
                  key={styleOption}
                  type="button"
                  onClick={() => selectStyle(styleOption)}
                  className={`rounded-full px-2.5 py-1 text-[11px] transition-colors ${
                    generated.style === styleOption
                      ? 'border border-violet-500/60 bg-violet-500/20 text-violet-100'
                      : 'border border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-100'
                  }`}
                >
                  {styleOption === 'hero' ? t('recap.action.classic') : t('recap.action.grid')}
                </button>
              ))}
            </div>
            {/* Angle cycler — only meaningful for hero style with multiple angles */}
            {generated.style === 'hero' && angles.length > 1 && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="text-[11px] uppercase tracking-wider text-zinc-500">{t('recap.action.differentAngle')}</span>
                {angles.map((angle) => (
                  <button
                    key={angle}
                    type="button"
                    onClick={() => selectAngle(angle)}
                    className={`rounded-full px-2.5 py-1 text-[11px] transition-colors ${
                      generated.hero === angle
                        ? 'border border-violet-500/60 bg-violet-500/20 text-violet-100'
                        : 'border border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-100'
                    }`}
                  >
                    {t(ANGLE_LABEL_KEYS[angle])}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={cycleAngle}
                  className="ml-auto rounded-md border border-zinc-700 px-2 py-1 text-[11px] text-zinc-300 hover:border-zinc-500 hover:text-zinc-100"
                >
                  {t('recap.action.cycle')}
                </button>
              </div>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={copyImage} className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-200 hover:border-zinc-500">
                {t('recap.action.copyImage')}
              </button>
              <button type="button" onClick={() => saveImage('landscape')} className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-200 hover:border-zinc-500">
                {t('recap.action.save', { size: '1200x675' })}
              </button>
              <button type="button" onClick={() => saveImage('square')} className="rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-200 hover:border-zinc-500">
                {t('recap.action.save', { size: '1080x1080' })}
              </button>
              <button
                type="button"
                onClick={shareImage}
                className="rounded-md border border-violet-500/40 bg-violet-500/10 px-3 py-1.5 text-xs text-violet-100 hover:bg-violet-500/20"
              >
                {nativeShareSupported ? t('recap.action.share') : t('recap.action.download')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
