import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { Icon } from '@/components/Icon';
import { PageHeader, PreviewBadge } from '@/components/PageHeader';
import { builderResume } from '@/lib/builderStore';
import { usePageTitle } from '@/lib/hooks';
import { ROUTES } from '@/lib/routes';
import { useUser } from '@/lib/session';
import { readJson, useStoredValue, writeJson } from '@/lib/storage';
import { PLACEHOLDER_LABELS, knownValues } from '@legacy/pages/privacy-guard-rules.js';
import { addPoints, isWallet, sampleWallet, walletKey } from '@legacy/pages/wallet-rules.js';
import {
  ANONYMOUS,
  TOPICS,
  addPost,
  addReply,
  checkPost,
  filterFeed,
  isMine,
  markViewed,
  migrateSaved,
  newDeviceTally,
  postAge,
  redeemPoints,
  replyTree,
  sampleFeed,
  validatePost,
  vote,
  voteOf,
} from '@legacy/pages/community-rules.js';
import { CommentBranch, ReplyForm, Votes, type Comment, type CommentNode } from '@/components/CommunityThread';

// The community preview: a feed where every post is plain "Anonymous" (no handle, nothing that ties two posts together),
// posting with the identity check first, this device's private tally of its own posts and points, and moving points to
// the wallet, up and down votes on posts and comments, anonymous comments in branches (as on Reddit), and which posts
// this device has seen. Everything lives in this browser only; "My activity" reads the same tally.

type Saved = NonNullable<ReturnType<typeof migrateSaved>>;
type Post = { id: string; topic: string; company?: string; createdHour: number; text: string; upvotes: number; downvotes?: number; replies?: Comment[] };

const otherLabel = (key: string) => (key.startsWith('other.email') ? 'an email address' : key.startsWith('other.phone') ? 'a phone number' : 'a link');

export default function Community() {
  usePageTitle('Community');
  const user = useUser();
  const userId = user?.id ?? 'guest';
  const values = useMemo(() => knownValues(builderResume(user?.id)), [user?.id]);
  // An older preview (posts with a mask handle) is converted: handles and author ids are dropped.
  const [state, setState] = useStoredValue<Saved>(`coverlay.preview.community.${userId}`, (stored) => migrateSaved(stored) ?? { feed: sampleFeed(Date.now()), device: newDeviceTally() });
  const [topic, setTopic] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [postTopic, setPostTopic] = useState<string>(TOPICS[0].id);
  const [company, setCompany] = useState('');
  const [error, setError] = useState('');
  // What the identity check found, and the text it last approved (so a second press posts it).
  const [check, setCheck] = useState<{ labels: string[]; safeText: string } | null>(null);
  const [checked, setChecked] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  // The one reply box that is open, as "postId|commentId" ("postId|" for a comment on the post), and the collapsed
  // branches (for this visit only).
  const [replyFor, setReplyFor] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const feedRef = useRef<HTMLUListElement>(null);
  const [redeemNote, setRedeemNote] = useState("Points arrive as credits in a small batch at a random time within a day, so the amount and the timing don't point back to your posts.");

  const { device } = state;
  const now = Date.now();
  const posts: Post[] = filterFeed(state.feed, topic);

  // A post counts as viewed once most of it has been on screen; the ids are kept on this device only (RB-COM-10).
  useEffect(() => {
    const list = feedRef.current;
    if (!list || typeof IntersectionObserver === 'undefined') {
      return undefined;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const ids = entries.filter((entry) => entry.isIntersecting).map((entry) => (entry.target as HTMLElement).dataset.postId ?? '').filter(Boolean);
        if (ids.length) {
          setState((current: Saved) => {
            const device = markViewed(current.device, ids);
            return device === current.device ? current : { ...current, device };
          });
        }
      },
      { threshold: 0.6 },
    );
    list.querySelectorAll<HTMLElement>('[data-post-id]').forEach((item) => observer.observe(item));
    return () => observer.disconnect();
  }, [posts.length, topic, setState]);

  const labelsFor = (found: string[]) => [...new Set<string>(found.map((key: string) => PLACEHOLDER_LABELS[key as keyof typeof PLACEHOLDER_LABELS] ?? otherLabel(key)))];

  function castVote(postId: string, replyId: string | null, direction: 1 | -1) {
    const before = voteOf(state.device, replyId ?? postId);
    setState((current: Saved) => ({ ...current, ...vote(current.feed, current.device, { postId, replyId }, direction) }));
    setStatus(before === direction ? 'Vote taken back.' : direction === 1 ? 'Upvoted (agree). Only this device knows.' : 'Downvoted (disagree). Only this device knows.');
  }

  function sendReply(postId: string, parentId: string | null, body: string) {
    setState((current: Saved) => {
      const next = addReply(current.feed, current.device, postId, body, Date.now(), parentId);
      return { ...current, feed: next.feed, device: next.device };
    });
    setReplyFor(null);
    setStatus('Replied anonymously.');
  }

  function toggleBranch(id: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function post(body: string, approved: string | null) {
    const problem = validatePost(body, postTopic);
    setError(problem ?? '');
    if (problem) {
      return;
    }
    if (approved !== body) {
      const found = checkPost(body, values);
      if (found.found.length) {
        setCheck({ labels: labelsFor(found.found), safeText: found.safeText });
        return;
      }
    }
    const next = addPost(state.feed, state.device, { text: body, topic: postTopic, company }, Date.now());
    setState({ ...state, ...next });
    setText('');
    setCompany('');
    setCheck(null);
    setChecked(null);
    setStatus('Posted anonymously. +5 points.');
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    post(text.trim(), checked);
  }

  function redeem() {
    const { device: nextDevice, credits } = redeemPoints(state.device);
    if (!credits) {
      setStatus('No points to move yet.');
      return;
    }
    setState({ ...state, device: nextDevice });
    const key = walletKey(userId);
    const saved = readJson(key);
    writeJson(key, addPoints(isWallet(saved) ? saved : sampleWallet(Date.now()), credits, Date.now()));
    setRedeemNote(`${credits} points are on their way. In the preview they're in your Wallet already; the real batch arrives within a day.`);
  }

  return (
    <>
      <PageHeader crumb="Jobs" title="Community" actions={<PreviewBadge />} />
      <div className="content">
        <p className="alert alert-info" role="note">
          Preview with sample data: posts stay in this browser. The real community stamps every post with its own one-time pass made on your device, so no one can link a post to your account, or to any of your other posts.
        </p>
        <p className="sr-only" role="status">{status}</p>
        <section className="community">
          <div className="community-main">
            <article className="card" aria-labelledby="compose-title">
              <div className="card-head"><h2 id="compose-title">Post anonymously</h2><span className="badge badge-violet">Anonymous</span></div>
              <form className="community-form" noValidate onSubmit={submit}>
                <div className="field">
                  <label htmlFor="post-text">What would help others?</label>
                  <textarea
                    className="input"
                    id="post-text"
                    rows={4}
                    maxLength={1000}
                    placeholder="An interview question, an offer, how a referral worked…"
                    value={text}
                    onChange={(event) => {
                      setText(event.target.value);
                      setChecked(null);
                      setCheck(null);
                    }}
                  />
                </div>
                <div className="community-form-row">
                  <div className="field">
                    <label htmlFor="post-topic">Topic</label>
                    <select className="select" id="post-topic" value={postTopic} onChange={(event) => setPostTopic(event.target.value)}>
                      {TOPICS.map((t: { id: string; label: string }) => <option key={t.id} value={t.id}>{t.label}</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="post-company">Company (optional)</label>
                    <input className="input" id="post-company" maxLength={60} autoComplete="off" value={company} onChange={(event) => setCompany(event.target.value)} />
                  </div>
                </div>
                {check ? (
                  <div className="community-check" role="alert">
                    <p><Icon name="shield" /> <strong>This could identify you:</strong> <span>{check.labels.join(', ')}</span>.</p>
                    <p className="field-hint">Post it like this instead?</p>
                    <blockquote className="community-safe">{check.safeText}</blockquote>
                    <div className="row">
                      <button
                        className="btn btn-primary btn-sm"
                        type="button"
                        onClick={() => {
                          setText(check.safeText);
                          setChecked(check.safeText.trim());
                          setCheck(null);
                          post(check.safeText.trim(), check.safeText.trim());
                        }}
                      >
                        Use this version
                      </button>
                      <button className="btn btn-ghost btn-sm" type="button" onClick={() => { setCheck(null); document.getElementById('post-text')?.focus(); }}>Edit it myself</button>
                    </div>
                  </div>
                ) : null}
                <p className="field-error" role="alert">{error}</p>
                <div className="row community-actions">
                  <button className="btn btn-primary" type="submit">Post anonymously</button>
                  <span className="field-hint">+5 points for each post</span>
                </div>
              </form>
            </article>

            <div className="chips community-filters" role="group" aria-label="Filter by topic">
              <button className="community-chip" type="button" aria-pressed={topic === null} onClick={() => setTopic(null)}>All</button>
              {TOPICS.map((t: { id: string; label: string }) => (
                <button key={t.id} className="community-chip" type="button" aria-pressed={topic === t.id} onClick={() => setTopic(t.id)}>{t.label}</button>
              ))}
            </div>
            <ul className="community-feed" ref={feedRef}>
              {posts.length === 0 ? <li className="empty">No posts on this topic yet.</li> : null}
              {posts.map((item) => (
                <li className="card community-post" key={item.id} data-post-id={item.id}>
                  <div className="community-post-head">
                    <span className="avatar community-avatar" aria-hidden="true"><Icon name="lock" /></span>
                    <div>
                      {/* Every post has the same author line. "You" is worked out on this device only, from its own list. */}
                      <p className="community-post-handle">
                        {ANONYMOUS}
                        {isMine(state.device, item) ? <span className="badge badge-violet" title="Only you can see this label">You</span> : null}
                      </p>
                      <p className="field-hint">
                        {[TOPICS.find((t: { id: string }) => t.id === item.topic)?.label, item.company, postAge(item.createdHour, now)].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                  </div>
                  <p className="community-post-text">{item.text}</p>
                  <div className="row community-post-actions">
                    <Votes id={item.id} item={item} device={state.device} label="post" onVote={(direction) => castVote(item.id, null, direction)} />
                    <button
                      className="btn btn-ghost btn-sm"
                      type="button"
                      aria-expanded={replyFor === `${item.id}|`}
                      aria-controls={`reply-${item.id}`}
                      onClick={() => setReplyFor(replyFor === `${item.id}|` ? null : `${item.id}|`)}
                    >
                      <Icon name="mail" />
                      {item.replies?.length ? `${item.replies.length} ${item.replies.length === 1 ? 'comment' : 'comments'}` : 'Comment'}
                    </button>
                  </div>
                  {replyFor === `${item.id}|` ? (
                    <ReplyForm id={`reply-${item.id}`} values={values} labels={PLACEHOLDER_LABELS} onSend={(body) => sendReply(item.id, null, body)} onCancel={() => setReplyFor(null)} />
                  ) : null}
                  {item.replies?.length ? (
                    <ul className="community-comments community-comments-root" aria-label="Comments">
                      {replyTree(item.replies).map((node: CommentNode) => (
                        <CommentBranch
                          key={node.id}
                          node={node}
                          postId={item.id}
                          device={state.device}
                          now={now}
                          values={values}
                          labels={PLACEHOLDER_LABELS}
                          replyFor={replyFor}
                          setReplyFor={setReplyFor}
                          collapsed={collapsed}
                          toggle={toggleBranch}
                          onVote={(replyId, direction) => castVote(item.id, replyId, direction)}
                          onReply={(parentId, body) => sendReply(item.id, parentId, body)}
                        />
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>

          <aside className="community-side">
            <article className="card" aria-labelledby="tally-title">
              <p className="section-label" id="tally-title">Your posts, kept on this device</p>
              <p className="field-hint">Only this browser knows which posts are yours. Nothing on a post points back to you.</p>
              <dl className="kv community-kv">
                <div><dt>Posts</dt><dd className="mono">{device.posts}</dd></div>
                <div><dt>Points</dt><dd className="mono">{device.points}</dd></div>
                <div><dt>Comments</dt><dd className="mono">{device.replies.length}</dd></div>
                <div><dt>Votes</dt><dd className="mono">{Object.keys(device.votes).length}</dd></div>
              </dl>
              <button className="btn btn-secondary btn-block" type="button" disabled={device.points <= 0} onClick={redeem}>
                <Icon name="wallet" />
                Move points to wallet
              </button>
              <p className="field-hint">{redeemNote}</p>
              <Link className="btn btn-ghost btn-block" to={ROUTES.activity}>
                <Icon name="chart" />
                See all my activity
              </Link>
            </article>
            <article className="card community-explain" aria-labelledby="explain-title">
              <h2 id="explain-title"><Icon name="lock" /> What nobody can see</h2>
              <ul className="tick-list">
                <li><Icon name="check" /><span>Which account wrote a post: not us, not Google, not anyone with our database or our code.</span></li>
                <li><Icon name="check" /><span>Which posts came from the same person: nobody can tell. Every post is just &quot;Anonymous&quot;, and each has its own one-time pass that Coverlay signed without seeing.</span></li>
                <li><Icon name="check" /><span>Posts keep only the hour they were made, never the exact time.</span></li>
              </ul>
              <p className="field-hint">What you write can still give you away: the check above looks for your name, college and contacts before you post.</p>
            </article>
          </aside>
        </section>
      </div>
    </>
  );
}
