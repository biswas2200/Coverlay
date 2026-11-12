import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DAY_MS, JOBS_OPENED_MAX, activityKey, activitySummary, excerpt, isJobActivity, newJobActivity, recordJobOpen } from '../src/js/pages/activity-rules.js';
import { addApplication, moveTo, sampleApplications } from '../src/js/pages/applications-rules.js';
import { addPost, addReply, markViewed, newDeviceTally, sampleFeed, vote } from '../src/js/pages/community-rules.js';

const NOW = Date.UTC(2026, 10, 11, 9, 0, 0);

test('opened job postings: newest first, each once, capped, only the plain fields', () => {
  let activity = newJobActivity();
  assert.equal(isJobActivity(activity), true);
  assert.equal(isJobActivity({}), false);
  activity = recordJobOpen(activity, { id: 'j1', title: 'Backend Engineer', company: 'Razorpay', applyUrl: 'https://x', excerpt: 'long' }, NOW - DAY_MS);
  activity = recordJobOpen(activity, { id: 'j2', title: 'SRE', company: 'Zerodha' }, NOW - DAY_MS / 2);
  activity = recordJobOpen(activity, { id: 'j1', title: 'Backend Engineer', company: 'Razorpay' }, NOW);
  assert.deepEqual(activity.opened.map((item) => item.jobId), ['j1', 'j2']);
  assert.deepEqual(Object.keys(activity.opened[0]).sort(), ['at', 'company', 'jobId', 'title']);
  assert.equal(activity.opened[0].at, NOW);
  assert.equal(recordJobOpen(activity, null, NOW), activity);
  let many = newJobActivity();
  for (let i = 0; i < JOBS_OPENED_MAX + 5; i += 1) {
    many = recordJobOpen(many, { id: `j${i}` }, NOW + i);
  }
  assert.equal(many.opened.length, JOBS_OPENED_MAX);
  assert.equal(activityKey('u1'), 'coverlay.preview.activity.u1');
});

test('applications: total, sent, per column, sent in the last 30 days', () => {
  let apps = addApplication([], { company: 'Razorpay', role: 'Backend', portal: 'LinkedIn' }, NOW - 40 * DAY_MS);
  apps = addApplication(apps, { company: 'Zerodha', role: 'SRE', portal: 'Referral' }, NOW - 5 * DAY_MS);
  apps = addApplication(apps, { company: 'Swiggy', role: 'Platform', portal: 'Naukri' }, NOW);
  const [swiggy, zerodha, razorpay] = apps;
  apps = moveTo(apps, razorpay.id, 'APPLIED', NOW - 40 * DAY_MS);
  apps = moveTo(apps, razorpay.id, 'REJECTED', NOW - 20 * DAY_MS);
  apps = moveTo(apps, zerodha.id, 'APPLIED', NOW - 4 * DAY_MS);
  apps = moveTo(apps, zerodha.id, 'INTERVIEW', NOW - DAY_MS);
  const { applications } = activitySummary({ apps }, NOW);
  assert.equal(applications.total, 3);
  assert.equal(applications.sent, 2, 'a rejection after applying still counts as sent; Preparing does not');
  assert.equal(applications.sentLast30, 1);
  assert.deepEqual(applications.byStatus.map((s) => s.count), [1, 0, 1, 0, 1]);
  assert.equal(swiggy.status, 'PREPARING');
  assert.ok(activitySummary({ apps: sampleApplications(NOW) }, NOW).applications.total > 0);
});

test('community: counts from the device tally, with liked posts and own replies listed', () => {
  let feed = sampleFeed(NOW);
  let device = newDeviceTally();
  ({ feed, device } = addPost(feed, device, { text: 'My own post, long enough to post.', topic: 'advice', company: '' }, NOW));
  device = markViewed(device, feed.map((post) => post.id));
  ({ feed, device } = vote(feed, device, { postId: feed[2].id }, 1));
  ({ feed, device } = vote(feed, device, { postId: feed[1].id, replyId: feed[1].replies[0].id }, 1));
  ({ feed, device } = vote(feed, device, { postId: feed[4].id }, -1));
  ({ feed, device } = addReply(feed, device, feed[3].id, 'Thanks, this helped me prepare.', NOW));
  ({ feed, device } = addReply(feed, device, feed[1].id, 'Replying inside the branch.', NOW, feed[1].replies[0].id));
  const { community } = activitySummary({ community: { feed, device } }, NOW);
  assert.equal(community.posts, 1);
  assert.equal(community.points, 5);
  assert.equal(community.viewed, feed.length - 1);
  assert.equal(community.upvotes, 2);
  assert.equal(community.downvotes, 1);
  assert.deepEqual(community.upvoted.map((item) => item.kind).sort(), ['comment', 'post']);
  assert.equal(community.upvoted.find((item) => item.kind === 'post').postId, feed[2].id);
  assert.equal(community.replies, 2);
  const [inBranch, onPost] = community.myReplies;
  assert.equal(inBranch.onComment, feed[1].replies[0].text);
  assert.equal(onPost.text, 'Thanks, this helped me prepare.');
  assert.equal(onPost.postId, feed[3].id);
  assert.equal(onPost.onComment, null);
  const gone = activitySummary({ community: { feed: [], device } }, NOW).community;
  assert.equal(gone.replies, 2, 'still counted when the post is gone');
  assert.deepEqual(gone.myReplies, []);
});

test('nothing yet: zeros, an unknown saved count, and an old tally is read safely', () => {
  const empty = activitySummary({}, NOW);
  assert.equal(empty.applications.total, 0);
  assert.equal(empty.jobs.opened, 0);
  assert.equal(empty.jobs.saved, null);
  assert.equal(empty.community.viewed, 0);
  const old = activitySummary({ community: { feed: [], device: { posts: 2, points: 10, mine: ['a'] } }, saved: [{ status: 'SAVED' }, { status: 'APPLIED' }, { status: 'REJECTED' }] }, NOW);
  assert.equal(old.community.posts, 2);
  assert.equal(old.community.upvotes, 0);
  assert.equal(old.jobs.saved, 3);
  assert.equal(old.jobs.savedApplied, 2, 'Not selected comes after applying');
  assert.equal(empty.jobs.savedApplied, null);
});

test('excerpt keeps it short and on one line', () => {
  assert.equal(excerpt('a\n b   c'), 'a b c');
  assert.equal(excerpt('x'.repeat(100), 10), `${'x'.repeat(9)}…`);
});

test('skills and education: the uploaded resume first, the Builder resume when there is none', async () => {
  const { profileSummary } = await import('../src/js/pages/activity-rules.js');
  const parsed = {
    skills: ['Java', ' spring  boot ', 'java', '', 'SQL'],
    education: [{ degree: 'B.Tech', institution: 'VIT', year: '2021' }, { degree: null, institution: '', year: null }],
  };
  const fromResume = profileSummary({ parsed, version: 3, builder: { skills: ['Go'], education: [] } });
  assert.equal(fromResume.source, 'resume');
  assert.equal(fromResume.version, 3);
  assert.deepEqual(fromResume.skills, ['Java', 'spring boot', 'SQL'], 'duplicates ignoring case are dropped, first spelling kept');
  assert.equal(fromResume.total, 3);
  assert.deepEqual(fromResume.education, [{ degree: 'B.Tech', institution: 'VIT', year: '2021' }], 'empty entries are dropped');

  const builder = { skills: ['Java', 'Spring Boot'], education: [{ degree: '<b>B.Tech Computer Science</b>, VIT', dates: '2021' }] };
  const fromBuilder = profileSummary({ parsed: { skills: [], education: [] }, builder });
  assert.equal(fromBuilder.source, 'builder');
  assert.deepEqual(fromBuilder.education, [{ degree: 'B.Tech Computer Science, VIT', institution: '', year: '2021' }]);
  assert.equal(fromBuilder.total, 2);

  assert.deepEqual(profileSummary({}), { source: null, version: null, skills: [], education: [], total: 0 });
});

test('skill gaps: what matched roles ask for most, without what the person has', async () => {
  const { GAPS_MAX, skillGaps } = await import('../src/js/pages/activity-rules.js');
  const recs = [
    { missingSkills: ['Kubernetes', 'Kafka', 'java'] },
    { missingSkills: ['Kafka', 'AWS'] },
    { missingSkills: ['kafka', 'Kubernetes'] },
  ];
  assert.deepEqual(skillGaps(recs, ['Java']), [
    { skill: 'Kafka', roles: 3 },
    { skill: 'Kubernetes', roles: 2 },
    { skill: 'AWS', roles: 1 },
  ]);
  assert.deepEqual(skillGaps(null, []), []);
  const many = [{ missingSkills: Array.from({ length: 20 }, (_, i) => `S${i}`) }];
  assert.equal(skillGaps(many, []).length, GAPS_MAX);
});
