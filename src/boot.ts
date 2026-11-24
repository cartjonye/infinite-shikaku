/**
 * Entry point. Shows the loading mark at once, loads saves (native storage in the
 * phone apps; instant on the web), then starts the game, which removes the loader.
 */
import './style.css';
import { brandArt } from './art';
import { initKv } from './kv';

const art = document.querySelector('#boot .boot-art');
if (art) art.innerHTML = brandArt();

initKv()
  .catch(() => {
    /* storage unavailable: the game still runs, it just cannot save */
  })
  .then(() => import('./main'));
