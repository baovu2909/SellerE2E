import { UiDropdownTree } from './dropdown-tree.js';
import { loadCategories } from './categories.js';

class UiDropdownCategories extends UiDropdownTree {
  #env = '';

  set env(v) {
    if (v === this.#env) return;
    this.#env = v;
    this.loader = () => loadCategories(v).then((j) => j.tree);
    this.load();
  }
}

customElements.define('ui-dropdown-categories', UiDropdownCategories);
