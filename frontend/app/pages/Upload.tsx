import { useEffect, useState, type DragEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import useSWR from 'swr';
import { getParsedProfile, uploadResume } from '@/api/resume';
import type { ParsedProfile, ResumeDto } from '@/api/types';
import { Chips } from '@/components/Chips';
import { Icon } from '@/components/Icon';
import { PageHeader } from '@/components/PageHeader';
import { errorMessage } from '@/lib/errors';
import { useVersions } from '@/lib/data';
import { usePageTitle } from '@/lib/hooks';
import { ROUTES } from '@/lib/routes';
import { validateResumeFile } from '@legacy/core/validation.js';
import { LINKEDIN_STEPS, validateLinkedinFile } from '@legacy/pages/avatar-rules.js';

// The resume analyzer: upload a PDF/DOCX as a new resume version, preview it, and show what was read from it. The left
// column is the resume as we read it (or the original PDF, for a file chosen in this browser) above the file card; the
// right column is the parsing result for the version picked in the version menu. `?resume=<id>` opens a given version.

type Entry = [string | null | undefined, string | null | undefined, string | null | undefined];

const formatDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const formatDateTime = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const formatSize = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`);

function Timeline({ entries }: { entries: Entry[] }) {
  return (
    <ul className="timeline">
      {entries.map(([what, where, when], index) => (
        <li key={index}>
          <p className="tl-what">
            <span>{what || where || ''}</span>
            <span className="muted">{what && where ? `, ${where}` : ''}</span>
          </p>
          <p className="tl-when mono">{when}</p>
        </li>
      ))}
    </ul>
  );
}

function Parsed({ profile, resume, count }: { profile: ParsedProfile; resume: ResumeDto; count: number }) {
  const skills = profile.skills ?? [];
  const experience: Entry[] = (profile.experience ?? []).map((e) => [e.title, e.organization, e.duration]);
  const education: Entry[] = (profile.education ?? []).map((e) => [e.degree, e.institution, e.year]);
  return (
    <div>
      <p className="section-label" style={{ marginBottom: 8 }}>Profile</p>
      <dl className="kv">
        <div><dt># Name</dt><dd>{profile.name || 'Not found'}</dd></div>
        <div><dt># Email</dt><dd>{profile.email || 'Not found'}</dd></div>
        <div><dt># Phone</dt><dd>{profile.phone || 'Not found'}</dd></div>
        <div><dt># Version</dt><dd>{resume.version} of {count}</dd></div>
        <div><dt># Uploaded</dt><dd>{formatDateTime(resume.uploadedAt)}</dd></div>
      </dl>

      <div className="block-head"><h3>Skills</h3><span className="badge badge-blue">{skills.length}</span></div>
      <Chips items={skills} />
      {skills.length === 0 ? <p className="muted">No skills found. Add a &quot;Skills&quot; section that lists your tools and technologies.</p> : null}

      <div className="block-head"><h3>Experience</h3></div>
      <Timeline entries={experience} />
      {experience.length === 0 ? <p className="muted">No jobs or internships found. If you have some, list them under an &quot;Experience&quot; or &quot;Internships&quot; heading. Projects aren&apos;t shown here yet.</p> : null}

      <div className="block-head"><h3>Education</h3></div>
      <Timeline entries={education} />
      {education.length === 0 ? <p className="muted">No education found. Put it under an &quot;Education&quot; heading.</p> : null}
    </div>
  );
}

/** The same data as the parsing result, laid out as a page. */
function Paper({ profile }: { profile: ParsedProfile | undefined }) {
  if (!profile) {
    return <p className="paper-empty">Your resume appears here once it is uploaded.</p>;
  }
  const skills = profile.skills ?? [];
  const experience: Entry[] = (profile.experience ?? []).map((e) => [e.title, e.organization, e.duration]);
  const education: Entry[] = (profile.education ?? []).map((e) => [e.degree, e.institution, e.year]);
  const contact = [profile.email, profile.phone].filter(Boolean).join(' · ');
  const list = (entries: Entry[]) => (
    <ul>
      {entries.map(([what, where, when], index) => (
        <li key={index}><span>{[what, where].filter(Boolean).join(', ')}</span><span>{when ?? ''}</span></li>
      ))}
    </ul>
  );
  return (
    <div>
      <p className="paper-tag">Resume</p>
      <h2>{profile.name || 'Your name'}</h2>
      <p className="paper-contact">{contact}</p>
      {skills.length > 0 ? <div><h3>Skills</h3><p>{skills.join(' · ')}</p></div> : null}
      {experience.length > 0 ? <div><h3>Experience</h3>{list(experience)}</div> : null}
      {education.length > 0 ? <div><h3>Education</h3>{list(education)}</div> : null}
    </div>
  );
}

export default function Upload() {
  usePageTitle('My resume');
  const { data: versions = [], mutate: refreshVersions } = useVersions();
  const [params, setParams] = useSearchParams();
  const requested = params.get('resume');
  const shown = versions.find((resume) => resume.id === requested) ?? versions.at(-1) ?? null;
  const { data: profile, error: profileError, isLoading: profileLoading } = useSWR(shown ? ['profile', shown.id] : null, () => getParsedProfile(shown!.id), { revalidateOnFocus: false });

  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [linkedinError, setLinkedinError] = useState('');
  const [mode, setMode] = useState<'parsed' | 'original'>('parsed');
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);

  // A PDF chosen in this browser can be previewed as it is; the object URL is released when it is replaced or the page closes.
  const isPdf = file !== null && !fileError && file.type === 'application/pdf';
  useEffect(() => {
    if (!file || !isPdf) {
      setOriginalUrl(null);
      return undefined;
    }
    const url = URL.createObjectURL(file);
    setOriginalUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file, isPdf]);

  // Import from LinkedIn: the PDF saved from the profile goes through the same upload as any resume.
  function chooseLinkedin(next: File | null) {
    const problem = validateLinkedinFile(next) as string | null;
    if (problem) {
      setLinkedinError(problem);
      return;
    }
    setLinkedinError('');
    choose(next);
  }

  function choose(next: File | null) {
    setUploadError('');
    setSuccess('');
    const problem = next ? (validateResumeFile(next) as string | null) : null;
    setFile(next);
    setFileError(problem ?? '');
    setMode(next && !problem && next.type === 'application/pdf' ? 'original' : 'parsed');
  }

  function drop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    if (event.dataTransfer.files.length > 0) {
      choose(event.dataTransfer.files[0]);
    }
  }

  async function upload() {
    const problem = file ? (validateResumeFile(file) as string | null) : 'Choose a file first.';
    if (problem || !file) {
      setUploadError(problem ?? '');
      return;
    }
    setUploadError('');
    setSuccess('');
    setBusy(true);
    try {
      const resume = await uploadResume(file);
      await refreshVersions((current) => [...(current ?? []), resume], { revalidate: false });
      setParams({ resume: resume.id }, { replace: true });
      setSuccess(`Version ${resume.version} is analysed. Open the dashboard to see your score and role matches.`);
      setFile(null);
      setMode('parsed');
    } catch (error) {
      // The backend's message is specific where it matters (an unsupported file format, the AI engine being unavailable).
      setUploadError(errorMessage(error, 'Could not upload the resume. Please try again.'));
    } finally {
      setBusy(false);
    }
  }

  const original = mode === 'original' && originalUrl !== null;
  const error = uploadError || fileError;
  const newestFirst = [...versions].reverse();

  return (
    <>
      <PageHeader
        crumb="Resume analyzer"
        title="My resume"
        actions={versions.length > 0 ? <Link className="btn btn-primary" to={ROUTES.dashboard}>View analysis <Icon name="arrow" /></Link> : null}
      />
      <div className="content">
        {error ? <div className="alert alert-error" role="alert">{error}</div> : null}
        {success ? <div className="alert alert-success" role="status">{success}</div> : null}

        <div className="analyzer">
          <section className="col-preview" aria-label="Resume preview and upload">
            <div className="card preview-card">
              <div className="preview-toolbar">
                <div className="seg" role="tablist" aria-label="Preview">
                  <button type="button" role="tab" aria-selected={!original} onClick={() => setMode('parsed')}>Parsed view</button>
                  <button type="button" role="tab" aria-selected={original} disabled={!isPdf} title="Available for a PDF chosen in this browser" onClick={() => setMode('original')}>Original file</button>
                </div>
                <span className="mono muted">{shown ? `v${shown.version}` : ''}</span>
              </div>
              {original ? null : (
                <article className="paper" aria-label="Resume as we read it">
                  <Paper profile={profile} />
                </article>
              )}
              {original ? <iframe className="original-frame" title="Original resume file" src={originalUrl ?? undefined} /> : null}
            </div>

            <div className={`card file-card${dragging ? ' dragging' : ''}`} onDragEnter={(event) => { event.preventDefault(); setDragging(true); }} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={drop}>
              <div className="file-icon"><Icon name="file" /></div>
              <div>
                <p className="file-name">{file ? file.name : 'Upload a resume'}</p>
                <p className="file-detail mono muted">{file ? `${formatSize(file.size)} · ready to upload` : 'PDF or DOCX · up to 5 MB'}</p>
              </div>
              <div className="file-actions">
                <label className="btn btn-secondary" htmlFor="resume-file"><Icon name="plus" />Choose file</label>
                <button className="btn btn-primary" type="button" disabled={!file || Boolean(fileError) || busy} onClick={() => void upload()}>{busy ? 'Analysing…' : 'Upload & analyse'}</button>
              </div>
              <input
                id="resume-file"
                className="sr-only"
                type="file"
                accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                onChange={(event) => choose(event.target.files?.[0] ?? null)}
              />
              <p className="drop-hint">Or drop a file on this card. Each upload is kept as a new version.</p>
              {busy ? <div className="progress-line" /> : null}
            </div>

            <article className="card linkedin-card" id="linkedin" aria-labelledby="linkedin-title">
              <div className="card-head"><h2 id="linkedin-title">Import from LinkedIn</h2><span className="badge badge-blue">PDF</span></div>
              <ol className="linkedin-steps">
                {(LINKEDIN_STEPS as string[]).map((step, index) => (
                  <li key={step}><span className="linkedin-num">{index + 1}</span><span>{step}</span></li>
                ))}
              </ol>
              <label className="btn btn-secondary" htmlFor="linkedin-file"><Icon name="file" />Choose LinkedIn PDF</label>
              <input id="linkedin-file" className="sr-only" type="file" accept=".pdf,application/pdf" onChange={(event) => { chooseLinkedin(event.target.files?.[0] ?? null); event.target.value = ''; }} />
              {linkedinError ? <p className="field-error" role="alert">{linkedinError}</p> : null}
              {file && !fileError && !linkedinError && file.type === 'application/pdf' ? <p className="field-hint" role="status">{file.name} is ready. Press Upload &amp; analyse above.</p> : null}
              <p className="field-hint">LinkedIn only lets approved partners read profiles, so there is no sign-in. Your photo is not in the PDF; set it in Settings.</p>
            </article>
          </section>

          <section className="card" aria-labelledby="result-title">
            <div className="card-head">
              <h2 id="result-title">Parsing result</h2>
              <div className="card-head-actions">
                <label className="sr-only" htmlFor="version-select">Resume version</label>
                {versions.length > 0 ? (
                  <select id="version-select" className="select" value={shown?.id ?? ''} onChange={(event) => setParams({ resume: event.target.value }, { replace: true })}>
                    {newestFirst.map((resume, index) => (
                      <option key={resume.id} value={resume.id}>{`Version ${resume.version}${index === 0 ? ' (latest)' : ''} · ${formatDate(resume.uploadedAt)}`}</option>
                    ))}
                  </select>
                ) : null}
              </div>
            </div>

            {!shown ? (
              <div className="empty">
                <Icon name="upload" />
                <h3>No resume yet</h3>
                <p>Choose a PDF or DOCX on the left. We read it in a few seconds and keep every version.</p>
              </div>
            ) : null}
            {profileLoading ? <p className="muted">Loading…</p> : null}
            {profileError ? <div className="alert alert-error" role="alert">{errorMessage(profileError, 'Could not load this version. Please try again.')}</div> : null}
            {profile && shown ? <Parsed profile={profile} resume={shown} count={versions.length} /> : null}
          </section>
        </div>
      </div>
    </>
  );
}
