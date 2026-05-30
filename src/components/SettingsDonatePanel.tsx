/* eslint-disable @next/next/no-img-element */
// QR PNGs are dropped in by the maintainer; next/image's optimizer would refuse
// them when missing (no graceful onError) and we want the inline fallback path.
'use client';

import { useState } from 'react';
import { useT } from '@/lib/i18n/client';

const ALIPAY_SRC = '/pay-alipay.jpg';

export function SettingsDonatePanel() {
  const t = useT();
  const [missing, setMissing] = useState(false);
  const [zoom, setZoom] = useState(false);
  const alipayLabel = t('donate.alipay');

  return (
    <section className="flex h-full flex-col rounded-lg border border-zinc-800 bg-zinc-900 p-6">
      <div className="mb-4">
        <h2 className="text-base font-semibold text-zinc-100">{t('donate.title')}</h2>
        <p className="text-zinc-500 text-xs mt-1">{t('donate.subtitle')}</p>
      </div>

      <div className="flex flex-1 items-start gap-4">
        <button
          type="button"
          onClick={() => !missing && setZoom(true)}
          className="w-48 rounded-md border border-zinc-800 bg-zinc-950/50 p-3 text-center transition-colors hover:border-zinc-700"
        >
          <div className="aspect-square w-full overflow-hidden rounded bg-white">
            {missing ? (
              <div className="flex h-full items-center justify-center px-2 text-center text-[10px] text-zinc-500">
                {t('donate.missing', { path: 'public/pay-alipay.jpg' })}
              </div>
            ) : (
              <img
                src={ALIPAY_SRC}
                alt={alipayLabel}
                className="h-full w-full object-contain"
                onError={() => setMissing(true)}
              />
            )}
          </div>
          <div className="mt-2 text-xs font-medium text-zinc-300">{alipayLabel}</div>
        </button>
        <p className="flex-1 text-xs leading-relaxed text-zinc-500">{t('donate.aside')}</p>
      </div>

      {missing && (
        <p className="mt-3 text-xs text-zinc-600">
          {t('donate.missing', { path: 'public/pay-alipay.jpg' })}
        </p>
      )}

      {zoom && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
          onClick={() => setZoom(false)}
        >
          <div className="rounded-lg bg-white p-4 text-center" onClick={(e) => e.stopPropagation()}>
            <img src={ALIPAY_SRC} alt={alipayLabel} className="max-h-[70vh] max-w-[80vw] object-contain" />
            <div className="mt-2 text-sm font-medium text-zinc-900">{alipayLabel}</div>
            <button
              type="button"
              onClick={() => setZoom(false)}
              className="mt-3 rounded border border-zinc-300 px-3 py-1 text-xs text-zinc-700 hover:bg-zinc-100"
            >
              {t('donate.zoomClose')}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
