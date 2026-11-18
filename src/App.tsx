// Created by Jan Armel Java Ajeno. Copyright (c) 2026. All rights reserved.
import { Component, lazy, Suspense, useEffect, type ReactNode } from 'react';
import { useStore } from './state/store';
import { BusyOverlay, Toasts, useDarkMode } from './ui/common';
import { Home } from './ui/Home';
import { ImportDialog } from './ui/ImportDialog';

const Prepare = lazy(() => import('./ui/Prepare').then((m) => ({ default: m.Prepare })));
const Report = lazy(() => import('./ui/Report').then((m) => ({ default: m.Report })));

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="crash" role="alert">
        <h1>Something went wrong</h1>
        <p>{this.state.error.message}</p>
        <button className="btn primary" onClick={() => { location.hash = '/'; location.reload(); }}>Return to home</button>
      </div>
    );
  }
}

export function App() {
  const route = useStore((s) => s.route);
  const hasTable = useStore((s) => Boolean(s.table));
  const hasReport = useStore((s) => Boolean(s.report && s.engine));
  const pending = useStore((s) => Boolean(s.pending));
  const dark = useDarkMode();

  useEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : 'light'; }, [dark]);

  useEffect(() => {
    const sync = () => {
      const r = location.hash.replace(/^#\/?/, '');
      const st = useStore.getState();
      if (r === 'prepare' && st.table) useStore.setState({ route: 'prepare' });
      else if (r === 'report' && st.report && st.engine) useStore.setState({ route: 'report' });
      else { useStore.setState({ route: 'home' }); if (r) location.hash = '/'; }
    };
    sync();
    addEventListener('hashchange', sync);
    return () => removeEventListener('hashchange', sync);
  }, []);

  return (
    <ErrorBoundary>
      <Suspense fallback={<div className="page-loading"><span className="spinner" /></div>}>
        {route === 'report' && hasReport ? <Report /> : route === 'prepare' && hasTable ? <Prepare /> : <Home />}
      </Suspense>
      {pending && <ImportDialog />}
      <BusyOverlay />
      <Toasts />
    </ErrorBoundary>
  );
}
