import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import WatchView from './components/WatchView';
import PlayerPortalView from './components/PlayerPortalView';
import './index.css';
import { applyTheme, loadTheme } from './theme';

// Personalização visual salva (cores/fontes/zoom) — aplica antes de renderizar.
applyTheme(loadTheme());

// Rota de telespectador (sem login): /watch/<id>
const watch = window.location.pathname.match(/^\/watch\/([^/]+)/);
// Portal do jogador (sem login): /jogar (torneio público atual) ou /jogar/<publicId>
const jogar = window.location.pathname.match(/^\/jogar(?:\/([^/]+))?\/?$/);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {watch ? <WatchView id={decodeURIComponent(watch[1])} />
      : jogar ? <PlayerPortalView publicId={jogar[1] ? decodeURIComponent(jogar[1]) : null} />
      : <App />}
  </React.StrictMode>
);
