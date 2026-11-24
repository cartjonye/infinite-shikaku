/**
 * Entry point. In the phone apps, saves live in native storage and are loaded
 * into memory first; on the web this resolves at once. Then the game starts.
 */
import { initKv } from './kv';

initKv()
  .catch(() => {
    /* storage unavailable: the game still runs, it just cannot save */
  })
  .then(() => import('./main'));
