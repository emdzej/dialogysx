<script lang="ts">
  /**
   * Writing a note about a part reference.
   *
   * Small on purpose: a note is a line or two, and a large editor invites a
   * document. The limit is enforced by the store, and shown here as a
   * remaining count so hitting it is not a surprise.
   */
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import X from "@lucide/svelte/icons/x";
  import { NOTE_LIMIT } from "./notes.js";
  import { notes } from "./notes.svelte.js";
  import { ui } from "./ui.svelte.js";

  let { ref, name, onClose }: { ref: string; name?: string; onClose: () => void } = $props();

  /*
   * Seeded from the store, once per reference.
   *
   * Not a `$derived`: that would overwrite what the user is typing every time
   * the store changed. Not a bare read at init either — that captures only the
   * first `ref` this component ever saw, which is correct today because the
   * dialog is mounted fresh per part and a latent bug the moment it is reused.
   * Keyed on `ref` inside an effect says what is actually meant.
   */
  let text = $state("");
  let existed = $state(false);
  let field = $state<HTMLTextAreaElement | undefined>(undefined);

  $effect(() => {
    const current = notes.get(ref) ?? "";
    text = current;
    existed = current !== "";
    field?.focus();
    field?.select();
  });

  const remaining = $derived(NOTE_LIMIT - text.trim().length);

  function save(): void {
    notes.set(ref, text);
    onClose();
  }

  function remove(): void {
    notes.remove(ref);
    onClose();
  }

  function onKey(event: KeyboardEvent): void {
    if (event.key === "Escape") onClose();
    // Enter saves; a note is one line and reaching for the mouse to commit it
    // is friction. Shift+Enter still breaks a line for the rare longer note.
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      save();
    }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<div class="scrim" role="presentation" onclick={onClose}>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="dialog"
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    aria-label={ui("note.edit", { ref })}
    data-testid="note-editor"
    onclick={(e) => e.stopPropagation()}
  >
    <header>
      <span class="eyebrow">{ui("note.title")}</span>
      <code>{ref}</code>
      {#if name}<span class="pname">{name}</span>{/if}
      <span class="spacer"></span>
      <button class="close" onclick={onClose} aria-label={ui("chrome.close")}>
        <X size={15} strokeWidth={1.9} />
      </button>
    </header>

    <textarea
      bind:this={field}
      bind:value={text}
      maxlength={NOTE_LIMIT}
      rows="3"
      placeholder={ui("note.placeholder")}
      aria-label={ui("note.edit", { ref })}
      data-testid="note-text"
      onkeydown={onKey}
    ></textarea>

    <footer>
      <span class="limit" class:low={remaining < 50}>{ui("note.limit", { count: remaining })}</span>
      <span class="spacer"></span>
      {#if existed}
        <button class="danger" onclick={remove} data-testid="note-delete">
          <Trash2 size={13} strokeWidth={1.9} /> {ui("note.delete")}
        </button>
      {/if}
      <button class="primary" onclick={save} data-testid="note-save">{ui("note.save")}</button>
    </footer>
  </div>
</div>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    background: color-mix(in srgb, var(--ink) 34%, transparent);
    display: grid;
    place-items: center;
    z-index: 45;
    padding: 1.5rem;
  }
  .dialog {
    width: min(28rem, 100%);
    background: var(--card);
    border: 1px solid var(--rule);
    border-radius: 4px;
    box-shadow: 0 12px 40px color-mix(in srgb, var(--ink) 22%, transparent);
    padding: 0.8rem 0.9rem 0.7rem;
  }
  header,
  footer {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  header {
    margin-bottom: 0.55rem;
  }
  footer {
    margin-top: 0.5rem;
  }
  .eyebrow {
    font-size: 0.7rem;
    letter-spacing: 0.09em;
    text-transform: uppercase;
    color: var(--dim);
  }
  code {
    font-family: var(--mono);
    font-size: 0.82rem;
  }
  .pname {
    font-size: 0.74rem;
    color: var(--dim);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .spacer {
    flex: 1;
  }
  .close {
    border: 0;
    background: none;
    color: var(--dim);
    cursor: pointer;
    padding: 0;
  }
  textarea {
    width: 100%;
    font: inherit;
    font-size: 0.86rem;
    resize: vertical;
    padding: 0.4rem 0.5rem;
    border: 1px solid var(--rule);
    border-radius: 3px;
    background: var(--bg);
    color: var(--ink);
  }
  textarea:focus-visible {
    outline: 2px solid var(--blue);
    outline-offset: -1px;
  }
  .limit {
    font-size: 0.7rem;
    color: var(--dim);
    font-variant-numeric: tabular-nums;
  }
  .limit.low {
    color: var(--red);
  }
  footer button {
    font: inherit;
    font-size: 0.8rem;
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.28rem 0.6rem;
    border: 1px solid var(--rule);
    border-radius: 3px;
    background: var(--card);
    color: var(--ink);
    cursor: pointer;
  }
  footer button.primary {
    border-color: var(--blue);
    color: var(--blue);
  }
  footer button.danger:hover {
    color: var(--red);
    border-color: var(--red);
  }
</style>
