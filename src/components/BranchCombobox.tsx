import { useState, useEffect, type FC } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { ChevronDownIcon, RefreshIcon } from './Icons';

interface BranchComboboxProps {
  value: string;
  onChange: (value: string) => void;
  onLoadBranches?: () => Promise<string[]>;
  placeholder?: string;
  disabled?: boolean;
}

export const BranchCombobox: FC<BranchComboboxProps> = ({
  value,
  onChange,
  onLoadBranches,
  placeholder = '选择或输入分支',
  disabled = false,
}) => {
  const [open, setOpen] = useState(false);
  const [branches, setBranches] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [inputValue, setInputValue] = useState(value);

  useEffect(() => {
    setInputValue(value);
  }, [value]);

  const loadBranches = async () => {
    if (!onLoadBranches) return;
    setLoading(true);
    try {
      const remoteBranches = await onLoadBranches();
      setBranches(remoteBranches);
    } catch (err) {
      console.error('Failed to load branches:', err);
      setBranches([]);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    if (newOpen && branches.length === 0 && onLoadBranches) {
      loadBranches();
    }
  };

  const handleSelect = (branch: string) => {
    setInputValue(branch);
    onChange(branch);
    setOpen(false);
    setSearchQuery('');
  };

  const handleInputChange = (newValue: string) => {
    setInputValue(newValue);
    onChange(newValue);
  };

  const handleInputBlur = () => {
    // Commit the input value when focus is lost
    if (inputValue !== value) {
      onChange(inputValue);
    }
  };

  const filteredBranches = branches.filter(branch =>
    branch.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="relative">
      <div className="flex gap-1">
        <Input
          type="text"
          value={inputValue}
          onChange={(e) => handleInputChange(e.target.value)}
          onBlur={handleInputBlur}
          placeholder={placeholder}
          disabled={disabled}
          className="flex-1"
        />
        {onLoadBranches && (
          <Popover open={open} onOpenChange={handleOpenChange}>
            <PopoverTrigger asChild>
              <Button
                variant="secondary"
                size="icon"
                disabled={disabled}
                className="h-9 w-9 shrink-0"
              >
                <ChevronDownIcon className="w-4 h-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[280px] p-0" align="end">
              <div className="flex flex-col max-h-[300px]">
                <div className="p-2 border-b border-slate-700">
                  <div className="flex items-center gap-2">
                    <Input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="搜索分支..."
                      className="flex-1 h-8 text-sm"
                      autoFocus
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={loadBranches}
                      disabled={loading}
                      className="h-8 w-8 shrink-0"
                    >
                      <RefreshIcon className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                    </Button>
                  </div>
                </div>
                <div className="overflow-y-auto">
                  {loading ? (
                    <div className="p-4 text-center text-sm text-slate-400">
                      加载中...
                    </div>
                  ) : filteredBranches.length === 0 ? (
                    <div className="p-4 text-center text-sm text-slate-400">
                      {searchQuery ? '未找到匹配的分支' : '未找到远程分支'}
                    </div>
                  ) : (
                    <div className="py-1">
                      {filteredBranches.map((branch) => (
                        <button
                          key={branch}
                          onClick={() => handleSelect(branch)}
                          className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-700/50 transition-colors ${
                            branch === value ? 'bg-slate-700/30 text-blue-400' : 'text-slate-300'
                          }`}
                        >
                          {branch}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </PopoverContent>
          </Popover>
        )}
      </div>
    </div>
  );
};
