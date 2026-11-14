import type { Ref } from 'react';
import { Fragment } from 'react';
import type { BuilderFormat } from '@/types/builder';
import type { Resume } from '@/types/resume';
import { tableClass, tableStyle } from '@legacy/pages/resume-doc.js';
import { isRichPath, normalizeFormat, parseInline, safeHref, sentences } from '@legacy/pages/resume-builder-rules.js';
import { cssTextToStyle, paperClasses, paperVars } from './model';

// A resume drawn as a page, read-only: a version being looked at, and the finished resume. (The page being edited is the
// Tiptap editor, see useResumeEditor.ts.) Formatted text is built as elements, never parsed as HTML.

interface Segment {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string | null;
  href?: string | null;
}

/** Formatted text (the small markup of RB-DATA-03) as elements. */
function Rich({ markup }: { markup: string }) {
  return (
    <>
      {(parseInline(markup) as Segment[]).map((segment, index) => {
        let node: React.ReactNode = segment.text;
        if (segment.italic) {
          node = <i>{node}</i>;
        }
        if (segment.bold) {
          node = <b>{node}</b>;
        }
        if (segment.underline) {
          node = <u>{node}</u>;
        }
        if (segment.color) {
          node = <span style={{ color: segment.color }}>{node}</span>; // parseInline only returns a vetted #rrggbb
        }
        if (segment.href) {
          node = <a href={segment.href} target="_blank" rel="noopener noreferrer">{node}</a>;
        }
        return <Fragment key={index}>{node}</Fragment>;
      })}
    </>
  );
}

interface EditorNode {
  type?: string;
  text?: string;
  marks?: { type: string; attrs?: { href?: string } }[];
  attrs?: Record<string, unknown>;
  content?: EditorNode[];
}

/** Editor inline text (with bold, italic, underline and links) as elements. */
function Inline({ content }: { content?: EditorNode[] }) {
  return (
    <>
      {(content ?? []).map((node, index) => {
        let out: React.ReactNode = node.text ?? '';
        for (const mark of node.marks ?? []) {
          if (mark.type === 'bold') {
            out = <strong>{out}</strong>;
          } else if (mark.type === 'italic') {
            out = <em>{out}</em>;
          } else if (mark.type === 'underline') {
            out = <u>{out}</u>;
          } else if (mark.type === 'link' && safeHref(mark.attrs?.href)) {
            out = <a href={safeHref(mark.attrs?.href) as string}>{out}</a>;
          }
        }
        return <Fragment key={index}>{out}</Fragment>;
      })}
    </>
  );
}

/** The blocks of a custom section (paragraphs, bullet lists, tables). */
function Blocks({ nodes }: { nodes?: EditorNode[] }) {
  return (
    <>
      {(nodes ?? []).map((node, index) => {
        if (node.type === 'bulletList') {
          return (
            <ul className="rb-bullets" key={index}>
              {(node.content ?? []).map((item, i) => (
                <li key={i}>{(item.content ?? []).map((paragraph, j) => <Inline key={j} content={paragraph.content} />)}</li>
              ))}
            </ul>
          );
        }
        if (node.type === 'table') {
          return (
            <table className={tableClass(node.attrs)} style={cssTextToStyle(tableStyle(node.attrs))} key={index}>
              <tbody>
                {(node.content ?? []).map((row, i) => (
                  <tr key={i}>
                    {(row.content ?? []).map((cell, j) => (cell.type === 'tableHeader' ? <th key={j}><Blocks nodes={cell.content} /></th> : <td key={j}><Blocks nodes={cell.content} /></td>))}
                  </tr>
                ))}
              </tbody>
            </table>
          );
        }
        return <p key={index}><Inline content={node.content} /></p>;
      })}
    </>
  );
}

interface Props {
  resume: Resume;
  templateId: string | null;
  format: BuilderFormat;
  label: string;
  id?: string;
  hidden?: boolean;
  ref?: Ref<HTMLElement>;
}

function Field({ tag: Tag, path, value, format, className = '' }: { tag: 'h2' | 'p' | 'li'; path: string; value: string; format: BuilderFormat; className?: string }) {
  const rich = isRichPath(path);
  const bullets = format.bullets && /^experience\.\d+\.details$/.test(path);
  if (bullets) {
    return (
      <ul className={`rb-field rb-bullets ${className}`.trim()} data-path={path}>
        {(sentences(value) as string[]).map((sentence, index) => <li key={index}><Rich markup={sentence} /></li>)}
      </ul>
    );
  }
  return (
    <Tag className={`rb-field ${className}`.trim()} data-path={path} data-rich={rich ? '' : undefined}>
      {rich ? <Rich markup={value} /> : value}
    </Tag>
  );
}

export function Paper({ resume, templateId, format, label, id, hidden, ref }: Props) {
  const f = normalizeFormat(format) as BuilderFormat;
  const section = (title: string, ...children: React.ReactNode[]) => (
    <section className="rb-section" data-node={`${title.toLowerCase()}Section`}>
      <h3>{title}</h3>
      {children}
    </section>
  );
  const summary = section('Summary', <Field tag="p" path="summary" value={resume.summary} format={f} />);
  const experience = section(
    'Experience',
    ...resume.experience.map((job, i) => (
      <div className="rb-item" key={i}>
        <div className="rb-item-head">
          <Field tag="p" path={`experience.${i}.role`} value={job.role} format={f} className="rb-strong" />
          <Field tag="p" path={`experience.${i}.dates`} value={job.dates} format={f} className="rb-dates" />
        </div>
        <Field tag="p" path={`experience.${i}.details`} value={job.details} format={f} />
      </div>
    )),
  );
  const education = section(
    'Education',
    ...resume.education.map((school, i) => (
      <div className="rb-item-head" key={i}>
        <Field tag="p" path={`education.${i}.degree`} value={school.degree} format={f} className="rb-strong" />
        <Field tag="p" path={`education.${i}.dates`} value={school.dates} format={f} className="rb-dates" />
      </div>
    )),
  );
  const skills = section(
    'Skills',
    <ul className="rb-skills">
      {resume.skills.map((skill, i) => <Field key={i} tag="li" path={`skills.${i}`} value={skill} format={f} />)}
    </ul>,
  );
  const custom = (resume.extra ?? []).map((extra, index) => (
    <section className="rb-section rb-custom" key={index}>
      <h3>{extra.title}</h3>
      <Blocks nodes={extra.body as EditorNode[]} />
    </section>
  ));

  return (
    <article ref={ref} id={id} className={paperClasses(templateId, f, false)} style={paperVars(f)} aria-label={label} hidden={hidden}>
      <div className="rb-sheet">
        <header className="rb-head">
          <Field tag="h2" path="name" value={resume.name} format={f} className="rb-name" />
          <Field tag="p" path="contact" value={resume.contact} format={f} className="rb-contact" />
        </header>
        {f.columns === 2 ? (
          <div className="rb-columns">
            <div className="rb-col-main">{summary}{experience}{custom}</div>
            <div className="rb-col-side">{education}{skills}</div>
          </div>
        ) : (
          <>
            {summary}{experience}{education}{skills}{custom}
          </>
        )}
      </div>
    </article>
  );
}

