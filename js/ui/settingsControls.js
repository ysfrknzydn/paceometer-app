// One reusable localStorage-backed segmented control, replacing what used to
// be three near-identical copy-pasted "wire buttons + sync aria-pressed +
// persist" blocks (Appearance / Zone Sensitivity / Sound). The initial saved
// value and any side effect of applying it are the composition root's job
// (app.js) -- this class only wires future clicks and keeps aria-pressed in
// sync, matching the original code's separation between "apply the saved
// setting at load" and "wire the buttons to change it later."
export class SegmentedSetting {
  constructor({ containerId, datasetKey, storageKey, initialValue, removeOnValue = null, onChange }) {
    this._datasetKey = datasetKey;
    const container = document.getElementById(containerId);
    this._options = container.querySelectorAll(".segmented-option");

    this._options.forEach((btn) => {
      btn.addEventListener("click", () => {
        const value = btn.dataset[datasetKey];
        if (value === removeOnValue) {
          localStorage.removeItem(storageKey);
        } else {
          localStorage.setItem(storageKey, value);
        }
        this._setButtonStates(value);
        onChange(value);
      });
    });

    this._setButtonStates(initialValue);
  }

  _setButtonStates(value) {
    this._options.forEach((btn) => {
      btn.setAttribute("aria-pressed", String(btn.dataset[this._datasetKey] === value));
    });
  }
}
