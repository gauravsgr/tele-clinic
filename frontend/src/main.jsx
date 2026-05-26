/**
 * main.jsx — Application entry point.
 *
 * Bootstraps React 18 using the concurrent-mode `createRoot` API and mounts
 * the application into the `#root` div defined in `index.html`.
 *
 * Provider hierarchy (outermost → innermost):
 *   StrictMode → BrowserRouter → App (Routes)
 *
 * StrictMode:
 *   Enables additional runtime checks in development only (double-invocations
 *   of effects, deprecated API warnings). Has zero impact on production builds.
 *   Keep it in — it catches subtle bugs like missing cleanup functions in useEffect.
 *
 * BrowserRouter:
 *   Uses the HTML5 History API (pushState). Routes are defined in App.jsx:
 *     /       → PatientApp
 *     /doctor → DoctorApp
 *   The Vite dev server is configured with `historyApiFallback` (via default
 *   behaviour) so refreshing /doctor doesn't 404. In production, the web server
 *   (nginx/caddy) must also serve `index.html` for all routes.
 *
 * index.css is imported here (not in App.jsx) so that Tailwind base styles,
 * custom @layer components, and keyframe animations are loaded before any
 * component renders — avoiding a flash of unstyled content.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import './index.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
);
