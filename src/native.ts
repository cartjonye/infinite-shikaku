/**
 * Phone-app glue (Capacitor). Does nothing on the web, so the website and the
 * apps share every other line of code.
 */
import { Capacitor } from '@capacitor/core';
import { kv } from './kv';

export const isNative = Capacitor.isNativePlatform();

export interface NativeHooks {
  /** Handle the system back gesture. Return false to let the app close. */
  back(): boolean;
  /** Write the game state now (the OS may stop the app at any moment after this). */
  save(): void;
}

export async function setupNative(hooks: NativeHooks): Promise<void> {
  if (!isNative) return;
  const { App } = await import('@capacitor/app');
  // Android back button / back gesture (iOS has none)
  await App.addListener('backButton', () => {
    if (!hooks.back()) void App.exitApp();
  });
  // going to the background: save and push the write to native storage
  await App.addListener('pause', () => {
    hooks.save();
    void kv.flush();
  });
  document.documentElement.classList.add('native', `platform-${Capacitor.getPlatform()}`);
}
