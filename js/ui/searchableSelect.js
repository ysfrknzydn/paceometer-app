// Autocomplete-style combobox wrapping a native <select> -- built for
// js/ui/vehiclePicker.js's Make/Model dropdowns (~150 makes, some models
// spanning 40+ model-years), where scrolling a plain <select> to find one
// entry is painful. The search box IS the dropdown here: typing opens a
// filtered popup listbox directly, rather than a separate search field
// sitting above a native <select> the user still has to open themselves.
//
// The underlying <select> stays the real form control -- hidden (`hidden`
// attribute, not just visually) but still holding the actual value and
// still the thing `change` fires on -- so VehiclePicker's existing
// `.value`/`addEventListener("change")`/`.disabled`/innerHTML-rebuild
// handling of these same <select> elements needed zero changes; this class
// only ever reads its <option>s and writes `.value` + dispatches `change`.
// A MutationObserver on the select's children rebuilds the popup and resets
// the input whenever VehiclePicker wipes and rebuilds a level's options
// (its cascading-reset pattern), so a stale query/list never lingers over
// freshly repopulated options.
export class SearchableSelect {
  constructor(selectEl, { placeholder = "Search…" } = {}) {
    this._select = selectEl;
    this._options = []; // [{ value, label }], excludes the "" placeholder option
    this._filtered = [];
    this._activeIndex = -1;
    this._idBase = selectEl.id || `searchable-select-${Math.random().toString(36).slice(2)}`;

    this._select.hidden = true;

    this._wrapper = document.createElement("div");
    this._wrapper.className = "searchable-select";
    selectEl.insertAdjacentElement("beforebegin", this._wrapper);

    this._input = document.createElement("input");
    this._input.type = "text";
    this._input.className = "searchable-select-input";
    this._input.placeholder = placeholder;
    this._input.autocomplete = "off";
    this._input.setAttribute("role", "combobox");
    this._input.setAttribute("aria-haspopup", "listbox");
    this._input.setAttribute("aria-expanded", "false");
    this._input.setAttribute("aria-autocomplete", "list");
    this._input.setAttribute("aria-controls", `${this._idBase}-listbox`);
    const ariaLabel = selectEl.getAttribute("aria-label");
    if (ariaLabel) this._input.setAttribute("aria-label", ariaLabel);

    this._list = document.createElement("ul");
    this._list.className = "searchable-select-list hidden";
    this._list.id = `${this._idBase}-listbox`;
    this._list.setAttribute("role", "listbox");

    this._wrapper.appendChild(this._input);
    this._wrapper.appendChild(this._list);
    this._wrapper.appendChild(selectEl);

    this._input.addEventListener("focus", () => this._openFull());
    this._input.addEventListener("click", () => {
      if (!this._isOpen()) this._openFull();
    });
    this._input.addEventListener("input", () => this._onInput());
    this._input.addEventListener("keydown", (e) => this._onKeydown(e));
    this._input.addEventListener("blur", () => this._onBlur());

    // mousedown (not click) + preventDefault so the input never loses focus
    // mid-selection -- a click alone would blur the input first, which
    // would close the list before the click on it could land.
    this._list.addEventListener("mousedown", (e) => this._onListMouseDown(e));
    this._list.addEventListener("mouseover", (e) => this._onListMouseOver(e));

    this._observer = new MutationObserver(() => this._rebuildFromSelect());
    this._observer.observe(this._select, { childList: true });

    this._rebuildFromSelect();
  }

  _rebuildFromSelect() {
    this._options = Array.from(this._select.options)
      .filter((option) => option.value !== "")
      .map((option) => ({ value: option.value, label: option.textContent }));
    this._input.disabled = this._select.disabled;
    this._close();
    this._syncInputToSelection();
  }

  _syncInputToSelection() {
    const selected = this._options.find((option) => option.value === this._select.value);
    this._input.value = selected ? selected.label : "";
  }

  _openFull() {
    if (this._input.disabled) return;
    this._input.select();
    this._show();
    this._renderList("");
  }

  _onInput() {
    this._show();
    this._renderList(this._input.value);
  }

  _show() {
    this._wrapper.classList.add("open");
    this._list.classList.remove("hidden");
    this._input.setAttribute("aria-expanded", "true");
  }

  _close() {
    this._wrapper.classList.remove("open");
    this._list.classList.add("hidden");
    this._input.setAttribute("aria-expanded", "false");
    this._input.removeAttribute("aria-activedescendant");
    this._activeIndex = -1;
  }

  _isOpen() {
    return !this._list.classList.contains("hidden");
  }

  _renderList(query) {
    const normalized = query.trim().toLowerCase();
    this._filtered = normalized
      ? this._options.filter((option) => option.label.toLowerCase().includes(normalized))
      : this._options.slice();

    this._list.innerHTML = "";
    this._filtered.forEach((option, index) => {
      const li = document.createElement("li");
      li.id = `${this._idBase}-opt-${index}`;
      li.setAttribute("role", "option");
      li.dataset.index = String(index);
      li.textContent = option.label;
      this._list.appendChild(li);
    });

    if (this._filtered.length === 0) {
      const empty = document.createElement("li");
      empty.className = "searchable-select-empty";
      empty.textContent = "No matches";
      this._list.appendChild(empty);
    }

    this._list.scrollTop = 0;
    this._activeIndex = this._filtered.length > 0 ? 0 : -1;
    this._highlightActive();
  }

  _highlightActive() {
    const items = this._list.querySelectorAll('li[role="option"]');
    items.forEach((li, index) => {
      const isActive = index === this._activeIndex;
      li.classList.toggle("active", isActive);
      li.setAttribute("aria-selected", String(isActive));
    });
    if (this._activeIndex >= 0) {
      const activeEl = items[this._activeIndex];
      this._input.setAttribute("aria-activedescendant", activeEl.id);
      activeEl.scrollIntoView({ block: "nearest" });
    } else {
      this._input.removeAttribute("aria-activedescendant");
    }
  }

  _moveActive(delta) {
    if (this._filtered.length === 0) return;
    this._activeIndex = (this._activeIndex + delta + this._filtered.length) % this._filtered.length;
    this._highlightActive();
  }

  _commit(option) {
    if (!option) return;
    this._select.value = option.value;
    this._input.value = option.label;
    this._close();
    this._select.dispatchEvent(new Event("change"));
  }

  _onKeydown(e) {
    if (this._input.disabled) return;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (!this._isOpen()) this._openFull();
        else this._moveActive(1);
        break;
      case "ArrowUp":
        e.preventDefault();
        if (!this._isOpen()) this._openFull();
        else this._moveActive(-1);
        break;
      case "Enter":
        if (this._isOpen() && this._activeIndex >= 0) {
          e.preventDefault();
          this._commit(this._filtered[this._activeIndex]);
        }
        break;
      case "Escape":
        if (this._isOpen()) {
          e.preventDefault();
          this._close();
          this._syncInputToSelection();
        }
        break;
    }
  }

  _onBlur() {
    // A list-item mousedown already preventDefaults to keep focus in the
    // input, so this is just a safety net for browsers/paths where blur
    // still fires before the mousedown handler runs.
    window.setTimeout(() => {
      this._close();
      this._syncInputToSelection();
    }, 0);
  }

  _onListMouseDown(e) {
    e.preventDefault();
    const li = e.target.closest("li[data-index]");
    if (!li) return;
    this._commit(this._filtered[Number(li.dataset.index)]);
  }

  _onListMouseOver(e) {
    const li = e.target.closest("li[data-index]");
    if (!li) return;
    const index = Number(li.dataset.index);
    if (index !== this._activeIndex) {
      this._activeIndex = index;
      this._highlightActive();
    }
  }
}
