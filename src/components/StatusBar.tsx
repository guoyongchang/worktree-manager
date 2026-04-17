import { useState } from "react";
import { Brain, ChevronUp, Play, Trash2, Eye } from "lucide-react";
import type { QueueItemSummary } from "../types";

interface StatusBarProps {
  memoryItems: QueueItemSummary[];
  pendingCount: number;
  processingCount: number;
  onRunArchive: (id: string) => void;
  onDeleteItem: (id: string) => void;
  onViewDetail: (id: string) => void;
}

export function StatusBar({
  memoryItems,
  pendingCount,
  processingCount,
  onRunArchive,
  onDeleteItem,
  onViewDetail,
}: StatusBarProps) {
  const [expanded, setExpanded] = useState(false);

  const badgeCount = pendingCount + processingCount;

  return (
    <div className="border-t border-border bg-background">
      {expanded && (
        <div className="max-h-64 overflow-y-auto border-b border-border p-3">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium">Memory Queue</h3>
            <span className="text-xs text-muted-foreground">
              {memoryItems.length} items
            </span>
          </div>
          {memoryItems.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">
              No conversations in queue
            </p>
          ) : (
            <div className="space-y-1">
              {memoryItems.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between rounded px-2 py-1.5 hover:bg-muted text-xs"
                >
                  <div className="flex-1 min-w-0 mr-2">
                    <div className="flex items-center gap-1.5">
                      <StatusDot status={item.status} />
                      <span className="font-mono truncate">
                        {item.branch || item.project || "unknown"}
                      </span>
                      {item.requirement_id && (
                        <span className="text-muted-foreground">
                          {item.requirement_id}
                        </span>
                      )}
                    </div>
                    <div className="text-muted-foreground truncate mt-0.5">
                      {item.conversation_preview}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {(item.status === "pending" || item.status === "failed") && (
                      <button
                        onClick={() => onRunArchive(item.id)}
                        className="p-1 hover:bg-accent rounded"
                        title={item.status === "failed" ? "Retry archive" : "Run archive"}
                      >
                        <Play className="w-3 h-3" />
                      </button>
                    )}
                    <button
                      onClick={() => onViewDetail(item.id)}
                      className="p-1 hover:bg-accent rounded"
                      title="View detail"
                    >
                      <Eye className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => onDeleteItem(item.id)}
                      className="p-1 hover:bg-accent rounded text-destructive"
                      title="Delete"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex items-center h-7 px-3 text-xs text-muted-foreground">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1.5 hover:text-foreground transition-colors"
        >
          <Brain className="w-3.5 h-3.5" />
          <span>Memory</span>
          {badgeCount > 0 && (
            <span className="bg-primary text-primary-foreground rounded-full px-1.5 text-[10px] leading-4 font-medium">
              {badgeCount}
            </span>
          )}
          <ChevronUp
            className={`w-3 h-3 transition-transform ${expanded ? "" : "rotate-180"}`}
          />
        </button>
      </div>
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: "bg-yellow-400",
    processing: "bg-blue-400 animate-pulse",
    completed: "bg-green-400",
    failed: "bg-red-400",
  };
  return (
    <span
      className={`inline-block w-1.5 h-1.5 rounded-full ${colors[status] || "bg-gray-400"}`}
    />
  );
}
