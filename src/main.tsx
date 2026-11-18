import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import './styles.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  addEventListener('load', () => { void navigator.serviceWorker.register('sw.js').catch(() => undefined); });
}
