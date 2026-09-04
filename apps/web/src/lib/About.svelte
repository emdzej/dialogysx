<!--
  What this program is, what it is not, and what you may not do with the data.

  Reached from the wordmark, which is where people look. Four things, in the
  order someone opening it needs them: what dialogysx does, where it came from,
  where to get the source — and the two caveats, which are last but styled
  loudest, because both are easy to be caught out by. One is legal (the
  catalogue is Renault's and does not travel with the program), the other is
  technical (the applicability grammar is reverse-engineered and no parts list
  has yet been checked against an independently known answer).

  Not a credits screen.
-->
<script lang="ts">
  interface Props {
    onClose: () => void;
  }
  let { onClose }: Props = $props();

  function onKey(event: KeyboardEvent): void {
    if (event.key === "Escape") onClose();
  }
</script>

<svelte:window onkeydown={onKey} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<div class="scrim" role="presentation" onclick={onClose}>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="dialog"
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    aria-label="About dialogysx"
    data-testid="about"
    onclick={(e) => e.stopPropagation()}
  >
    <header>
      <span class="eyebrow">About</span>
      <button class="close" onclick={onClose} aria-label="Close">×</button>
    </header>

    <div class="body">
      <p class="lede">
        <span class="mark">dialogys<span class="accent">x</span></span>
        <span class="ver">{__APP_VERSION__}</span>
      </p>

      <p>
        A parts catalogue and repair-documentation browser for Renault and Dacia vehicles: pick a
        model and a vehicle, and it shows the exploded drawings with the part numbers that fit,
        plus the workshop manuals and technical notes that apply.
      </p>

      <p>
        It runs entirely in the browser. Nothing is uploaded and there is no server component —
        the catalogue's own <code>(position, length)</code> addressing is read with HTTP
        <code>Range</code> requests, or straight off a folder on this machine, so the multi-gigabyte
        data files are sampled rather than downloaded.
      </p>

      <p>
        A clean-room reimplementation of Renault's <strong>Dialogys</strong> 7.5.6, written from
        its data formats. Not affiliated with, endorsed by, or supported by Renault.
      </p>

      <div class="links">
        <a class="primary" href={`${__REPO_URL__}/blob/main/docs/data-format.md`} target="_blank" rel="noopener noreferrer">
          Format notes
        </a>
        <a href={__REPO_URL__} target="_blank" rel="noopener noreferrer">Source</a>
        <a href={`${__REPO_URL__}/issues`} target="_blank" rel="noopener noreferrer">Report a problem</a>
      </div>

      <div class="caveat">
        <h2>The data is not included, and not redistributable</h2>
        <p>
          The catalogue, the drawings and the repair documents are Renault/Dacia's. This program
          reads a tree you build yourself from discs you have; it ships no vehicle data and gives
          you no right to pass any on.
        </p>
      </div>

      <div class="caveat warn">
        <h2>Check anything you rely on</h2>
        <p>
          The applicability rules were recovered by reading the original program, and they hold
          across all 41,758 plates in the catalogue. That is <em>not</em> the same as a verified
          parts list: no result here has yet been checked against an independently known answer.
          Confirm a part number before you buy or fit it.
        </p>
      </div>

      <p class="licence">
        Licensed under <a
          href="https://polyformproject.org/licenses/noncommercial/1.0.0/"
          target="_blank"
          rel="noopener noreferrer">PolyForm Noncommercial 1.0.0</a
        >. Provided as is, without warranty of any kind.
      </p>
    </div>
  </div>
</div>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 40;
    display: grid;
    place-items: center;
    padding: 24px;
    background: rgb(16 21 28 / 45%);
  }
  .dialog {
    width: 100%;
    max-width: 560px;
    max-height: 100%;
    overflow-y: auto;
    background: var(--card);
    border: 1px solid var(--rule);
    border-left: 3px solid var(--blue);
  }
  header {
    display: flex;
    align-items: center;
    padding: 12px 16px 8px;
  }
  .eyebrow {
    font-size: 9.5px;
    font-weight: 700;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--ink-faint);
  }
  .close {
    margin-left: auto;
    padding: 0 6px;
    border: 0;
    background: none;
    font-size: 20px;
    line-height: 1;
    color: var(--ink-faint);
    cursor: pointer;
  }
  .close:hover {
    color: var(--ink);
  }
  .body {
    padding: 0 16px 16px;
  }
  .lede {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin: 0 0 12px;
  }
  .mark {
    font-size: 19px;
    font-weight: 800;
    letter-spacing: 0.03em;
    color: var(--ink);
  }
  .mark .accent {
    color: var(--red);
  }
  .ver {
    font-family: var(--mono);
    font-size: 11.5px;
    font-variant-numeric: tabular-nums;
    color: var(--ink-faint);
  }
  .body p {
    margin: 0 0 10px;
    font-size: 12.5px;
    line-height: 1.55;
    color: var(--ink-soft);
  }
  code {
    font-family: var(--mono);
    font-size: 11.5px;
  }
  a {
    color: var(--blue);
  }
  .links {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem 1rem;
    margin: 14px 0 4px;
    font-size: 12.5px;
  }
  .links .primary {
    font-weight: 600;
  }
  .caveat {
    margin-top: 16px;
    padding: 10px 0 0 12px;
    border-top: 1px solid var(--rule);
    border-left: 2px solid var(--blue);
  }
  .caveat.warn {
    border-left-color: var(--red);
  }
  .caveat h2 {
    margin: 0 0 6px;
    font-size: 12.5px;
    font-weight: 700;
    color: var(--ink);
  }
  .caveat p {
    margin: 0;
  }
  .licence {
    margin-top: 16px !important;
    font-size: 11.5px !important;
    color: var(--ink-faint) !important;
  }
</style>
