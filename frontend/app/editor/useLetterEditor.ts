import { useEffect, useRef } from 'react';
import { createLetterEditor } from '@legacy/pages/letter-editor.js';

type LetterEditor = ReturnType<typeof createLetterEditor>;

interface Options {
  /** A new key makes a new editor: another draft, another recipient, a reset. Typing never changes it. */
  mountKey: string;
  /** The editor document to start from (read once per mount). */
  makeDoc: () => object;
  label: string;
  onChange: () => void;
  onSelection: () => void;
  onBlur: (to: Element | null) => void;
}

/**
 * The Tiptap editor on a cover letter or a cold email (src/js/pages/letter-editor.js), as a hook: it makes the editor on
 * the element in `host` and destroys it when `mountKey` changes or the page closes. The callbacks may change on every
 * render; the editor always calls the latest.
 */
export function useLetterEditor({ mountKey, makeDoc, label, onChange, onSelection, onBlur }: Options) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<LetterEditor | null>(null);
  const latest = useRef({ makeDoc, onChange, onSelection, onBlur });
  latest.current = { makeDoc, onChange, onSelection, onBlur };

  useEffect(() => {
    if (!host.current) {
      return undefined;
    }
    const instance = createLetterEditor(host.current, {
      doc: latest.current.makeDoc(),
      label,
      onChange: () => latest.current.onChange(),
      onSelection: () => latest.current.onSelection(),
      onBlur: (to: Element | null) => latest.current.onBlur(to),
    });
    editor.current = instance;
    latest.current.onSelection();
    return () => {
      instance.destroy();
      editor.current = null;
    };
  }, [mountKey, label]);

  return { host, editor };
}
