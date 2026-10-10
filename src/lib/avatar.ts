export type Avatar = "man" | "woman";

const KEY = "skootayiko.avatar";

export function loadAvatar(): Avatar | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === "man" || v === "woman" ? v : null;
  } catch {
    return null;
  }
}

export function saveAvatar(a: Avatar): void {
  try {
    localStorage.setItem(KEY, a);
  } catch {
    // Storage unavailable (private mode): the choice still travels in the URL.
  }
}

export function parseAvatar(v: string | null | undefined): Avatar | null {
  return v === "man" || v === "woman" ? v : null;
}
