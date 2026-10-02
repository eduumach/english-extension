import { useEffect, useState } from "react";

// Live view of a chrome.storage.local key. The video tab, popup and hub all
// write to the same storage, so every screen stays in sync through onChanged.
export function useStorage<T>(key: string, fallback: T): [T, boolean] {
  const [value, setValue] = useState<T>(fallback);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let stale = false;
    // The key can change (e.g. per-language data): show the new key's value, not the old one.
    browser.storage.local.get(key).then((data) => {
      if (stale) return;
      setValue(data[key] !== undefined ? (data[key] as T) : fallback);
      setLoaded(true);
    });
    const onChange = (changes: Record<string, { newValue?: unknown }>, area: string) => {
      if (area === "local" && changes[key]) setValue((changes[key].newValue ?? fallback) as T);
    };
    browser.storage.onChanged.addListener(onChange);
    return () => {
      stale = true;
      browser.storage.onChanged.removeListener(onChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return [value, loaded];
}

export function setStorage(key: string, value: unknown) {
  return browser.storage.local.set({ [key]: value });
}
