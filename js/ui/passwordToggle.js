// One reusable eye-icon show/hide toggle for a single password input --
// same "one instance per control" shape as SegmentedSetting, instantiated
// once per password field (sign-in/sign-up's #password, reset-confirm's
// #new-password) rather than one controller managing all of them, since
// each is fully independent and neither persists anything.
export class PasswordToggle {
  constructor(inputEl, buttonEl) {
    this._input = inputEl;
    this._button = buttonEl;
    this._button.addEventListener("click", () => this._toggle());
  }

  _toggle() {
    const nowShowing = this._input.type === "password";
    this._input.type = nowShowing ? "text" : "password";
    this._button.setAttribute("aria-pressed", String(nowShowing));
    this._button.setAttribute("aria-label", nowShowing ? "Hide password" : "Show password");
  }
}
