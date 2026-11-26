import { useEffect, useState, type FC } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { isTauri, resolveMcpConfirm } from '@/lib/backend';

interface ConfirmRequest {
  id: string;
  action: string;
  summary: string;
}

type PortNotice =
  | { kind: 'busy'; port: number }
  | { kind: 'moved'; from: number; to: number };

export const McpConfirmDialog: FC = () => {
  const { t } = useTranslation();
  const [queue, setQueue] = useState<ConfirmRequest[]>([]);
  const request = queue[0] ?? null;
  const [portNotice, setPortNotice] = useState<PortNotice | null>(null);

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    listen<ConfirmRequest>('mcp-confirm-required', (event) => {
      setQueue((prev) =>
        prev.some((item) => item.id === event.payload.id) ? prev : [...prev, event.payload]
      );
    }).then((stop) => {
      if (cancelled) stop();
      else unlisten = stop;
    }).catch(() => {});
    const stopBusy = listen<{ port: number; message: string }>('mcp-port-unavailable', (event) => {
      setPortNotice({ kind: 'busy', port: event.payload.port });
    });
    const stopReady = listen('mcp-port-available', () => setPortNotice(null));
    const stopMoved = listen<{ from: number; to: number }>('mcp-port-moved', (event) => {
      setPortNotice({ kind: 'moved', from: event.payload.from, to: event.payload.to });
    });
    return () => {
      cancelled = true;
      unlisten?.();
      stopBusy.then((stop) => stop()).catch(() => {});
      stopReady.then((stop) => stop()).catch(() => {});
      stopMoved.then((stop) => stop()).catch(() => {});
    };
  }, []);

  const answer = (approved: boolean) => {
    if (!request) return;
    const id = request.id;
    setQueue((prev) => prev.filter((item) => item.id !== id));
    resolveMcpConfirm(id, approved).catch(() => {});
  };

  return (
    <>
    <Dialog open={!!request} onOpenChange={(open) => { if (!open) answer(false); }}>
      <DialogContent className="max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between gap-2">
            <span>{request?.action || t('settings.mcpConfirmTitle')}</span>
            {queue.length > 1 && (
              <span className="text-xs font-normal text-[var(--color-text-secondary)]">
                1 / {queue.length}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm whitespace-pre-line break-words text-[var(--color-text-secondary)]">
          {request?.summary}
        </p>
        <DialogFooter>
          <Button variant="secondary" onClick={() => answer(false)}>{t('settings.mcpConfirmCancel')}</Button>
          <Button onClick={() => answer(true)}>{t('settings.mcpConfirmAccept')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={!!portNotice} onOpenChange={(open) => { if (!open) setPortNotice(null); }}>
      <DialogContent className="max-w-[420px]">
        <DialogHeader>
          <DialogTitle>
            {portNotice?.kind === 'moved' ? t('settings.mcpPortMovedTitle') : t('settings.mcpPortBusyTitle')}
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-[var(--color-text-secondary)]">
          {portNotice?.kind === 'moved'
            ? t('settings.mcpPortMoved', { from: portNotice.from, to: portNotice.to })
            : t('settings.mcpPortBusy', { port: portNotice?.kind === 'busy' ? portNotice.port : '' })}
        </p>
        <DialogFooter>
          <Button onClick={() => setPortNotice(null)}>{t('settings.mcpPortBusyClose')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>
  );
};
