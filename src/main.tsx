import './index.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
// Optional diagnostics helper removed — avoid hard import so dev server doesn't fail
// If you need diagnostics during development, re-add a module at ./utils/diagnosticsDump

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);