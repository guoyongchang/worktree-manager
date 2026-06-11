import { useState, useCallback } from 'react';

export interface ModalStates {
  showCreateModal: boolean;
  showAddWorkspaceModal: boolean;
  showCreateWorkspaceModal: boolean;
  showAddProjectModal: boolean;
  showAddProjectToWorktreeModal: boolean;
  showArchived: boolean;
  showWorkspaceMenu: boolean;
  showEditorMenu: boolean;
}

const initialModalStates: ModalStates = {
  showCreateModal: false,
  showAddWorkspaceModal: false,
  showCreateWorkspaceModal: false,
  showAddProjectModal: false,
  showAddProjectToWorktreeModal: false,
  showArchived: false,
  showWorkspaceMenu: false,
  showEditorMenu: false,
};

export interface UseModalsReturn extends ModalStates {
  setModal: <K extends keyof ModalStates>(key: K, value: ModalStates[K]) => void;
  toggleModal: (key: keyof ModalStates) => void;
  closeAll: () => void;
}

export function useModals(): UseModalsReturn {
  const [modals, setModals] = useState<ModalStates>(initialModalStates);

  const setModal = useCallback(<K extends keyof ModalStates>(key: K, value: ModalStates[K]) => {
    setModals(prev => ({ ...prev, [key]: value }));
  }, []);

  const toggleModal = useCallback((key: keyof ModalStates) => {
    setModals(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const closeAll = useCallback(() => {
    setModals(initialModalStates);
  }, []);

  return {
    ...modals,
    setModal,
    toggleModal,
    closeAll,
  };
}
