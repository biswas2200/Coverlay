import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './App';
// The design is the stylesheet the clickable prototype already has: the same classes, the same look.
import '../src/css/app.css';

const root = document.getElementById('root');
if (!root) {
  throw new Error('index.html has no #root');
}

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
