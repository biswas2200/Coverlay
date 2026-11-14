import { useState, type FormEvent } from 'react';
import { Icon } from '@/components/Icon';
import type { BuilderAnswers } from '@/types/builder';
import { answersSummary, normalizeText, suggestTemplates } from '@legacy/pages/resume-builder-rules.js';

// The Builder's first two steps (a few questions, then templates suggested from the answers) and its last (finished).

const LEVELS = [['student', 'Student'], ['fresher', 'Fresher'], ['junior', '1-3 yrs'], ['senior', '3+ yrs']] as const;
const STYLES = [['simple', 'Simple'], ['modern', 'Modern'], ['academic', 'Academic'], ['classic', 'Classic (LaTeX look)']] as const;
const LENGTHS = [['1', '1 page'], ['2', '2 pages']] as const;

function Choices({ legend, name, options, value, onChange }: { legend: string; name: string; options: readonly (readonly [string, string])[]; value: string; onChange: (value: string) => void }) {
  return (
    <fieldset className="rb-question">
      <legend>{legend}</legend>
      <div className="rb-choices">
        {options.map(([optionValue, label]) => (
          <label className="rb-choice" key={optionValue}>
            <input type="radio" name={name} value={optionValue} checked={value === optionValue} onChange={() => onChange(optionValue)} />
            <span>{label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function StartStep({ answers, holdingRequest, onSubmit }: { answers: BuilderAnswers; holdingRequest: boolean; onSubmit: (answers: BuilderAnswers, fromUpload: boolean) => void }) {
  const [role, setRole] = useState(answers.role);
  const [level, setLevel] = useState(answers.level);
  const [style, setStyle] = useState(answers.style);
  const [pages, setPages] = useState(String(answers.pages));

  const read = (fromUpload: boolean) => onSubmit({ role: normalizeText(role).slice(0, 80), level, style, pages: Number(pages) }, fromUpload);

  return (
    <section className="card rb-start" aria-labelledby="start-title">
      <div>
        <h2 id="start-title">Let&apos;s start with a few questions</h2>
        <p className="muted">Lay AI suggests templates from your answers.</p>
        {holdingRequest ? <p className="rb-handoff">Lay AI is holding a request you agreed to for your resume. It will carry it out as soon as your first resume is ready.</p> : null}
      </div>
      <form
        className="rb-start-form"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          read(false);
        }}
      >
        <div className="field">
          <label htmlFor="target-role">Target role</label>
          <input className="input" id="target-role" name="role" maxLength={80} placeholder="e.g. Backend Developer" autoComplete="off" value={role} onChange={(event) => setRole(event.target.value)} />
        </div>
        <Choices legend="Experience" name="level" options={LEVELS} value={level} onChange={setLevel} />
        <Choices legend="Style" name="style" options={STYLES} value={style} onChange={setStyle} />
        <Choices legend="Length" name="pages" options={LENGTHS} value={pages} onChange={setPages} />
        <div className="rb-start-actions">
          <button className="rb-link" type="button" onClick={() => read(true)}>
            <Icon name="upload" />Start from my uploaded resume
          </button>
          <button className="btn btn-primary" type="submit">
            <Icon name="sparkle" />Suggest templates
          </button>
        </div>
      </form>
    </section>
  );
}

type Template = { id: string; name: string; blurb: string; columns?: number; pdfOnly?: boolean };

export function TemplatesStep({ answers, templateId, onBack, onChoose }: { answers: BuilderAnswers; templateId: string | null; onBack: () => void; onChoose: (id: string) => void }) {
  const [filter, setFilter] = useState<'all' | '1' | '2'>('all');
  const shown = (suggestTemplates(answers, Infinity) as Template[]).filter((template) => filter === 'all' || String(template.columns ?? 1) === filter);
  return (
    <section className="rb-step" aria-labelledby="templates-title">
      <div className="rb-step-head">
        <div>
          <h2 id="templates-title">Pick a template</h2>
          <p className="muted">{answersSummary(answers)}</p>
        </div>
        <button className="btn btn-ghost" type="button" onClick={onBack}>Change answers</button>
      </div>
      <div className="rb-filter" role="group" aria-label="Show templates with">
        {([['all', 'All layouts'], ['1', 'One column'], ['2', 'Two columns']] as const).map(([value, label]) => (
          <button key={value} className="btn btn-secondary btn-sm" type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>
        ))}
      </div>
      <ul className="rb-templates">
        {shown.map((template, index) => (
          <li className={`card rb-tpl-card${index === 0 ? ' is-best' : ''}`} key={template.id}>
            <div className={`rb-mini rb-mini-${template.id}`} aria-hidden="true">{Array.from({ length: 8 }, (_, i) => <span key={i} />)}</div>
            <div className="rb-tpl-title">
              <h3>{template.name}</h3>
              {index === 0 ? <span className="badge badge-green">Best match</span> : null}
              <span className="badge">{(template.columns ?? 1) === 2 ? 'Two columns' : 'One column'}</span>
              {template.pdfOnly ? <span className="badge">PDF only</span> : null}
              {templateId === template.id ? <span className="badge badge-blue">In use</span> : null}
            </div>
            <p className="muted">{template.blurb}</p>
            <button className={`btn ${index === 0 ? 'btn-primary' : 'btn-secondary'}`} type="button" onClick={() => onChoose(template.id)}>Use this</button>
          </li>
        ))}
      </ul>
    </section>
  );
}
