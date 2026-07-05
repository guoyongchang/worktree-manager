import { useEffect, useMemo, useState } from 'react';
import { RefreshCw, Router } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  discoverTunnelRoutes,
  getRoutePreference,
  getTunnelRoute,
  selectTunnelRoute,
  type TunnelRouteDiscovery,
  type TunnelRouteOption,
} from '../lib/tunnelRoute';
import { cn } from '../lib/utils';

type RouteSelectorVariant = 'gate' | 'compact';

interface TunnelRouteSelectorProps {
  variant: RouteSelectorVariant;
  onSelected: () => void;
  onCancel?: () => void;
  className?: string;
}

const AUTO_ROUTE = 'auto';

function latencyLabel(option: TunnelRouteOption): string {
  if (!option.reachable || option.median_browser_rtt_ms == null) return '不可达';
  return `${option.median_browser_rtt_ms} ms`;
}

function routeLabel(option: TunnelRouteOption): string {
  return option.peer.public_base_url;
}

function bestReachablePeerId(discovery: TunnelRouteDiscovery | null): string {
  const reachable = discovery?.options
    .filter((option) => option.reachable && option.median_browser_rtt_ms != null)
    .sort((a, b) => {
      const aScore = (a.median_browser_rtt_ms ?? 10_000)
        + (a.peer.desktop_rtt_ms ?? 150)
        + a.peer.weight;
      const bScore = (b.median_browser_rtt_ms ?? 10_000)
        + (b.peer.desktop_rtt_ms ?? 150)
        + b.peer.weight;
      return aScore - bScore;
    });
  return reachable?.[0]?.peer.id ?? AUTO_ROUTE;
}

export function TunnelRouteSelector({
  variant,
  onSelected,
  onCancel,
  className,
}: TunnelRouteSelectorProps) {
  const [discovery, setDiscovery] = useState<TunnelRouteDiscovery | null>(null);
  const [selectedPeerId, setSelectedPeerId] = useState(AUTO_ROUTE);
  const [loading, setLoading] = useState(true);
  const [selecting, setSelecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    discoverTunnelRoutes(5)
      .then((next) => {
        if (cancelled) return;
        if (!next) {
          setError('没有可用的路由节点');
          return;
        }
        setDiscovery(next);
        const current = getTunnelRoute()?.selected_peer_id;
        const preferred = current || getRoutePreference();
        const hasPreferred = preferred === AUTO_ROUTE
          || next.options.some((option) => option.peer.id === preferred && option.reachable);
        setSelectedPeerId(hasPreferred ? preferred : bestReachablePeerId(next));
      })
      .catch(() => {
        if (!cancelled) setError('路由节点测试失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const routeOptions = useMemo(() => discovery?.options ?? [], [discovery]);
  const selectedOption = useMemo(
    () => routeOptions.find((option) => option.peer.id === selectedPeerId),
    [routeOptions, selectedPeerId],
  );
  const canConfirm = !!discovery && !loading && !selecting
    && (selectedPeerId === AUTO_ROUTE || !!selectedOption?.reachable);

  const confirm = async () => {
    if (!discovery || !canConfirm) return;
    setSelecting(true);
    setError(null);
    const route = await selectTunnelRoute(discovery, selectedPeerId);
    setSelecting(false);
    if (!route) {
      setError('路由切换失败，请重新测试或选择其他节点');
      return;
    }
    onSelected();
  };

  if (variant === 'compact') {
    return (
      <div className={cn(
        'flex items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-surface)] px-2 py-1.5 text-xs shadow-sm',
        className,
      )}>
        <Router className="h-3.5 w-3.5 text-[var(--color-accent)]" />
        <select
          aria-label="路由节点"
          value={selectedPeerId}
          disabled={loading || selecting || !discovery}
          onChange={(event) => setSelectedPeerId(event.target.value)}
          className="max-w-44 bg-transparent text-[var(--color-text-primary)] outline-none"
        >
          <option value={AUTO_ROUTE}>自动选择</option>
          {routeOptions.map((option) => (
            <option key={option.peer.id} value={option.peer.id} disabled={!option.reachable}>
              {option.peer.id} · {latencyLabel(option)}
            </option>
          ))}
        </select>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="h-7 px-2 text-xs"
          disabled={!canConfirm}
          onClick={confirm}
        >
          {selecting ? '切换中' : '切换'}
        </Button>
      </div>
    );
  }

  return (
    <div className={cn('space-y-4', className)}>
      <div className="text-center space-y-1">
        <div className="w-10 h-10 mx-auto bg-[var(--color-accent)]/20 rounded-lg flex items-center justify-center mb-3">
          {loading ? (
            <RefreshCw className="w-5 h-5 animate-spin text-[var(--color-accent)]" />
          ) : (
            <Router className="w-5 h-5 text-[var(--color-accent)]" />
          )}
        </div>
        <h1 className="text-xl font-semibold">选择路由节点</h1>
        <p className="text-sm text-[var(--color-text-secondary)]">
          每个节点测试 5 次，显示中位数延迟
        </p>
      </div>

      <div className="space-y-2">
        <button
          type="button"
          role="radio"
          aria-checked={selectedPeerId === AUTO_ROUTE}
          aria-label="自动选择"
          className={cn(
            'w-full rounded-md border px-3 py-2 text-left transition-colors',
            selectedPeerId === AUTO_ROUTE
              ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10'
              : 'border-[var(--color-border)] bg-[var(--color-bg-surface)]',
          )}
          onClick={() => setSelectedPeerId(AUTO_ROUTE)}
        >
          <div className="flex items-center justify-between gap-3">
            <span className="font-medium">自动选择</span>
            <span className="text-xs text-[var(--color-text-secondary)]">
              推荐 {bestReachablePeerId(discovery)}
            </span>
          </div>
        </button>

        {routeOptions.map((option) => (
          <button
            key={option.peer.id}
            type="button"
            role="radio"
            aria-checked={selectedPeerId === option.peer.id}
            aria-label={`${option.peer.id} ${latencyLabel(option)}`}
            disabled={!option.reachable}
            className={cn(
              'w-full rounded-md border px-3 py-2 text-left transition-colors disabled:opacity-50',
              selectedPeerId === option.peer.id
                ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10'
                : 'border-[var(--color-border)] bg-[var(--color-bg-surface)]',
            )}
            onClick={() => setSelectedPeerId(option.peer.id)}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="font-medium truncate">{option.peer.id}</div>
                <div className="text-xs text-[var(--color-text-secondary)] truncate">
                  {routeLabel(option)}
                </div>
              </div>
              <div className="text-sm tabular-nums text-[var(--color-text-primary)]">
                {latencyLabel(option)}
              </div>
            </div>
          </button>
        ))}
      </div>

      {error && (
        <p className="text-sm text-[var(--color-error)]">{error}</p>
      )}

      <div className="flex gap-2">
        {onCancel && (
          <Button type="button" variant="secondary" className="flex-1" onClick={onCancel}>
            返回
          </Button>
        )}
        <Button type="button" className="flex-1" disabled={!canConfirm} onClick={confirm}>
          {selecting ? '连接中...' : '进入分享页面'}
        </Button>
      </div>
    </div>
  );
}
