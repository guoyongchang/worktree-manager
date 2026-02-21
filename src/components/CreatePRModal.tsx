import { useState, type FC } from 'react';
import { useTranslation } from 'react-i18next';
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
import { createPullRequest } from '@/lib/backend';
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
    try {
      const prUrl = await createPullRequest(projectPath, baseBranch, title.trim(), body.trim());
      toast('success', t('createPR.success', { url: prUrl }));
      onOpenChange(false);
      setTitle('');
      setBody('');
      onSuccess?.();
    } catch (err) {
      toast('error', err instanceof Error ? err.message : String(err));
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
            <label className="text-sm text-slate-300">{t('createPR.titleLabel')}</label>
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
            <label className="text-sm text-slate-300">{t('createPR.bodyLabel')}</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={t('createPR.bodyPlaceholder')}
              rows={4}
              className="flex w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 resize-none"
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
