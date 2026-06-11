import { useState, type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { addLog } from '@/lib/operationLog';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { createPullRequest, openLink } from '@/lib/backend';
import { useToast } from './Toast';

interface CreatePRModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectPath: string;
  baseBranch: string;
  currentBranch: string;
  onSuccess?: () => void;
}

export const CreatePRModal: FC<CreatePRModalProps> = ({
  open,
  onOpenChange,
  projectPath,
  baseBranch,
  currentBranch,
  onSuccess,
}) => {
  const { t } = useTranslation();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();

  const handleSubmit = async () => {
    if (!title.trim()) return;
    setSubmitting(true);
    addLog(projectPath, { level: 'info', operation: 'pr', message: `Creating PR: ${title.trim()} → ${baseBranch}` });
    try {
      const prUrl = await createPullRequest(projectPath, baseBranch, title.trim(), body.trim());
      addLog(projectPath, { level: 'success', operation: 'pr', message: `PR created: ${prUrl}`, detail: prUrl });
      toast('success', t('createPR.success', { url: prUrl }));
      if (prUrl.startsWith('http')) {
        openLink(prUrl).catch(() => {});
      }
      onOpenChange(false);
      setTitle('');
      setBody('');
      onSuccess?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addLog(projectPath, { level: 'error', operation: 'pr', message: 'PR creation failed', detail: msg });
      toast('error', msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[480px] p-0">
        <DialogHeader className="p-5 pb-0">
          <DialogTitle>{t('createPR.title')}</DialogTitle>
          <DialogDescription>
            {currentBranch} → {baseBranch}
          </DialogDescription>
        </DialogHeader>

        <div className="px-5 py-4 space-y-4">
          <div className="space-y-2">
            <label className="text-sm text-[var(--color-text-secondary)]">{t('createPR.titleLabel')}</label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('createPR.titlePlaceholder')}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && title.trim()) {
                  handleSubmit();
                }
              }}
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm text-[var(--color-text-secondary)]">{t('createPR.bodyLabel')}</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={t('createPR.bodyPlaceholder')}
              rows={4}
              className="flex w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg-base)] px-3 py-2 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] resize-none"
            />
          </div>
        </div>

        <DialogFooter className="p-5 pt-0 flex-row gap-3 sm:flex-row">
          <Button variant="secondary" className="flex-1" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button className="flex-1" onClick={handleSubmit} disabled={submitting || !title.trim()}>
            {submitting ? t('common.creating') : t('common.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
