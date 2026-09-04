<script lang="ts">
  /**
   * Repair documentation for the identified vehicle.
   *
   * Two lists and a viewer, mirroring what the original's MR/NT applet does:
   * pick the thing you are working on (`front brake pads`), then the manual
   * that covers it. The elements are the `<element lib>` entries of
   * `ArboRech-*-pdf-<FAMILY>.xml`; a document can hang off many of them, which
   * is why the same manual reappears under several names.
   */
  import type { DocElement, DocRef } from "@dialogysx/catalogue";
  import Icon from "./Icon.svelte";

  interface Props {
    elements: DocElement[];
    /** Every document across the visible elements, deduplicated. */
    documents: DocRef[];
    family: string | undefined;
    query: string;
    loading: boolean;
    /** The model has no family, so there is no documentation for it at all. */
    unavailable: boolean;
    notice: string | undefined;
    open: { doc: DocRef; url: string } | undefined;
    onQuery: (q: string) => void;
    onOpen: (doc: DocRef) => void;
    onClose: () => void;
  }

  let {
    elements,
    documents,
    family,
    query,
    loading,
    unavailable,
    notice,
    open,
    onQuery,
    onOpen,
    onClose,
  }: Props = $props();

  let selected = $state<number | undefined>(undefined);

  const current = $derived(
    selected === undefined ? undefined : elements.find((e) => e.id === selected),
  );

  // The element list is filtered live, so a selection can stop existing.
  // Falling back to the flat document list beats showing an empty pane.
  const shown = $derived(current?.docs ?? documents);

  const kindLabel = (k: DocRef["kind"]) => (k === "MR" ? "Repair method" : "Technical note");
</script>

<div class="docs">
  {#if unavailable}
    <p class="none">
      No repair documentation for this model. Its name is not in
      <code>pr/FamilleModeleAll.dat</code>, which is what maps a model to a document family —
      so the original has none for it either.
    </p>
  {:else if loading}
    <p class="none">reading the document indexes…</p>
  {:else if elements.length === 0}
    <p class="none">
      {query.trim().length > 0
        ? "Nothing matches that."
        : "No documents apply to this vehicle."}
    </p>
  {:else}
    <div class="head">
      <input
        data-testid="doc-query"
        type="search"
        placeholder="filter — brake, engine, MR-305…"
        value={query}
        oninput={(e) => onQuery(e.currentTarget.value)}
      />
      <span class="count" data-testid="doc-count">
        {elements.length} topics &middot; {documents.length} documents
        {#if family}<span class="dim">&middot; family {family}</span>{/if}
      </span>
    </div>

    {#if notice}<p class="notice">{notice}</p>{/if}

    <div class="cols">
      <ul class="elements" data-testid="doc-elements">
        <li>
          <button
            type="button"
            class:active={selected === undefined}
            onclick={() => (selected = undefined)}
          >
            <span class="t">All topics</span>
            <span class="n">{documents.length}</span>
          </button>
        </li>
        {#each elements as el (el.id)}
          <li>
            <button
              type="button"
              class:active={selected === el.id}
              onclick={() => (selected = el.id)}
            >
              <span class="t">{el.label || `#${el.id}`}</span>
              <span class="n">{el.docs.length}</span>
            </button>
          </li>
        {/each}
      </ul>

      <ul class="documents" data-testid="doc-list">
        {#each shown as doc (doc.kind + doc.numero)}
          <li>
            <button
              type="button"
              class:active={open?.doc.numero === doc.numero && open?.doc.kind === doc.kind}
              onclick={() => onOpen(doc)}
            >
              <span class="kind" class:nt={doc.kind === "NT"}>{doc.kind}</span>
              <span class="title">{doc.title}</span>
              <code>{doc.numero}</code>
            </button>
          </li>
        {/each}
      </ul>
    </div>

    {#if open}
      <div class="viewer">
        <div class="vhead">
          <span class="kind" class:nt={open.doc.kind === "NT"}>{open.doc.kind}</span>
          <strong>{open.doc.title}</strong>
          <code>{open.doc.numero}</code>
          <span class="dim">{kindLabel(open.doc.kind)}</span>
          <span class="spacer"></span>
          <!-- The browser's own PDF plugin does the rendering. Both actions are
               offered because a workshop wants the real viewer: an iframe
               cannot print reliably and cannot be annotated.

               Icons with `title` and an accessible name, not text: three words
               of chrome on every document crowded out the title, which is the
               only part of this bar anyone reads. -->
          <a
            class="act"
            href={open.url}
            target="_blank"
            rel="noopener"
            title="Open in a new tab"
            aria-label="Open in a new tab"><Icon name="external-link" /></a
          >
          <a
            class="act"
            href={open.url}
            download={`${open.doc.numero}.pdf`}
            title="Download"
            aria-label="Download"><Icon name="download" /></a
          >
          <button
            type="button"
            class="act close"
            onclick={onClose}
            title="Close"
            aria-label="Close"><Icon name="x" /></button
          >
        </div>
        <iframe
          title={`${open.doc.numero} — ${open.doc.title}`}
          src={open.url}
          data-testid="doc-frame"
        ></iframe>
      </div>
    {/if}
  {/if}
</div>

<style>
  .docs {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  .none {
    color: var(--ink-soft);
    font-size: 0.85rem;
    max-width: 44rem;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
  }
  input[type="search"] {
    font: inherit;
    font-size: 0.8rem;
    padding: 0.25rem 0.4rem;
    min-width: 18rem;
    border: 1px solid var(--rule);
    border-radius: 2px;
    background: var(--card);
    color: var(--ink);
  }
  input:focus-visible {
    outline: 2px solid var(--blue);
    outline-offset: 1px;
  }
  .count {
    font-size: 0.78rem;
    color: var(--ink-soft);
  }
  .dim {
    color: var(--ink-faint);
  }
  .notice {
    margin: 0;
    font-size: 0.78rem;
    color: var(--red);
  }
  .cols {
    display: grid;
    grid-template-columns: minmax(14rem, 1fr) minmax(0, 2fr);
    gap: 1rem;
    align-items: start;
  }
  @media (max-width: 62rem) {
    .cols {
      grid-template-columns: 1fr;
    }
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 26rem;
    overflow-y: auto;
    border: 1px solid var(--rule-soft);
    border-radius: 2px;
    background: var(--card);
  }
  li + li {
    border-top: 1px solid var(--rule-soft);
  }
  button {
    display: flex;
    width: 100%;
    gap: 0.6rem;
    align-items: baseline;
    padding: 0.28rem 0.5rem;
    border: 0;
    background: none;
    font: inherit;
    font-size: 0.8rem;
    color: var(--ink);
    text-align: left;
    cursor: pointer;
  }
  button:hover {
    background: var(--paper);
  }
  button.active {
    background: var(--blue);
    color: #fff;
  }
  button.active code,
  button.active .n,
  button.active .kind {
    color: rgb(255 255 255 / 80%);
  }
  .elements .t {
    flex: 1;
    min-width: 0;
  }
  .elements .n {
    font-family: var(--mono);
    font-size: 0.72rem;
    color: var(--ink-faint);
    flex: none;
  }
  .documents .title {
    flex: 1;
    min-width: 0;
  }
  code {
    font-family: var(--mono);
    font-size: 0.72rem;
    color: var(--ink-faint);
    flex: none;
  }
  .kind {
    font-family: var(--mono);
    font-size: 0.68rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    color: var(--blue);
    flex: none;
  }
  .kind.nt {
    color: var(--red);
  }
  .viewer {
    border: 1px solid var(--rule);
    border-radius: 2px;
    background: var(--card);
    overflow: hidden;
  }
  .vhead {
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
    padding: 0.35rem 0.5rem;
    border-bottom: 1px solid var(--rule-soft);
    font-size: 0.8rem;
    flex-wrap: wrap;
  }
  .spacer {
    flex: 1;
  }
  /* Icon actions: square hit area, no button chrome until hovered. */
  .act {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1.6rem;
    height: 1.6rem;
    flex: none;
    padding: 0;
    border: 0;
    border-radius: 2px;
    background: none;
    color: var(--ink-soft);
    cursor: pointer;
  }
  .act:hover {
    background: var(--paper);
    color: var(--ink);
  }
  .act:focus-visible {
    outline: 2px solid var(--blue);
    outline-offset: 1px;
  }
  .close:hover {
    color: var(--red);
  }
  iframe {
    display: block;
    width: 100%;
    height: 78vh;
    border: 0;
    background: var(--paper);
  }
</style>
