import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  HANDOFF_TTL_MS,
  HELP_REPLY,
  MAX_CHAT,
  agentStep,
  agentTurn,
  applyResumePlan,
  cleanChat,
  cleanJd,
  declaredSkills,
  draftColdEmail,
  jdHeadline,
  jdSkills,
  knownSkill,
  looksLikeJd,
  makeBuilderHandoff,
  makeLettersHandoff,
  matchAgainst,
  matchReply,
  mentions,
  pageHref,
  parseJd,
  planResumeUpdate,
  planVersionName,
  readBuilderHandoff,
  readLettersHandoff,
  readRequest,
  splitMessage,
} from '../src/js/pages/lay-agent-rules.js';
import { sampleResume } from '../src/js/pages/resume-builder-rules.js';

const NOW = Date.UTC(2026, 10, 8, 10);

const JD = `Platform Engineer at Razorpay
Bengaluru · Full time

About the role
We are looking for a Platform Engineer to run our Kubernetes clusters and make deploys boring. You will work with the payments team.

Requirements
- 2+ years with Docker, Kubernetes and Terraform
- Strong Linux and AWS skills
- Experience with CI/CD pipelines in Jenkins

Nice to have
- Kafka
- Prometheus`;

const ASK = 'I learned Docker and Kubernetes, add them to my resume. Here is the JD:';

// ---------- reading a job description ----------

test('a job description gives its role, company, required skills and nice-to-haves', () => {
  const jd = parseJd(JD);
  assert.equal(jd.role, 'Platform Engineer');
  assert.equal(jd.company, 'Razorpay');
  assert.deepEqual(jd.skills, ['Kubernetes', 'Docker', 'Terraform', 'Linux', 'AWS', 'CI/CD', 'Jenkins'], 'in the order it names them');
  assert.deepEqual(jd.nice, ['Kafka', 'Prometheus'], 'what sits under "nice to have" is not required');
  assert.ok(!('text' in jd), 'the text is not kept');
});

test('skills are found as whole words, so Java is not JavaScript and a verb is not a spreadsheet', () => {
  assert.deepEqual(jdSkills('We use JavaScript and TypeScript.'), ['JavaScript', 'TypeScript']);
  assert.deepEqual(jdSkills('Java, Spring Boot, k8s and Postgres'), ['Java', 'Spring Boot', 'Kubernetes', 'PostgreSQL']);
  assert.deepEqual(jdSkills('You will excel in a fast team. Go and swift decisions.'), [], '"excel", "Go" and "swift" in plain sentences are not skills');
  assert.deepEqual(jdSkills('Strong Excel and Power BI.'), ['Excel', 'Power BI']);
  assert.deepEqual(jdSkills('C++ and C# and .NET, not ASP.NET'), ['C++', 'C#', '.NET']);
  assert.deepEqual(jdSkills('Golang services'), ['Go']);
  assert.equal(knownSkill('K8s'), 'Kubernetes');
  assert.equal(knownSkill('go'), 'Go', 'when the person names it, Go counts');
  assert.equal(knownSkill('cooking'), null);
  assert.ok(mentions('built things with containers on Docker', 'Docker'));
  assert.ok(!mentions('a dockerised setup', 'Docker'));
});

test('the role and company come from a labelled line, the title line, or a plain sentence', () => {
  assert.deepEqual(jdHeadline('Job title: Data Analyst\nCompany: Acme Corp\nSQL and Excel.'), { role: 'Data Analyst', company: 'Acme Corp' });
  assert.deepEqual(jdHeadline('Senior Backend Engineer | Bengaluru\nWe build payments.'), { role: 'Senior Backend Engineer', company: null });
  assert.deepEqual(jdHeadline('About Swiggy\nWe are looking for a Backend Engineer to build APIs.').company, 'Swiggy');
  assert.equal(jdHeadline('About Swiggy\nWe are looking for a Backend Engineer to build APIs.').role, 'Backend Engineer');
  assert.deepEqual(jdHeadline('Join our team. We value kindness.'), { role: null, company: null });
  assert.deepEqual(jdHeadline('About us\nAbout the role'), { role: null, company: null }, '"us" and "the role" are not companies');
});

test('a message is a job description when it is long and reads like one', () => {
  assert.ok(looksLikeJd(JD));
  assert.ok(!looksLikeJd('I learned Docker and Kubernetes, add them to my resume.'));
  assert.ok(!looksLikeJd('word '.repeat(60)), 'long is not enough');
  assert.ok(!looksLikeJd(''));
});

// ---------- reading the request ----------

test('the request and the job description are told apart, with or without a marker', () => {
  const marked = splitMessage(`${ASK}\n${JD}`);
  assert.equal(marked.instruction, 'I learned Docker and Kubernetes, add them to my resume.');
  assert.ok(marked.jdText.startsWith('Platform Engineer at Razorpay'));

  const colon = splitMessage(`Tailor my resume.\n\nJob description: ${JD}`);
  assert.equal(colon.instruction, 'Tailor my resume.');
  assert.ok(colon.jdText.startsWith('Platform Engineer'));

  const paragraph = splitMessage(`Please update my resume for this role.\n\n${JD}`);
  assert.equal(paragraph.instruction, 'Please update my resume for this role.');
  assert.ok(paragraph.jdText.includes('Requirements'));

  const bare = splitMessage(JD);
  assert.equal(bare.instruction, '');
  assert.equal(bare.jdText, JD);

  assert.deepEqual(splitMessage('add Docker to my skills'), { instruction: 'add Docker to my skills', jdText: '' });
});

test('the skills a person says they have come from what they said, never from the job description', () => {
  assert.deepEqual(declaredSkills('I learned Docker and Kubernetes, add them to my resume.'), { skills: ['Docker', 'Kubernetes'], how: 'told' });
  assert.deepEqual(declaredSkills('I have acquired Terraform & Ansible. Please add this to my resume'), { skills: ['Terraform', 'Ansible'], how: 'told' });
  assert.deepEqual(declaredSkills('My new skills are k8s, Helm and Prometheus.'), { skills: ['Kubernetes', 'Helm', 'Prometheus'], how: 'told' });
  assert.deepEqual(declaredSkills('my new skills: stakeholder management, Figma'), { skills: ['Stakeholder management', 'Figma'], how: 'told' }, 'with "skills" said, a short plain phrase counts');
  assert.deepEqual(declaredSkills('add Docker to my skills'), { skills: ['Docker'], how: 'command' });
  assert.deepEqual(declaredSkills('I learned to cook pasta'), { skills: [], how: null }, 'without "skills", only a known skill counts');
  assert.deepEqual(declaredSkills('make me a latest resume'), { skills: [], how: null });
  assert.deepEqual(declaredSkills('I learned Docker, Docker and docker'), { skills: ['Docker'], how: 'told' }, 'once each');

  const request = readRequest(`${ASK}\n${JD}`);
  assert.deepEqual(request.skills, ['Docker', 'Kubernetes'], 'Terraform is in the job description, not in what the person said');
  assert.equal(request.how, 'told');
});

test('the request says what the person wants, in their own words', () => {
  const intents = (text) => [...readRequest(text).intents].sort();
  assert.deepEqual(intents('make me a latest resume'), ['update']);
  assert.deepEqual(intents('Tailor my resume for this job'), ['update']);
  assert.deepEqual(intents('how well do I match this job?'), ['match']);
  assert.deepEqual(intents('write a cold email to the recruiter'), ['email']);
  assert.deepEqual(intents('Draft a cold mail'), ['email']);
  assert.deepEqual(intents('where are my rejections kept?'), ['rejections']);
  assert.deepEqual(intents('take me to the builder'), ['go']);
  assert.equal(readRequest('take me to the builder').target, 'resume-builder.html');
  assert.deepEqual(intents('hello'), []);
  assert.deepEqual(intents('make it fit on one page'), [], 'that is the Builder\'s own fit request, not an update');
  assert.equal(pageHref('Applications'), 'applications.html');
  assert.equal(pageHref('https://evil.example'), null);
});

// ---------- updating the resume ----------

test('an update adds only the skills the person said they have, puts the job\'s skills first and writes the Summary from skills already listed', () => {
  const resume = sampleResume();
  const jd = parseJd(JD);
  const plan = planResumeUpdate(resume, { skills: ['Docker', 'Kubernetes'], jd }, 'formal');
  assert.deepEqual(plan.add, ['Docker', 'Kubernetes']);
  assert.deepEqual(plan.order.slice(0, 2), ['Docker', 'Kubernetes']);
  assert.deepEqual([...plan.order].sort(), ['Docker', 'Java', 'Kubernetes', 'SQL', 'Spring Boot'].sort(), 'no other skill appears, in particular none from the job description');
  assert.deepEqual(plan.gap, ['Terraform', 'Linux', 'AWS', 'CI/CD', 'Jenkins'], 'what the job asks for and the resume lacks is listed, not added');
  assert.equal(plan.role, 'Platform Engineer');
  assert.match(plan.summary, /^Platform Engineer with hands-on experience in Java, Spring Boot and SQL/, 'it names skills that were listed before, not the ones just added');
  assert.ok(!/Docker|Kubernetes/.test(plan.summary), 'a skill the person has only just acquired is not claimed as experience');
  assert.ok(plan.summary.includes('cut their response time by 40%'), 'a fact the person wrote stays');
  assert.equal(plan.nothing, false);

  const next = applyResumePlan(resume, plan);
  assert.notEqual(next, resume);
  assert.deepEqual(next.experience, resume.experience, 'the experience is not touched');
  assert.deepEqual(next.education, resume.education);
  assert.equal(next.name, resume.name);
  assert.equal(next.contact, resume.contact);
  assert.deepEqual(resume.skills, ['Java', 'Spring Boot', 'SQL'], 'the old resume is untouched');
  assert.equal(planVersionName(plan), 'Lay AI: added Docker, Kubernetes; tailored for Platform Engineer (you agreed)');
});

test('an update with only skills adds them and nothing else', () => {
  const resume = sampleResume();
  const plan = planResumeUpdate(resume, { skills: ['Docker'] }, 'formal');
  assert.deepEqual(plan.add, ['Docker']);
  assert.equal(plan.reorder, false);
  assert.equal(plan.summary, null);
  assert.equal(plan.role, null);
  assert.equal(applyResumePlan(resume, plan).summary, resume.summary);
  assert.equal(planVersionName(plan), 'Lay AI: added Docker (you agreed)');
});

test('a skill the resume already has is not added twice, and an update that changes nothing says so', () => {
  const resume = sampleResume();
  const plan = planResumeUpdate(resume, { skills: ['java', 'SQL'] }, 'formal');
  assert.deepEqual(plan.add, []);
  assert.deepEqual(plan.already, ['Java', 'SQL'], 'reported as the resume writes them');
  assert.equal(plan.nothing, true);
  assert.equal(applyResumePlan(resume, plan), resume, 'the same object');
});

test('the Summary follows the writing style', () => {
  const resume = sampleResume();
  const jd = { role: 'Backend Engineer', company: null, skills: ['Java'], nice: [] };
  assert.match(planResumeUpdate(resume, { jd }, 'friendly').summary, /^I'm a backend engineer who enjoys/);
  assert.match(planResumeUpdate(resume, { jd }, 'concise').summary, /^Backend Engineer: Java/);
});

// ---------- a match ----------

test('a match counts the skills the job asks for, by what the resume lists and says', () => {
  const resume = sampleResume();
  resume.skills = ['Docker', 'Java'];
  resume.experience[0].details = 'Ran the payment APIs on Linux with Jenkins.';
  const match = matchAgainst(resume, parseJd(JD));
  assert.equal(match.total, 7);
  assert.deepEqual(match.matched, ['Docker', 'Linux', 'Jenkins']);
  assert.deepEqual(match.inText, ['Linux', 'Jenkins'], 'named in the experience text, not in Skills');
  assert.deepEqual(match.missing, ['Kubernetes', 'Terraform', 'AWS', 'CI/CD']);
  assert.equal(match.percent, 43);
  assert.deepEqual(match.nice, { have: [], total: 2 });

  const reply = matchReply(match);
  assert.match(reply, /Platform Engineer at Razorpay: you cover 3 of 7 skills it asks for \(43%\), a thin match\./);
  assert.match(reply, /Linux and Jenkins are in your experience text, not in Skills/);
  assert.match(reply, /Not on your resume: Kubernetes, Terraform, AWS and CI\/CD\. Tell me if you have any/);
  assert.match(reply, /Preview: this counts skills by name/);
});

test('a match with no skills in the description says so instead of showing 0%', () => {
  const match = matchAgainst(sampleResume(), { role: 'Chef', company: null, skills: [], nice: [] });
  assert.equal(match.total, 0);
  assert.match(matchReply(match), /could not find specific skills/);
  assert.ok(!/0%/.test(matchReply(match)));
});

// ---------- a cold email ----------

test('the cold email is the Letters draft for the job, with placeholders for anything personal', () => {
  const draft = draftColdEmail(sampleResume(), parseJd(JD));
  assert.match(draft.subject, /^Platform Engineer at Razorpay: \{user\.first_name\}/);
  assert.match(draft.body, /applying for the Platform Engineer role at Razorpay/);
  assert.match(draft.body, /\{other\.person_1\}/);
  assert.ok(!/Jane|jane@email|98765/.test(`${draft.subject}${draft.body}`), 'no real name, email or phone');
  assert.equal(draft.missingCompany, false);

  const noCompany = draftColdEmail(sampleResume(), { role: 'Data Analyst', company: null, skills: ['SQL'], nice: [] });
  assert.match(noCompany.body, /at \[Company\]/);
  assert.equal(noCompany.missingCompany, true);
});

// ---------- one turn: the first answer ----------

const ctx = (extra = {}) => ({ resume: sampleResume(), style: 'formal', claim: 'all', gmail: false, onBuilder: false, ...extra });

test('Lay AI proposes the whole change in plain lines and waits for a yes', () => {
  const turn = agentTurn(`${ASK}\n${JD}`, ctx());
  assert.equal(turn.strong, true);
  assert.match(turn.reply, /^Here is what I will change in your Builder, only if you say yes:/);
  assert.match(turn.reply, /- Add Docker and Kubernetes to Skills, because you told me you have them\./);
  assert.match(turn.reply, /- Put the skills this job asks for first\./);
  assert.match(turn.reply, /- Write your Summary for a Platform Engineer role, from skills you already list\./);
  assert.match(turn.reply, /- Leave your Experience, Education and contact details as they are\./);
  assert.match(turn.reply, /The job also asks for Terraform, Linux, AWS, CI\/CD and Jenkins\. I won't add them unless you tell me you have them\./);
  assert.deepEqual(turn.actions.map((a) => a.id), ['update', 'later']);
  assert.equal(turn.actions[0].label, 'Yes, open the Builder');
  assert.equal(turn.actions[0].primary, true);
  assert.deepEqual(turn.payload.skills, ['Docker', 'Kubernetes']);
  assert.equal(turn.payload.jd.company, 'Razorpay');
});

test('on the Builder the same request just asks for a yes there', () => {
  const turn = agentTurn(`${ASK}\n${JD}`, ctx({ onBuilder: true, claim: 'builder' }));
  assert.match(turn.reply, /^Here is what I will change in your resume/);
  assert.equal(turn.actions[0].label, 'Yes, do it');
  assert.ok(!/open the Builder/.test(turn.reply));
});

test('the Builder\'s own panel keeps plain commands, and Lay AI elsewhere claims them', () => {
  assert.equal(agentTurn('Add Docker to my skills', ctx({ claim: 'builder', onBuilder: true })), null, 'the panel adds it at once, as before');
  assert.equal(agentTurn('Shorten my summary', ctx({ claim: 'builder', onBuilder: true })), null);
  assert.equal(agentTurn('Make it fit a DevOps role', ctx({ claim: 'builder', onBuilder: true })), null, 'suggest mode keeps its own flow');
  assert.ok(agentTurn('Add Docker to my skills', ctx()), 'on another page there is no panel, so Lay AI proposes it');
  assert.ok(agentTurn('I learned Docker, add it to my resume', ctx({ claim: 'builder', onBuilder: true })), 'what the person has learned goes through the proposal even on the Builder');
});

test('a job description Lay AI read earlier is used for an update only when the message points at it', () => {
  const jd = parseJd(JD);
  const plain = agentTurn('I learned Docker, add it to my resume', ctx({ jd }));
  assert.equal(plain.payload.jd, null, 'a plain addition is not turned into a tailoring');
  assert.ok(!/Write your Summary/.test(plain.reply));
  const tailor = agentTurn('Tailor my resume for this job', ctx({ jd }));
  assert.equal(tailor.payload.jd.role, 'Platform Engineer');
  assert.match(tailor.reply, /Write your Summary for a Platform Engineer role/);
  assert.equal(agentTurn('Fit my resume on one page', ctx({ jd, claim: 'builder', onBuilder: true })), null, 'a page-fit request is not an update');
  assert.equal(agentTurn('Add Docker to my skills', ctx({ jd, claim: 'builder', onBuilder: true })), null);
});

test('a job description on its own is read back with the three things Lay AI can do with it', () => {
  const turn = agentTurn(JD, ctx());
  assert.match(turn.reply, /^I read the job description: Platform Engineer at Razorpay\. It asks for Kubernetes, Docker, Terraform, Linux, AWS, CI\/CD and Jenkins\./);
  assert.deepEqual(turn.actions.map((a) => a.id), ['update', 'match', 'email']);
});

test('a match, an email and the rest answer from the last job description Lay AI read', () => {
  const jd = parseJd(JD);
  const match = agentTurn('how well do I match this job?', ctx({ jd }));
  assert.match(match.reply, /you cover \d of 7 skills/);
  assert.deepEqual(match.actions.map((a) => a.id), ['email', 'done']);

  const none = agentTurn('how well do I match?', ctx());
  assert.match(none.reply, /Paste the job description/);

  const email = agentTurn('write a cold email', ctx({ jd, gmail: false }));
  assert.deepEqual(email.actions.map((a) => a.id), ['email-letters', 'connect-gmail', 'done'], 'without Gmail, the way in is to connect it');
  assert.ok(email.card.subject.length > 0 && email.card.body.length > 0);
  assert.match(email.reply, /Nothing is sent/);
  const withGmail = agentTurn('write a cold email', ctx({ jd, gmail: true }));
  assert.deepEqual(withGmail.actions.map((a) => a.id), ['email-letters', 'email-draft', 'done']);
  assert.ok(!withGmail.actions.some((a) => /send/i.test(a.id) && a.id !== 'email-letters'), 'no button sends mail from here');
  assert.ok(!withGmail.actions.some((a) => /^send/i.test(a.label)), 'no button is labelled Send');
});

test('without a resume Lay AI says so and keeps the request for the Builder', () => {
  const turn = agentTurn(`${ASK}\n${JD}`, ctx({ resume: null }));
  assert.match(turn.reply, /no resume in the Builder yet/);
  assert.equal(turn.actions[0].id, 'update');
  const step = agentStep('update', turn.payload, ctx({ resume: null }), NOW);
  assert.equal(step.effect.href, 'resume-builder.html');
  assert.deepEqual(step.effect.handoff.value.skills, ['Docker', 'Kubernetes']);
});

test('nothing to change says so', () => {
  const turn = agentTurn('I have acquired Java', ctx());
  assert.match(turn.reply, /Java is already in your Skills/);
  assert.deepEqual(turn.actions, []);
});

test('Lay AI points to pages and to the rejections, and falls back to help', () => {
  const go = agentTurn('take me to letters', ctx());
  assert.equal(go.strong, false);
  assert.deepEqual(go.actions.map((a) => a.id), ['go']);
  assert.equal(go.payload.href, 'letters.html');
  const rejections = agentTurn('where are my rejections kept?', ctx({ applications: [{ id: 'a', company: 'Acme', role: 'Dev', status: 'REJECTED' }] }));
  assert.equal(rejections.strong, false);
  assert.match(rejections.reply, /Dev at Acme/);
  assert.match(rejections.reply, /Rejected column/);
  assert.equal(agentTurn('hello there', ctx()), null, 'a greeting is not something the agent claims');
  assert.match(HELP_REPLY, /I learned Docker and Kubernetes, add them to my resume/, 'the page shows this help when nothing else answers');
});

test('every opening answer is plain: no exclamation marks, no buttons that send', () => {
  const messages = [`${ASK}\n${JD}`, JD, 'write a cold email', 'how well do I match?', 'I learned Docker'];
  for (const text of messages) {
    const turn = agentTurn(text, ctx({ jd: parseJd(JD), gmail: true })) ?? { reply: '', actions: [] };
    assert.ok(!turn.reply.includes('!'), text);
    for (const a of turn.actions) {
      assert.ok(!/^send\b/i.test(a.label), a.label);
    }
  }
});

// ---------- one step: after a button ----------

test('the first yes, away from the Builder, hands the request over and opens the Builder', () => {
  const turn = agentTurn(`${ASK}\n${JD}`, ctx());
  const step = agentStep('update', turn.payload, ctx(), NOW);
  assert.equal(step.effect.type, 'navigate');
  assert.equal(step.effect.href, 'resume-builder.html');
  assert.equal(step.effect.handoff.key, 'builder');
  assert.equal(step.resume, undefined, 'nothing is changed here');
  const handoff = readBuilderHandoff(step.effect.handoff.value, NOW + 1000);
  assert.deepEqual(handoff.skills, ['Docker', 'Kubernetes']);
  assert.equal(handoff.jd.role, 'Platform Engineer');
  assert.ok(handoff.jd.skills.includes('Terraform'));
});

test('on the Builder the yes makes one new version and offers the match next', () => {
  const resume = sampleResume();
  const turn = agentTurn(`${ASK}\n${JD}`, ctx({ resume, onBuilder: true, claim: 'builder' }));
  const step = agentStep('update', turn.payload, ctx({ resume, onBuilder: true }), NOW);
  assert.equal(step.effect, undefined);
  assert.equal(step.summary, 'Lay AI: added Docker, Kubernetes; tailored for Platform Engineer (you agreed)');
  assert.deepEqual(step.resume.skills.slice(0, 2), ['Docker', 'Kubernetes']);
  assert.deepEqual(step.resume.experience, resume.experience);
  assert.match(step.reply, /^Done: added Docker and Kubernetes, put the skills the job asks for first and wrote your Summary for Platform Engineer\./);
  assert.match(step.reply, /I won't add them unless you tell me you have them/);
  assert.deepEqual(step.actions.map((a) => a.id), ['match', 'later']);
  assert.equal(step.payload.jd.company, 'Razorpay');
});

test('the match, then the email, then Letters or a Gmail draft: each one only when asked', () => {
  const resume = sampleResume();
  const jd = parseJd(JD);
  const match = agentStep('match', { jd }, { resume }, NOW);
  assert.match(match.reply, /Platform Engineer at Razorpay: you cover/);
  assert.deepEqual(match.actions.map((a) => a.id), ['email', 'done']);

  const email = agentStep('email', { jd }, { resume, gmail: true }, NOW);
  assert.ok(email.card);
  assert.deepEqual(email.actions.map((a) => a.id), ['email-letters', 'email-draft', 'done']);

  const letters = agentStep('email-letters', { jd }, { resume }, NOW);
  assert.equal(letters.effect.href, 'letters.html');
  assert.equal(letters.effect.handoff.key, 'letters');
  assert.equal(readLettersHandoff(letters.effect.handoff.value, NOW).job.company, 'Razorpay');
  assert.match(letters.reply, /nothing goes before that/);

  const fill = (text) => text.replace(/\{user\.first_name\}/g, 'Jane').replace(/\{user\.name\}/g, 'Jane Doe').replace(/\{user\.phone\}/g, '+91 98765 43210').replace(/\{other\.person_1\}/g, 'there').replace(/\{user\.link\}/g, 'linkedin.com/in/jane');
  const draft = agentStep('email-draft', { jd }, { resume, fill }, NOW);
  assert.match(draft.reply, /^Saved in the Drafts of jane\.doe@gmail\.com/);
  assert.match(draft.reply, /Nothing was sent/);
  assert.match(draft.reply, /Resume PDF, Cover letter PDF/);
  assert.match(draft.reply, /Subject: Platform Engineer at Razorpay: Jane, backend developer/);
  assert.match(draft.reply, /Sample: the preview saves nothing in Gmail/);
  assert.equal(draft.effect, undefined);

  const noCompany = agentStep('email-draft', { jd: { role: 'Data Analyst', skills: ['SQL'] } }, { resume, fill }, NOW);
  assert.match(noCompany.reply, /Before you send, fill in \[Company\] \(the company name\)\./);
  assert.doesNotMatch(draft.reply, /Before you send/, 'a draft with nothing blank says nothing about blanks');

  const noLink = agentStep('email-draft', { jd }, { resume, fill: (text) => fill(text).replace('linkedin.com/in/jane', '{user.link}') }, NOW);
  assert.match(noLink.reply, /Before you send, fill in \{user\.link\} \(your link\)\./);

  const asked = agentStep('email', { jd }, { resume, gmail: true, fill: (text) => fill(text).replace('linkedin.com/in/jane', '{user.link}') }, NOW);
  assert.match(asked.reply, /Before you send, fill in \{user\.link\} \(your link\)\./);
});

test('connect Gmail, go to a page, not now and done', () => {
  assert.equal(agentStep('connect-gmail', {}, {}, NOW).effect.href, 'settings.html');
  assert.equal(agentStep('go', { href: 'wallet.html' }, {}, NOW).effect.href, 'wallet.html');
  const refused = agentStep('go', { href: 'https://evil.example/' }, {}, NOW);
  assert.equal(refused.effect, undefined, 'only pages of this app');
  assert.match(refused.reply, /only open pages of this app/);
  assert.match(agentStep('later', {}, {}, NOW).reply, /left everything as it is/);
  assert.equal(agentStep('done', {}, {}, NOW).reply, 'Okay.');
  assert.match(agentStep('nope', {}, {}, NOW).reply, /do not know/);
  assert.match(agentStep('match', { jd: null }, { resume: null }, NOW).reply, /need a resume and a job description/);
});

// ---------- what travels between pages ----------

test('a request waiting for the Builder is cleaned, and it goes stale', () => {
  const handoff = makeBuilderHandoff({ skills: ['Docker', 'docker', '', 7, 'Kubernetes'], jd: { role: 'SRE', company: null, skills: ['Linux', 'Linux'], nice: [], text: 'never kept', secret: 1 } }, NOW);
  assert.deepEqual(handoff.skills, ['Docker', 'Kubernetes']);
  assert.deepEqual(handoff.jd, { role: 'SRE', company: null, skills: ['Linux'], nice: [] });
  assert.ok(!JSON.stringify(handoff).includes('never kept'), 'the text of a job description is not kept');
  assert.deepEqual(readBuilderHandoff(handoff, NOW + 60_000), handoff);
  assert.equal(readBuilderHandoff(handoff, NOW + HANDOFF_TTL_MS + 1), null, 'stale after two hours');
  assert.equal(readBuilderHandoff({ ...handoff, at: NOW + 3_600_000 }, NOW), null, 'not from the future');
  assert.equal(readBuilderHandoff({ ...handoff, v: 2 }, NOW), null);
  assert.equal(readBuilderHandoff(null, NOW), null);
  assert.equal(readBuilderHandoff('x', NOW), null);
  assert.equal(readBuilderHandoff(makeBuilderHandoff({}, NOW), NOW), null, 'an empty request is nothing');
});

test('a job waiting for Letters keeps only a safe id, a title, a company and skills', () => {
  const handoff = makeLettersHandoff(parseJd(JD), NOW);
  assert.equal(handoff.job.id, 'lay-razorpay-platform-engineer');
  assert.equal(handoff.job.title, 'Platform Engineer');
  assert.equal(handoff.job.company, 'Razorpay');
  assert.ok(handoff.job.skills.length <= 12);
  assert.deepEqual(readLettersHandoff(handoff, NOW), handoff);
  assert.equal(readLettersHandoff({ ...handoff, job: { ...handoff.job, id: 'job-1' } }, NOW), null, 'an id that is not ours');
  assert.equal(readLettersHandoff({ ...handoff, job: { ...handoff.job, id: 'lay-../../x' } }, NOW), null);
  assert.equal(readLettersHandoff({ ...handoff, at: NOW - HANDOFF_TTL_MS - 5 }, NOW), null);
  assert.equal(readLettersHandoff({ v: 1, at: NOW }, NOW), null);
  const bare = makeLettersHandoff({ role: null, company: null, skills: ['SQL'] }, NOW);
  assert.equal(bare.job.company, '[Company]');
  assert.equal(bare.job.title, 'Open role');
});

test('what Lay AI keeps of a job description has no text and stays small', () => {
  assert.equal(cleanJd(null), null);
  assert.equal(cleanJd({}), null);
  assert.equal(cleanJd({ role: '   ' }), null);
  const jd = cleanJd({ role: 'x'.repeat(200), skills: Array.from({ length: 60 }, (_, i) => `Skill${i}`) });
  assert.equal(jd.role.length, 80);
  assert.equal(jd.skills.length, 30);
});

test('the chat history keeps well-formed messages and the newest ones', () => {
  assert.deepEqual(cleanChat('x'), []);
  const messages = Array.from({ length: 45 }, (_, i) => ({ who: i % 2 ? 'lay' : 'you', text: `m${i}` }));
  const kept = cleanChat([...messages, { who: 'bot', text: 'x' }, { who: 'you', text: '' }, null, { who: 'lay', text: 'ok', card: { subject: 's', body: 'b' } }, { who: 'lay', text: 'bad card', card: { subject: 1 } }]);
  assert.equal(kept.length, MAX_CHAT);
  assert.deepEqual(kept.at(-2), { who: 'lay', text: 'ok', card: { subject: 's', body: 'b' } });
  assert.deepEqual(kept.at(-1), { who: 'lay', text: 'bad card' }, 'a broken card is dropped, the message stays');
  assert.ok(kept.every((m) => m.who === 'you' || m.who === 'lay'));
});
