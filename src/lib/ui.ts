// Context menus and dialogs, shown from anywhere.
import type { ReactNode } from "react";
import { create } from "zustand";

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  action?: () => void;
  danger?: boolean;
  disabled?: boolean;
  checked?: boolean;
  submenu?: MenuItem[];
  shortcut?: string;
}

export type MenuEntry = MenuItem | "separator" | { header: string };

interface UIState {
  menu: { items: MenuEntry[]; x: number; y: number } | null;
  dialogs: { id: number; render: (close: () => void) => ReactNode }[];
}

export const useUI = create<UIState>(() => ({ menu: null, dialogs: [] }));

export function showMenu(e: { clientX: number; clientY: number; preventDefault?: () => void; stopPropagation?: () => void }, items: MenuEntry[]) {
  e.preventDefault?.();
  e.stopPropagation?.();
  useUI.setState({ menu: { items, x: e.clientX, y: e.clientY } });
}

/** Opens a menu below a button. */
export function showMenuAt(el: Element, items: MenuEntry[]) {
  const r = el.getBoundingClientRect();
  useUI.setState({ menu: { items, x: r.left, y: r.bottom + 6 } });
}

export const closeMenu = () => useUI.setState({ menu: null });

let dialogId = 0;
export function openDialog(render: (close: () => void) => ReactNode) {
  const id = ++dialogId;
  const close = () => useUI.setState((s) => ({ dialogs: s.dialogs.filter((d) => d.id !== id) }));
  useUI.setState((s) => ({ dialogs: [...s.dialogs, { id, render }] }));
  return close;
}
