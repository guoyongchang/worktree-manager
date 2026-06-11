import { createContext, useContext } from 'react';

export interface CellContextValue {
  cellId: string;      // "0-0", "0-1", "1-2", etc.
  isPrimary: boolean;  // cellId === "0-0"
}

export const CellContext = createContext<CellContextValue>({
  cellId: '0',
  isPrimary: true,
});

export function useCellContext(): CellContextValue {
  return useContext(CellContext);
}
