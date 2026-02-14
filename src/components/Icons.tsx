import type { FC } from 'react';
import {
  ChevronsLeft,
  ChevronsRight,
  GitMerge,
  GitPullRequest,
  Upload,
  RefreshCw,
  Folder,
  Archive,
  Plus,
  RotateCw,
  Settings,
  GitBranch,
  ChevronRight,
  AlertTriangle,
  Trash2,
  ArrowLeft,
  Terminal,
  ChevronDown,
  Briefcase,
  X,
  Copy,
  Check,
  CheckCircle,
  FileText,
  ExternalLink,
  Maximize2,
  Minimize2,
  Share2,
  Square,
  Users,
  Eye,
  Github,
} from 'lucide-react';

interface IconProps {
  className?: string;
}

export const StatusDot: FC<{ status: 'success' | 'warning' | 'info' | 'sync' }> = ({ status }) => {
  const colors = {
    success: 'bg-emerald-500',
    warning: 'bg-amber-500',
    info: 'bg-blue-500',
    sync: 'bg-purple-500',
  };
  return <span className={`inline-block w-2.5 h-2.5 rounded-full ${colors[status]}`} />;
};

export const FolderIcon: FC<IconProps> = ({ className = "w-5 h-5" }) => (
  <Folder className={className} />
);

export const ArchiveIcon: FC<IconProps> = ({ className = "w-5 h-5" }) => (
  <Archive className={className} />
);

export const PlusIcon: FC<IconProps> = ({ className = "w-5 h-5" }) => (
  <Plus className={className} />
);

export const RefreshIcon: FC<IconProps> = ({ className = "w-5 h-5" }) => (
  <RotateCw className={className} />
);

export const SettingsIcon: FC<IconProps> = ({ className = "w-5 h-5" }) => (
  <Settings className={className} />
);

export const GitBranchIcon: FC<IconProps> = ({ className = "w-4 h-4" }) => (
  <GitBranch className={className} />
);

export const ChevronIcon: FC<{ expanded: boolean; className?: string }> = ({ expanded, className = "w-4 h-4" }) => (
  <ChevronRight className={`${className} transition-transform ${expanded ? 'rotate-90' : ''}`} />
);

export const WarningIcon: FC<IconProps> = ({ className = "w-4 h-4" }) => (
  <AlertTriangle className={className} />
);

export const TrashIcon: FC<IconProps> = ({ className = "w-4 h-4" }) => (
  <Trash2 className={className} />
);

export const BackIcon: FC<IconProps> = ({ className = "w-5 h-5" }) => (
  <ArrowLeft className={className} />
);

export const TerminalIcon: FC<IconProps> = ({ className = "w-5 h-5" }) => (
  <Terminal className={className} />
);

export const ChevronDownIcon: FC<IconProps> = ({ className = "w-4 h-4" }) => (
  <ChevronDown className={className} />
);

export const WorkspaceIcon: FC<IconProps> = ({ className = "w-5 h-5" }) => (
  <Briefcase className={className} />
);

export const CloseIcon: FC<IconProps> = ({ className = "w-2.5 h-2.5" }) => (
  <X className={className} />
);

export const DuplicateIcon: FC<IconProps> = ({ className = "w-4 h-4" }) => (
  <Copy className={className} />
);

export const CheckIcon: FC<IconProps> = ({ className = "w-3 h-3" }) => (
  <Check className={className} />
);

export const CheckCircleIcon: FC<IconProps> = ({ className = "w-4 h-4" }) => (
  <CheckCircle className={className} />
);

export const LogIcon: FC<IconProps> = ({ className = "w-4 h-4" }) => (
  <FileText className={className} />
);

export const ExternalLinkIcon: FC<IconProps> = ({ className = "w-4 h-4" }) => (
  <ExternalLink className={className} />
);

export const SidebarCollapseIcon: FC<IconProps> = ({ className = "w-4 h-4" }) => (
  <ChevronsLeft className={className} />
);

export const SidebarExpandIcon: FC<IconProps> = ({ className = "w-4 h-4" }) => (
  <ChevronsRight className={className} />
);

export const MaximizeIcon: FC<IconProps> = ({ className = "w-4 h-4" }) => (
  <Maximize2 className={className} />
);

export const RestoreIcon: FC<IconProps> = ({ className = "w-4 h-4" }) => (
  <Minimize2 className={className} />
);

export const ShareIcon: FC<IconProps> = ({ className = "w-4 h-4" }) => (
  <Share2 className={className} />
);

export const StopIcon: FC<IconProps> = ({ className = "w-4 h-4" }) => (
  <Square className={className} />
);

export const CopyIcon: FC<IconProps> = ({ className = "w-4 h-4" }) => (
  <Copy className={className} />
);

export const UsersIcon: FC<IconProps> = ({ className = "w-4 h-4" }) => (
  <Users className={className} />
);

export const XIcon: FC<IconProps> = ({ className = "w-4 h-4" }) => (
  <X className={className} />
);

export const EyeIcon: FC<IconProps> = ({ className = "w-4 h-4" }) => (
  <Eye className={className} />
);

export const GitMergeIcon: FC<IconProps> = ({ className = "w-4 h-4" }) => (
  <GitMerge className={className} />
);

export const GitPullRequestIcon: FC<IconProps> = ({ className = "w-4 h-4" }) => (
  <GitPullRequest className={className} />
);

export const UploadIcon: FC<IconProps> = ({ className = "w-4 h-4" }) => (
  <Upload className={className} />
);

export const SyncIcon: FC<IconProps> = ({ className = "w-4 h-4" }) => (
  <RefreshCw className={className} />
);

export const GithubIcon: FC<IconProps> = ({ className = "w-4 h-4" }) => (
  <Github className={className} />
);
