import { supabase } from "./supabaseClient.js";
import { startApp, stopApp } from "./app.js";

const authScreen = document.getElementById("auth-screen");
const appScreen = document.getElementById("app");
const authForm = document.getElementById("auth-form");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const authError = document.getElementById("auth-error");
const authSubmit = document.getElementById("auth-submit");
const authToggle = document.getElementById("auth-toggle");
const signOutBtn = document.getElementById("sign-out");

let mode = "sign-in";

function setMode(next) {
  mode = next;
  authSubmit.textContent = mode === "sign-in" ? "Sign in" : "Sign up";
  authToggle.textContent =
    mode === "sign-in" ? "Need an account? Sign up" : "Have an account? Sign in";
  authError.textContent = "";
}

authToggle.addEventListener("click", () => {
  setMode(mode === "sign-in" ? "sign-up" : "sign-in");
});

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  authError.textContent = "";
  authSubmit.disabled = true;

  const email = emailInput.value.trim();
  const password = passwordInput.value;

  const { error, data } =
    mode === "sign-in"
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password });

  authSubmit.disabled = false;

  if (error) {
    authError.textContent = error.message;
    return;
  }

  if (mode === "sign-up" && !data.session) {
    authError.textContent = "Check your email to confirm your account, then sign in.";
    setMode("sign-in");
  }
});

signOutBtn.addEventListener("click", async () => {
  await supabase.auth.signOut();
});

function showApp() {
  authScreen.classList.add("hidden");
  appScreen.classList.remove("hidden");
  startApp();
}

function showAuth() {
  stopApp();
  appScreen.classList.add("hidden");
  authScreen.classList.remove("hidden");
  authForm.reset();
}

supabase.auth.onAuthStateChange((_event, session) => {
  if (session) {
    showApp();
  } else {
    showAuth();
  }
});
