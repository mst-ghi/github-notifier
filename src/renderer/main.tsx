import { StrictMode } from 'react';
import './window-chrome.css';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { App } from './App';
import { Provider } from './components/Provider';
import { ToastProvider } from './components/Toaster';

/** `HashRouter` because the production build is loaded from a `file://` URL. */
const container = document.getElementById('root');
if (!container) {
  throw new Error('#root is missing from index.html');
}

createRoot(container).render(
  <StrictMode>
    <Provider>
      <ToastProvider>
        <HashRouter>
          <App />
        </HashRouter>
      </ToastProvider>
    </Provider>
  </StrictMode>
);
