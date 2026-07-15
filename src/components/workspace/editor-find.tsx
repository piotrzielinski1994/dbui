import { createRoot, type Root } from "react-dom/client";
import { EditorView, keymap, type Panel } from "@codemirror/view";
import { Prec, type Extension } from "@codemirror/state";
import {
  search,
  findNext,
  findPrevious,
  openSearchPanel,
  closeSearchPanel,
  setSearchQuery,
  getSearchQuery,
  SearchQuery,
} from "@codemirror/search";
import { FindBar } from "@/components/workspace/find-bar";

// The current query's total match count + the 1-based index of the match containing (or after) the
// cursor. Scans the doc with the search cursor - fine for an editor buffer (not a 200-row grid).
function matchStats(view: EditorView): { total: number; active: number } {
  const query = getSearchQuery(view.state);
  if (query.search.length === 0) {
    return { total: 0, active: 0 };
  }
  const cursor = query.getCursor(view.state);
  const head = view.state.selection.main.from;
  let total = 0;
  let active = 0;
  let next = cursor.next();
  while (!next.done) {
    total += 1;
    if (active === 0 && next.value.from >= head) {
      active = total;
    }
    next = cursor.next();
  }
  return { total, active: total > 0 && active === 0 ? total : active };
}

// A CodeMirror search panel that renders the shared dbui FindBar (design.md styled) instead of the
// library's default panel, driving the standard search commands. Mounted at the top of the editor.
class FindPanel implements Panel {
  readonly dom: HTMLDivElement;
  readonly top = true;
  private root: Root | null = null;

  constructor(private readonly view: EditorView) {
    this.dom = document.createElement("div");
    this.dom.className = "cm-dbui-find";
    // Keep the panel's own keystrokes out of the editor's keymap.
    this.dom.addEventListener("keydown", (event) => event.stopPropagation());
  }

  mount() {
    this.root = createRoot(this.dom);
    this.render();
  }

  update() {
    this.render();
  }

  destroy() {
    // Defer so React does not unmount synchronously inside CodeMirror's own dispatch.
    const root = this.root;
    this.root = null;
    if (root) {
      queueMicrotask(() => root.unmount());
    }
  }

  private setQuery(text: string) {
    const current = getSearchQuery(this.view.state);
    this.view.dispatch({
      effects: setSearchQuery.of(
        new SearchQuery({
          search: text,
          caseSensitive: current.caseSensitive,
          regexp: current.regexp,
          wholeWord: current.wholeWord,
        }),
      ),
    });
    findNext(this.view);
  }

  private render() {
    if (!this.root) {
      return;
    }
    const query = getSearchQuery(this.view.state);
    const { total, active } = matchStats(this.view);
    this.root.render(
      <FindBar
        query={query.search}
        onQueryChange={(text) => this.setQuery(text)}
        activeIndex={active}
        total={total}
        onNext={() => findNext(this.view)}
        onPrev={() => findPrevious(this.view)}
        onClose={() => {
          closeSearchPanel(this.view);
          this.view.focus();
        }}
        onSubmit={(backwards) =>
          backwards ? findPrevious(this.view) : findNext(this.view)
        }
      />,
    );
  }
}

// The editor find extension: a dbui-styled search panel opened by the resolved open-find binding
// (bridged to its CodeMirror key form, e.g. "Mod-f"). Shared by the SQL, JS, and JSON editors.
export function editorFind(openKey: string): Extension {
  return [
    search({ top: true, createPanel: (view) => new FindPanel(view) }),
    Prec.highest(
      keymap.of([
        {
          key: openKey,
          run: (view) => {
            openSearchPanel(view);
            return true;
          },
        },
      ]),
    ),
  ];
}
