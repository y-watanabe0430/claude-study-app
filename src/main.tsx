import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app';
import './styles.css';

const onUpdateReady: { current: (() => void) | null } = { current: null };

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App onUpdateReady={onUpdateReady} />
  </StrictMode>,
);

// PWA: 静的アセットだけをキャッシュする。更新は利用者の操作で適用する
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('./sw.js');
      const notify = () => reg.waiting && navigator.serviceWorker.controller && onUpdateReady.current?.();
      notify();
      reg.addEventListener('updatefound', () => reg.installing?.addEventListener('statechange', notify));
      let reloading = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloading) { reloading = true; location.reload(); } });
      // 今回読み込んだ静的ファイルをキャッシュさせ、初回後にオフラインで動くようにする
      const ready = await navigator.serviceWorker.ready;
      const urls = performance.getEntriesByType('resource').map((r) => r.name).filter((u) => u.startsWith(location.origin));
      ready.active?.postMessage({ type: 'CACHE_URLS', urls: [location.href.split('#')[0], ...urls] });
    } catch { /* SW が使えなくてもアプリは動く */ }
  });
}
