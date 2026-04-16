import { useState, useEffect, useCallback } from "react";
import {
  getMemoryQueue,
  deleteMemoryQueueItem,
  runMemoryArchive,
} from "../lib/backend";
import type { QueueItemSummary } from "../types";

export function useMemoryQueue() {
  const [items, setItems] = useState<QueueItemSummary[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getMemoryQueue();
      setItems(data);
    } catch (e) {
      console.error("[MemoryQueue] Failed to fetch:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 10000);
    return () => clearInterval(interval);
  }, [refresh]);

  const runArchive = useCallback(
    async (id: string) => {
      try {
        await runMemoryArchive(id);
        setTimeout(refresh, 1000);
      } catch (e) {
        console.error("[MemoryQueue] Failed to run archive:", e);
      }
    },
    [refresh]
  );

  const deleteItem = useCallback(
    async (id: string) => {
      try {
        await deleteMemoryQueueItem(id);
        setItems((prev) => prev.filter((item) => item.id !== id));
      } catch (e) {
        console.error("[MemoryQueue] Failed to delete:", e);
      }
    },
    []
  );

  const pendingCount = items.filter((i) => i.status === "pending").length;
  const processingCount = items.filter((i) => i.status === "processing").length;

  return {
    items,
    loading,
    refresh,
    runArchive,
    deleteItem,
    pendingCount,
    processingCount,
  };
}
