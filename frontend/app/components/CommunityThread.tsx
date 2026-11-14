import { useState, type FormEvent } from 'react';
import { Icon } from '@/components/Icon';
import { ANONYMOUS, MAX_DEPTH, MAX_REPLY, branchSize, checkPost, isMyReply, postAge, validateReply, voteCounts, voteOf } from '@legacy/pages/community-rules.js';

// The community's Reddit-style parts: the up/down vote pill (posts and comments), the anonymous reply box with the
// identity check, and the branches of comments, each of which can be collapsed. Votes and "You" come from this device's
// own tally (RB-COM-09, RB-COM-10); nothing here says who wrote or voted on anything.

export type Comment = { id: string; parentId: string | null; text: string; createdHour: number; upvotes: number; downvotes: number };
export type CommentNode = Comment & { depth: number; children: CommentNode[] };
type Device = { votes: Record<string, number>; replies: { id: string; postId: string }[] };

export function Votes({ id, item, device, label, onVote }: { id: string; item: { upvotes?: number; downvotes?: number }; device: Device; label: string; onVote: (direction: 1 | -1) => void }) {
  const mine = voteOf(device, id);
  // Two separate counts (given minus taken back, RB-COM-09). One vote per device, never locked: the same arrow takes it
  // back, the other arrow switches it.
  const { up, down } = voteCounts(item);
  return (
    <div className={`community-votes${mine ? ' is-voted' : ''}`} role="group" aria-label={`Vote on this ${label}`}>
      <button
        className="community-vote is-up"
        type="button"
        aria-pressed={mine === 1}
        aria-label={`Upvote, agree: ${up}`}
        title={mine === 1 ? 'You agreed. Press again to take it back.' : 'Upvote (agree). Only this device knows.'}
        onClick={() => onVote(1)}
      >
        <Icon name="vote-up" />
        <span className="mono">{up}</span>
      </button>
      <button
        className="community-vote is-down"
        type="button"
        aria-pressed={mine === -1}
        aria-label={`Downvote, disagree: ${down}`}
        title={mine === -1 ? 'You disagreed. Press again to take it back.' : 'Downvote (disagree). Only this device knows.'}
        onClick={() => onVote(-1)}
      >
        <Icon name="vote-down" />
        <span className="mono">{down}</span>
      </button>
    </div>
  );
}

const otherLabel = (key: string) => (key.startsWith('other.email') ? 'an email address' : key.startsWith('other.phone') ? 'a phone number' : 'a link');

/** One reply box. It checks the length and, before sending, what in the text could identify the writer (RB-COM-06). */
export function ReplyForm({ id, values, labels, onSend, onCancel }: { id: string; values: unknown; labels: Record<string, string>; onSend: (body: string) => void; onCancel: () => void }) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [found, setFound] = useState<{ labels: string[]; safeText: string } | null>(null);

  function send(body: string, approved: boolean) {
    const problem = validateReply(body);
    setError(problem ?? '');
    if (problem) {
      return;
    }
    if (!approved) {
      const result = checkPost(body, values);
      if (result.found.length) {
        setFound({ labels: [...new Set<string>(result.found.map((key: string) => labels[key] ?? otherLabel(key)))], safeText: result.safeText });
        return;
      }
    }
    onSend(body);
  }

  return (
    <form
      className="community-reply-form"
      id={id}
      noValidate
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        send(text.trim(), false);
      }}
    >
      <label className="sr-only" htmlFor={`${id}-text`}>Your anonymous reply</label>
      <textarea
        className="input"
        id={`${id}-text`}
        rows={2}
        maxLength={MAX_REPLY}
        placeholder="Reply anonymously…"
        value={text}
        autoFocus
        onChange={(event) => {
          setText(event.target.value);
          setFound(null);
        }}
      />
      {found ? (
        <div className="community-check" role="alert">
          <p><Icon name="shield" /> <strong>This could identify you:</strong> <span>{found.labels.join(', ')}</span>.</p>
          <blockquote className="community-safe">{found.safeText}</blockquote>
          <div className="row">
            <button className="btn btn-primary btn-sm" type="button" onClick={() => send(found.safeText.trim(), true)}>Use this version</button>
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => setFound(null)}>Edit it myself</button>
          </div>
        </div>
      ) : null}
      <p className="field-error" role="alert">{error}</p>
      <div className="row">
        <button className="btn btn-primary btn-sm" type="submit">Reply anonymously</button>
        <button className="btn btn-ghost btn-sm" type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

type BranchProps = {
  node: CommentNode;
  postId: string;
  device: Device;
  now: number;
  values: unknown;
  labels: Record<string, string>;
  replyFor: string | null;
  setReplyFor: (key: string | null) => void;
  collapsed: Set<string>;
  toggle: (id: string) => void;
  onVote: (replyId: string, direction: 1 | -1) => void;
  onReply: (parentId: string, body: string) => void;
};

/** A comment and, under it, its replies, drawn with a thread line; the line (or [–]) collapses the whole branch. */
export function CommentBranch(props: BranchProps) {
  const { node, postId, device, now, replyFor, setReplyFor, collapsed, toggle, onVote, onReply } = props;
  const isCollapsed = collapsed.has(node.id);
  const key = `${postId}|${node.id}`;
  const canReply = node.depth < MAX_DEPTH - 1;
  const hidden = branchSize(node);
  return (
    <li className={`community-comment${isCollapsed ? ' is-collapsed' : ''}`}>
      <button className="community-thread-line" type="button" aria-label={isCollapsed ? 'Expand this branch' : 'Collapse this branch'} aria-expanded={!isCollapsed} onClick={() => toggle(node.id)} />
      <div className="community-comment-body">
        <p className="community-comment-head">
          <button className="community-collapse mono" type="button" aria-expanded={!isCollapsed} aria-label={isCollapsed ? 'Expand' : 'Collapse'} onClick={() => toggle(node.id)}>
            {isCollapsed ? '[+]' : '[–]'}
          </button>
          <strong>{ANONYMOUS}</strong>
          {isMyReply(device, node) ? <span className="badge badge-violet" title="Only you can see this label">You</span> : null}
          <span className="field-hint">
            {postAge(node.createdHour, now)}
            {isCollapsed ? ` · ${voteCounts(node).up} up · ${voteCounts(node).down} down` : ''}
            {isCollapsed && hidden ? ` · ${hidden} more ${hidden === 1 ? 'reply' : 'replies'}` : ''}
          </span>
        </p>
        {isCollapsed ? null : (
          <>
            <p className="community-comment-text">{node.text}</p>
            <div className="row community-post-actions">
              <Votes id={node.id} item={node} device={device} label="comment" onVote={(direction) => onVote(node.id, direction)} />
              {canReply ? (
                <button className="btn btn-ghost btn-sm" type="button" aria-expanded={replyFor === key} aria-controls={`reply-${node.id}`} onClick={() => setReplyFor(replyFor === key ? null : key)}>
                  <Icon name="mail" />
                  Reply
                </button>
              ) : (
                <span className="field-hint">This branch is as deep as it goes; reply higher up.</span>
              )}
            </div>
            {replyFor === key ? (
              <ReplyForm id={`reply-${node.id}`} values={props.values} labels={props.labels} onSend={(body) => onReply(node.id, body)} onCancel={() => setReplyFor(null)} />
            ) : null}
            {node.children.length ? (
              <ul className="community-comments">
                {node.children.map((child) => <CommentBranch {...props} key={child.id} node={child} />)}
              </ul>
            ) : null}
          </>
        )}
      </div>
    </li>
  );
}
