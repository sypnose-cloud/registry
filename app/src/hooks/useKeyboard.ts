import { useEffect } from 'react';
import { useAppStore } from '../stores/appStore';

export function useKeyboard() {
  const {
    toggleSearch,
    toggleFilter,
    setSelectedNode,
    isSearchOpen,
    setSearchOpen,
    isFilterOpen,
    setFilterOpen,
    navigateHistoryBack,
    navigateHistoryForward,
    selectedNodeId,
  } = useAppStore();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      // Ctrl+K or Cmd+K — open search
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        toggleSearch();
        return;
      }

      // Escape — close panels in priority order
      if (e.key === 'Escape') {
        if (isSearchOpen) {
          setSearchOpen(false);
          return;
        }
        if (selectedNodeId) {
          setSelectedNode(null);
          return;
        }
        if (isFilterOpen) {
          setFilterOpen(false);
          return;
        }
        return;
      }

      // Skip remaining shortcuts when typing in an input
      if (isInput) return;

      // F — toggle filter bar
      if (e.key === 'f' || e.key === 'F') {
        toggleFilter();
        return;
      }

      // [ — navigate back in selection history
      if (e.key === '[') {
        navigateHistoryBack();
        return;
      }

      // ] — navigate forward in selection history
      if (e.key === ']') {
        navigateHistoryForward();
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    toggleSearch,
    toggleFilter,
    setSelectedNode,
    isSearchOpen,
    setSearchOpen,
    isFilterOpen,
    setFilterOpen,
    navigateHistoryBack,
    navigateHistoryForward,
    selectedNodeId,
  ]);
}
