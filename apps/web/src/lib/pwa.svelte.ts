/**
 * Installability, updates, and knowing when the network is gone.
 *
 * The service worker caches the **shell** and nothing else. A data tree is
 * between 0.85 GB for the catalogue and 15.30 GB with the repair manuals, so
 * precaching one is not on the table; caching reads as they happen would leave
 * the app offline for whichever plates someone happened to open and broken for
 * the rest, which is worse than being plainly unavailable.
 *
 * So what this buys is narrower than "offline" and worth stating: the page
 * itself opens with no network. A tree in a folder on this machine then works
 * exactly as it always did — it never needed the network — and an HTTP tree
 * does not, which the interface says rather than failing obscurely.
 */
import { registerSW } from "virtual:pwa-register";

class Pwa {
  /** A new version is downloaded and waiting for a reload. */
  updateReady = $state(false);
  /** The browser thinks there is no network. */
  offline = $state(false);
  private apply: (reload?: boolean) => Promise<void> = async () => {};

  constructor() {
    if (typeof navigator !== "undefined") this.offline = navigator.onLine === false;
    if (typeof window !== "undefined") {
      // `online`/`offline` are the only signal available, and they mean "this
      // machine has a network interface", not "the tree is reachable". Good
      // enough to explain a failure, not good enough to predict one — which is
      // why nothing here blocks a read.
      window.addEventListener("online", () => (this.offline = false));
      window.addEventListener("offline", () => (this.offline = true));
    }
    this.apply = registerSW({
      immediate: true,
      onNeedRefresh: () => (this.updateReady = true),
    });
  }

  /** Take the waiting version and reload. */
  async update(): Promise<void> {
    this.updateReady = false;
    await this.apply(true);
  }
}

export const pwa = new Pwa();
