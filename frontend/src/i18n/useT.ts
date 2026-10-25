// The hook of the localisation.
//
// The core of the localisation knows nothing of the interface; this module is
// the bridge: a component that calls `useT()` redraws itself when the language
// of the user changes.
import { useEffect, useState } from 'preact/hooks';
import { getLanguage, subscribeLanguage, t, type Translator } from './index';

export type { Translator };

/**
 * The function that translates a string in the current language.
 *
 * The component that calls the hook redraws itself when the language changes,
 * so the text it draws is always the text of the current language.
 */
export function useT(): Translator {
  const [, setVersion] = useState(0);
  useEffect(() => {
    return subscribeLanguage(() => setVersion((version) => version + 1));
  }, []);
  return t;
}

/** The language of the user, as a component sees it. */
export function useLanguage(): string {
  const [language, setLanguage] = useState(getLanguage());
  useEffect(() => {
    return subscribeLanguage(() => setLanguage(getLanguage()));
  }, []);
  return language;
}
