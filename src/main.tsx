// Created by Jan Armel Java Ajeno. Copyright (c) 2026. All rights reserved.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import './styles.css';
import { App } from './App';

// Other websites may not embed this site, which prevents hidden-click attacks.
if (window.top === window.self) {
  createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
} else {
  document.body.textContent = 'For your security, this site cannot be shown inside another page.';
}

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  addEventListener('load', () => { void navigator.serviceWorker.register('sw.js').catch(() => undefined); });
}
