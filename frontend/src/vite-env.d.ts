/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * WalletConnect Cloud project id (https://cloud.walletconnect.com).
   * Leave unset to run with injected wallets only ,no requests are then made
   * to WalletConnect. Never set this to a placeholder string.
   */
  readonly VITE_WALLETCONNECT_PROJECT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
