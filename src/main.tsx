import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css';
import App from './App.tsx'

// Discard the retired alert cache without inspecting its contents.
try {
  localStorage.removeItem('ews_cached_alerts');
} catch {
  // Storage can be unavailable in restricted browser contexts.
}

class ErrorBoundary extends Component<{children: ReactNode}, {hasError: boolean, error: Error|null, errorInfo: ErrorInfo|null}> {
  state = { hasError: false, error: null as Error | null, errorInfo: null as ErrorInfo | null };
  static getDerivedStateFromError(error: Error) { return { hasError: true, error, errorInfo: null }; }
  componentDidCatch(error: Error, errorInfo: ErrorInfo) { this.setState({ errorInfo }); console.error(error); }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '20px', backgroundColor: '#fef2f2', color: '#991b1b', height: '100vh', boxSizing: 'border-box' }}>
          <h2>Something went wrong.</h2>
          <details style={{ whiteSpace: 'pre-wrap', marginTop: '10px' }}>
            <summary>Click for error details</summary>
            {this.state.error?.toString()}
            <br />
            {this.state.errorInfo?.componentStack}
          </details>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
