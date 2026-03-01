import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { GitBranch, FileText, Terminal } from 'lucide-react';

type MobileTab = 'list' | 'detail' | 'terminal' | 'settings';

interface MobileTabBarProps {
    activeTab: MobileTab;
    onTabChange: (tab: MobileTab) => void;
    terminalCount?: number;
    hasSelectedWorktree?: boolean;
}

const TAB_CONFIG: { id: MobileTab; labelKey: string; fallback: string; Icon: typeof GitBranch }[] = [
    { id: 'list', labelKey: 'mobile.tabList', fallback: '列表', Icon: GitBranch },
    { id: 'detail', labelKey: 'mobile.tabDetail', fallback: '详情', Icon: FileText },
    { id: 'terminal', labelKey: 'mobile.tabTerminal', fallback: '终端', Icon: Terminal },
];

export const MobileTabBar: FC<MobileTabBarProps> = ({
    activeTab,
    onTabChange,
    terminalCount = 0,
    hasSelectedWorktree = false,
}) => {
    const { t } = useTranslation();

    return (
        <div
            className="shrink-0 bg-slate-900/95 backdrop-blur-md border-t border-slate-700/50"
            style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
        >
            <div className="flex items-stretch h-14">
                {TAB_CONFIG.map(({ id, labelKey, fallback, Icon }) => {
                    const disabled = id === 'detail' && !hasSelectedWorktree;
                    const active = activeTab === id;
                    const showBadge = id === 'terminal' && terminalCount > 0;

                    return (
                        <button
                            key={id}
                            onClick={() => !disabled && onTabChange(id)}
                            className={`flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors relative ${disabled
                                    ? 'text-slate-700 cursor-not-allowed'
                                    : active
                                        ? 'text-blue-400'
                                        : 'text-slate-500 active:text-slate-300'
                                }`}
                            disabled={disabled}
                        >
                            <span className="relative">
                                <Icon className="w-5 h-5" />
                                {showBadge && (
                                    <span className="absolute -top-1 -right-2.5 min-w-[16px] h-[16px] rounded-full bg-blue-600 text-[9px] text-white font-bold flex items-center justify-center px-1 leading-none">
                                        {terminalCount}
                                    </span>
                                )}
                            </span>
                            <span className="text-[10px] font-medium leading-none">{t(labelKey, fallback)}</span>
                            {active && (
                                <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full bg-blue-400" />
                            )}
                        </button>
                    );
                })}
            </div>
        </div>
    );
};
