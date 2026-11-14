// The Node preview server's API: sends the sample answers from mock-answers.js (shared with the
// hosted copy, which answers in the page instead).

import { answer } from './mock-answers.js';

export { PREVIEW_USER } from './mock-answers.js';

function send(res, status, body) {
  if (body === undefined) {
    res.writeHead(status);
    res.end();
    return;
  }
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

/** Answers one /api/... request from the sample data; anything else is a 404. */
export function handleApi(req, res, url) {
  // Drain any request body before answering.
  req.resume();
  const { status, body } = answer(req.method, url.pathname);
  send(res, status, body);
}
