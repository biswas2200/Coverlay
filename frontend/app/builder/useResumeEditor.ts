import { useEffect, useRef, useState, type RefObject } from 'react';
import { createResumeEditor } from '@legacy/pages/resume-editor.js';

export type ResumeEditor = ReturnType<typeof createResumeEditor>;

interface Handlers {
  onTyping: () => void;
  onSelection: () => void;
  onFocus: () => void;
  onBlur: (to: Element | null) => void;
}

/**
 * The Tiptap resume editor (src/js/pages/resume-editor.js) as a hook: it is made on the element in `host` while `enabled`
 * and destroyed when it is not or the page closes. `editor` (state) tells effects when it exists; `editorRef` is for
 * event handlers that need it at once. The handlers may change on every render; the editor always calls the latest.
 */
export function useResumeEditor(host: RefObject<HTMLElement | null>, enabled: boolean, handlers: Handlers) {
  const [editor, setEditor] = useState<ResumeEditor | null>(null);
  const editorRef = useRef<ResumeEditor | null>(null);
  const latest = useRef(handlers);
  latest.current = handlers;

  useEffect(() => {
    if (!enabled || !host.current) {
      return undefined;
    }
    const instance = createResumeEditor(host.current, {
      onTyping: () => latest.current.onTyping(),
      onSelection: () => latest.current.onSelection(),
      onFocus: () => latest.current.onFocus(),
      onBlur: (to) => latest.current.onBlur(to),
    });
    instance.onSkillButton(() => instance.addSkill());
    editorRef.current = instance;
    setEditor(instance);
    return () => {
      instance.destroy();
      editorRef.current = null;
      setEditor(null);
    };
  }, [enabled, host]);

  return { editor, editorRef };
}
