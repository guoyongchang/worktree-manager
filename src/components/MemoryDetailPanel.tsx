import { useState, useEffect } from "react";
import { X, Play, RotateCcw, Trash2 } from "lucide-react";
import { getMemoryQueueItem } from "../lib/backend";
import type { MemoryQueueItem } from "../types";

interface MemoryDetailPanelProps {
  itemId: string;
  onClose: () => void;
  onRunArchive: (id: string) => void;
  onDeleteItem: (id: string) => void;
}

export function MemoryDetailPanel({
  itemId,
  onClose,
  onRunArchive,
  onDeleteItem,
}: MemoryDetailPanelProps) {
  const [item, setItem] = useState<MemoryQueueItem | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getMemoryQueueItem(itemId)
      .then(setItem)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [itemId]);

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
        <div className="bg-background rounded-lg p-8 text-sm">Loading...</div>
      </div>
    );
  }

  if (!item) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-background rounded-lg w-[700px] max-h-[80vh] flex flex-col shadow-xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div>
            <h2 className="text-sm font-medium">
              {item.branch || item.project || "Session Detail"}
            </h2>
            <p className="text-xs text-muted-foreground">
              {item.requirement_id && `${item.requirement_id} · `}
              {item.trigger} · {new Date(item.timestamp).toLocaleString()}
            </p>
          </div>
          <div className="flex items-center gap-1">
            {(item.status === "pending" || item.status === "failed") && (
              <button
                onClick={() => onRunArchive(item.id)}
                className="p-1.5 hover:bg-accent rounded text-xs flex items-center gap-1"
              >
                {item.status === "failed" ? (
                  <RotateCcw className="w-3.5 h-3.5" />
                ) : (
                  <Play className="w-3.5 h-3.5" />
                )}
                {item.status === "failed" ? "Retry" : "Archive"}
              </button>
            )}
            <button
              onClick={() => {
                onDeleteItem(item.id);
                onClose();
              }}
              className="p-1.5 hover:bg-accent rounded text-destructive"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
            <button onClick={onClose} className="p-1.5 hover:bg-accent rounded">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {item.result && (
            <div className="rounded border border-border p-3">
              <h3 className="text-xs font-medium mb-2">
                {item.status === "completed" ? "Archive Result" : "Error"}
              </h3>
              {item.result.error ? (
                <p className="text-xs text-destructive">{item.result.error}</p>
              ) : (
                <>
                  <p className="text-xs mb-2">{item.result.summary}</p>
                  {item.result.files_created.length > 0 && (
                    <div className="text-xs">
                      <span className="text-green-500 font-medium">Created: </span>
                      {item.result.files_created.join(", ")}
                    </div>
                  )}
                  {item.result.files_updated.length > 0 && (
                    <div className="text-xs">
                      <span className="text-blue-500 font-medium">Updated: </span>
                      {item.result.files_updated.join(", ")}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          <div>
            <h3 className="text-xs font-medium mb-2">Conversation</h3>
            <pre className="text-xs bg-muted rounded p-3 overflow-x-auto whitespace-pre-wrap max-h-96">
              {item.conversation}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
