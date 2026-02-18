export type TGWebApp = {
  initData?: string;
  initDataUnsafe?: any;
  ready?: () => void;
  expand?: () => void;
};

declare global {
  interface Window {
    Telegram?: { WebApp?: TGWebApp };
  }
}

export function getTelegramWebApp(): TGWebApp | null {
  return window.Telegram?.WebApp ?? null;
}
