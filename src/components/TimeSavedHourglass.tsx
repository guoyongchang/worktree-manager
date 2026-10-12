import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { activityOn, getTimeSaved, todayKey, todaySavedMinutes, type TimeSavedStats } from '@/lib/timeSaved';
import { TimeSavedBreakdown } from './TimeSavedBreakdown';

type DayActivity = { create: number; archive: number; switch: number; merge: number };

function shiftDay(key: string, days: number): string {
  const date = new Date(`${key}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function mondayOffset(key: string): number {
  return (new Date(`${key}T00:00:00.000Z`).getUTCDay() + 6) % 7;
}

function contributionWeeks(today: string): string[][] {
  const past = shiftDay(today, -180);
  const start = shiftDay(past, -mondayOffset(past));
  const future = shiftDay(today, 14);
  const end = shiftDay(future, 6 - mondayOffset(future));
  const weeks: string[][] = [];
  let cursor = start;
  while (cursor <= end) {
    const week: string[] = [];
    for (let i = 0; i < 7; i += 1) {
      week.push(cursor);
      cursor = shiftDay(cursor, 1);
    }
    weeks.push(week);
  }
  return weeks;
}


function sumActivity(stats: TimeSavedStats): DayActivity {
  const total = { create: 0, archive: 0, switch: 0, merge: 0 };
  for (const activity of Object.values(stats.activityByDay ?? {})) {
    total.create += activity.create;
    total.archive += activity.archive;
    total.switch += activity.switch;
    total.merge += activity.merge;
  }
  return total;
}

export function TimeSavedHourglass() {
  const { t } = useTranslation();
  const [stats, setStats] = useState(getTimeSaved);
  const [open, setOpen] = useState(false);
  const [tipOpen, setTipOpen] = useState(false);
  const [flipping, setFlipping] = useState(false);
  const [paintedMinutes, setPaintedMinutes] = useState(() => todaySavedMinutes());
  const [previewSteps, setPreviewSteps] = useState(0);
  const seenTier = useRef<number | null>(null);
  const rightClicks = useRef(0);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sync = () => setStats(getTimeSaved());
    window.addEventListener('time-saved-changed', sync);
    return () => window.removeEventListener('time-saved-changed', sync);
  }, []);

  const todayMinutes = Math.floor(todaySavedMinutes(stats));
  const displayMinutes = todayMinutes + previewSteps * 60;
  const tier = tierIndex(displayMinutes);

  useEffect(() => {
    if (seenTier.current === null) {
      seenTier.current = tier;
      setPaintedMinutes(displayMinutes);
      return;
    }
    if (tier <= seenTier.current) {
      setPaintedMinutes(displayMinutes);
      return;
    }
    setFlipping(true);
    const timer = window.setTimeout(() => {
      setFlipping(false);
      setPaintedMinutes(displayMinutes);
      seenTier.current = tier;
    }, 800);
    return () => window.clearTimeout(timer);
  }, [tier, displayMinutes]);

  const previewUpgrade = (event: { preventDefault: () => void; stopPropagation: () => void }) => {
    event.preventDefault();
    event.stopPropagation();
    rightClicks.current += 1;
    if (rightClicks.current < 10) return;
    rightClicks.current = 0;
    setPreviewSteps((steps) => Math.min(HOURGLASS_TIERS.length - 1 - tierIndex(todayMinutes), steps + 1));
  };

  const today = todayKey();
  const todayActivity = activityOn(stats, today);
  const allActivity = sumActivity(stats);

  return (
    <>
      <TooltipProvider delayDuration={200}>
        <Tooltip open={tipOpen && !open} onOpenChange={setTipOpen}>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => {
                setTipOpen(false);
                setOpen(true);
              }}
              onContextMenu={previewUpgrade}
              className="relative h-8 w-9 rounded-md flex items-center justify-center"
              aria-label={t('sidebar.timeSavedHourglass')}
            >
              <HourglassIcon sand={(paintedMinutes % 60) / 60} flipping={flipping} minutes={paintedMinutes} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">
            {`${todayMinutes} 分钟 · ${tierForMinutes(paintedMinutes).rarity}${previewSteps > 0 ? ' · 预览' : ''}`}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          ref={contentRef}
          tabIndex={-1}
          onOpenAutoFocus={(event) => {
            // 别让 Radix 把焦点丢给第一个格子按钮，否则格子的 hover 提示会自己弹出来
            event.preventDefault();
            contentRef.current?.focus();
          }}
          className="w-full max-w-[min(560px,calc(100vw-2rem))] gap-0 max-h-[85vh] overflow-y-auto p-0"
        >
          <DialogHeader className="border-b border-[var(--color-border)] p-5">
            <DialogTitle>{t('sidebar.timeSavedStats')}</DialogTitle>
          </DialogHeader>
          <div className="min-w-0 space-y-4 overflow-hidden p-5">
            <div
              className="flex items-center gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-4"
              style={{ borderLeftWidth: 2, borderLeftColor: tierForMinutes(paintedMinutes).sand }}
            >
              <HourglassIcon
                sand={(paintedMinutes % 60) / 60}
                flipping={flipping}
                minutes={paintedMinutes}
                className="h-8 w-12"
              />
              <div className="min-w-0">
                <div className="text-[11px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
                  {t('sidebar.timeSavedTier')}
                </div>
                <div className="text-sm font-medium text-[var(--color-text-primary)]">
                  {tierForMinutes(paintedMinutes).rarity}
                  {previewSteps > 0 ? ` · ${t('sidebar.timeSavedPreview')}` : ''}
                </div>
                <div className="text-xs text-[var(--color-text-secondary)]">
                  {t('sidebar.timeSavedMinutes', { minutes: todayMinutes })}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <StatBlock title={t('sidebar.timeSavedTodayTitle')} minutes={todayMinutes} activity={todayActivity} />
              <StatBlock title={t('sidebar.timeSavedAllTitle')} minutes={stats.totalMinutes} activity={allActivity} />
            </div>
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-4">
              <TimeSavedBreakdown stats={stats} />
            </div>
            <Heatmap stats={stats} today={today} />
            <p className="text-xs text-[var(--color-text-muted)]">{t('sidebar.timeSavedNote')}</p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function StatBlock({ title, minutes, activity }: {
  title: string;
  minutes: number;
  activity: DayActivity;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-4">
      <div className="text-[11px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">{title}</div>
      <div className="text-sm text-[var(--color-text-primary)]">{t('sidebar.timeSavedMinutes', { minutes: Math.floor(minutes) })}</div>
      <div className="text-xs text-[var(--color-text-secondary)]">{t('sidebar.timeSavedActivity', activity)}</div>
    </div>
  );
}

function monthLabels(weeks: string[][], language: string): string[] {
  const format = new Intl.DateTimeFormat(language.startsWith('zh') ? 'zh-CN' : 'en-US', {
    month: 'short',
    timeZone: 'UTC',
  });
  const labels = weeks.map(() => '');
  let last = -99;
  weeks.forEach((week, index) => {
    const prevMonth = index === 0 ? '' : weeks[index - 1][6].slice(0, 7);
    const started = week.find((day) => day.slice(0, 7) !== prevMonth);
    if (!started || index - last < 2) return;
    last = index;
    labels[index] = format.format(new Date(`${started}T00:00:00.000Z`));
  });
  return labels;
}

function dayFill(minutes: number): string {
  if (minutes <= 0) return 'var(--color-bg-surface)';
  const mix = Math.round(Math.min(100, 45 + Math.min(minutes, 240) / 240 * 55));
  return `color-mix(in srgb, ${tierForMinutes(minutes).sand} ${mix}%, transparent)`;
}

function Heatmap({ stats, today }: { stats: TimeSavedStats; today: string }) {
  const { t, i18n } = useTranslation();
  const weeks = useMemo(() => contributionWeeks(today), [today]);
  const labels = monthLabels(weeks, i18n.language);
  const weekdays = t('sidebar.timeSavedWeekdays').split(',');
  return (
    <TooltipProvider delayDuration={200}>
      <div
        className="grid w-full gap-x-[3px] gap-y-[3px]"
        style={{ gridTemplateColumns: `1.75rem repeat(${weeks.length}, minmax(0, 1fr))` }}
      >
        <div />
        {labels.map((label, index) => (
          <div key={weeks[index][0]} className="h-4 overflow-visible whitespace-nowrap text-[10px] leading-4 text-[var(--color-text-muted)]">
            {label}
          </div>
        ))}
        {weekdays.map((label, row) => (
          <div
            key={label}
            className="self-center text-[10px] leading-none text-[var(--color-text-muted)]"
            style={{ gridColumn: 1, gridRow: row + 2 }}
          >
            {label}
          </div>
        ))}
        {weeks.flatMap((week, column) => week.map((day, row) => {
          const future = day > today;
          const minutes = future ? 0 : (stats.byDay[day] ?? 0);
          const activity = activityOn(stats, day);
          return (
            <div key={day} className="min-w-0" style={{ gridColumn: column + 2, gridRow: row + 2 }}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className={`block aspect-square w-full rounded-[2px] border border-[var(--color-border)] ${day === today ? 'ring-1 ring-[var(--color-text-primary)]' : ''}`}
                    style={{ background: dayFill(minutes) }}
                  />
                </TooltipTrigger>
                <TooltipContent side="top">
                  {future
                    ? day
                    : `${day} · ${t('sidebar.timeSavedMinutes', { minutes: Math.floor(minutes) })} · ${t('sidebar.timeSavedActivity', activity)}`}
                </TooltipContent>
              </Tooltip>
            </div>
          );
        }))}
      </div>
    </TooltipProvider>
  );
}

const HOURGLASS_TIERS = [
  { rarity: 'Common', sand: '#d7dbe2', glow: 0.35, aura: '#d7dbe2' },
  { rarity: 'Uncommon', sand: '#3ddc97', glow: 0.55, aura: '#3ddc97' },
  { rarity: 'Rare', sand: '#3b82f6', glow: 0.7, aura: '#3b82f6' },
  { rarity: 'Epic', sand: '#a855f7', glow: 0.8, aura: '#a855f7' },
  { rarity: 'Legendary', sand: '#e0b040', glow: 0.9, aura: '#e0b040' },
  { rarity: 'Exalted', sand: '#ff6a2a', glow: 1, aura: '#ff6a2a' },
  { rarity: 'Exotic', sand: '#2ee6d6', glow: 1, aura: '#7aa2ff' },
  { rarity: 'Unique', sand: '#f5f7ff', glow: 1, aura: '#e879f9' },
];

function tierIndex(minutes: number): number {
  return Math.min(HOURGLASS_TIERS.length - 1, Math.max(0, Math.floor(minutes / 60)));
}

function tierForMinutes(minutes: number) {
  return HOURGLASS_TIERS[tierIndex(minutes)];
}

function HourglassIcon({ sand, flipping, minutes, className }: { sand: number; flipping: boolean; minutes: number; className?: string }) {
  const tier = tierForMinutes(minutes);
  const level = Math.max(0, Math.min(1, sand));
  const apex = 20.2 - level * 8;
  return (
    <svg viewBox="0 0 32 24" className={`${className ?? 'h-4 w-6'} ${flipping ? 'animate-hourglass-flip' : ''}`}>
      <defs>
        <clipPath id="hourglass-lower">
          <path d="M13 12C13 15.3 8 16.3 8 20.5H24c0-4.2-5-5.2-5-8.5H13z" />
        </clipPath>
      </defs>
      {level > 0 && (
        <polygon points={`7,20.6 25,20.6 16,${apex}`} fill={tier.sand} clipPath="url(#hourglass-lower)" />
      )}
      <path d="M6 2h20M6 22h20" stroke={tier.sand} strokeWidth="2.4" strokeLinecap="round" />
      <path d="M8 3.5c0 4.2 5 5.2 5 8.5S8 16.3 8 20.5h16c0-4.2-5-5.2-5-8.5S24 7.7 24 3.5H8z" fill="none" stroke="#d7dbe2" strokeWidth="1.8" />
    </svg>
  );
}
