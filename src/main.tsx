import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import WatchView from './components/WatchView';
import './index.css';

// Rota de telespectador (sem login): /watch/<id>
const watch = window.location.pathname.match(/^\/watch\/([^/]+)/);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {watch ? <WatchView id={decodeURIComponent(watch[1])} /> : <App />}
  </React.StrictMode>
);
