import { createContext, useContext } from 'react';

interface ShellContext {
  navOpen: boolean;
  openNav: () => void;
  closeNav: () => void;
  openBugReport: () => void;
}

export const ShellContext = createContext<ShellContext>({
  navOpen: false,
  openNav: () => undefined,
  closeNav: () => undefined,
  openBugReport: () => undefined,
});

export const useShell = () => useContext(ShellContext);
