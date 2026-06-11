import React from "react";
import ReactDOM from "react-dom/client";
import "./i18n";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./index.css";
import { isTauri } from "./lib/backend";

declare const __BUILD_TIME__: string;
console.log(`[Worktree Manager] build: ${__BUILD_TIME__}`);

// Tauri 桌面端：拦截 console.error/warn，异步转发到 Rust 日志系统
if (isTauri()) {
  const forward = (level: string, origFn: (...args: unknown[]) => void) =>
    (...args: unknown[]) => {
      origFn.apply(console, args);
      try {
        const message = args.map(a =>
          typeof a === 'string' ? a
            : a instanceof Error ? `${a.message}\n${a.stack ?? ''}`
            : JSON.stringify(a, null, 0)
        ).join(' ');
        import('@tauri-apps/api/core').then(({ invoke }) => {
          invoke('frontend_log', { level, message }).catch(() => {});
        });
      } catch { /* never break the app */ }
    };
  console.error = forward('error', console.error.bind(console));
  console.warn = forward('warn', console.warn.bind(console));

  window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason instanceof Error
      ? `${e.reason.message}\n${e.reason.stack ?? ''}`
      : String(e.reason);
    import('@tauri-apps/api/core').then(({ invoke }) => {
      invoke('frontend_log', { level: 'error', message: `[unhandledrejection] ${reason}` }).catch(() => {});
    });
  });
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
