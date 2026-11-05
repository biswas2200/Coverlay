// Sample answers for the backend API, so every page can be clicked through without the backend.
// Pure (no Node APIs), so both previews use it: the Node preview server (mock-api.mjs) and the
// hosted copy, where js/config.js answers fetch() in the page (build-hosted.mjs). Nothing is
// stored: each call gets the same sample data, and anything that needs the real engine
// (uploading a resume) says so.

export const PREVIEW_USER = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'preview@coverlay.app',
  role: 'ADMIN',
  createdAt: '2026-11-01T09:00:00Z',
};

const DAY_MS = 24 * 60 * 60 * 1000;

function sampleJobs(now = Date.now()) {
  const job = (id, title, company, location, workplaceType, daysAgo, excerpt) => ({
    id,
    title,
    company,
    location,
    workplaceType,
    employmentType: 'Full-time',
    publishedAt: new Date(now - daysAgo * DAY_MS).toISOString(),
    firstSeenAt: new Date(now - daysAgo * DAY_MS).toISOString(),
    excerpt,
    applyUrl: 'https://example.com/apply',
    url: 'https://example.com/job',
    active: true,
  });
  return [
    job('job-1', 'Backend Engineer', 'Swiggy', 'Bengaluru, India', 'hybrid', 1, 'Java and Spring Boot services for orders and payments.'),
    job('job-2', 'Software Development Engineer II', 'Flipkart', 'Bengaluru, India', 'onsite', 3, 'Distributed systems, Kafka, high-traffic APIs.'),
    job('job-3', 'Platform Engineer', 'Razorpay', 'Bengaluru, India', 'hybrid', 5, 'Kubernetes, Terraform and CI/CD for the payments platform.'),
    job('job-4', 'DevOps Engineer', 'Zerodha', 'Bengaluru, India', 'onsite', 9, 'Linux, Docker, monitoring and on-call for trading systems.'),
  ];
}

const ROUTES = [
  ['GET', /^\/auth\/me$/, () => [200, PREVIEW_USER]],
  ['POST', /^\/auth\/(?:login|register)$/, () => [200, {
    token: 'preview-token', tokenType: 'Bearer', expiresAt: new Date(Date.now() + DAY_MS).toISOString(), user: PREVIEW_USER,
  }]],
  ['GET', /^\/resumes$/, () => [200, []]],
  ['POST', /^\/resumes$/, () => [503, { message: 'Uploading needs the real backend. This is the clickable preview with sample data.' }]],
  ['GET', /^\/recommendations\/dashboard$/, () => [204]],
  ['GET', /^\/jobs\/recommended$/, () => {
    const jobs = sampleJobs();
    return [200, {
      resumeId: null, resumeVersion: null, roles: [], openJobs: jobs.length,
      jobs: jobs.map((job) => ({ job, score: null, coverage: null, matchedSkills: [], missingSkills: [], closestRole: null, why: 'Newest first: upload a resume to rank these for you.', savedStatus: null })),
    }];
  }],
  ['GET', /^\/jobs\/in-demand$/, () => [200, { roles: [] }]],
  ['GET', /^\/jobs\/saved$/, () => [200, []]],
  ['PUT', /^\/jobs\/[^/]+\/saved$/, () => [204]],
  ['DELETE', /^\/jobs\/[^/]+\/saved$/, () => [204]],
  ['GET', /^\/watchlist$/, () => [200, []]],
  ['GET', /^\/watchlist\/limits$/, () => [200, { maxCompanies: 10 }]],
  ['GET', /^\/watchlist\/companies$/, () => [200, []]],
  ['GET', /^\/bug-reports\/mine$/, () => [200, []]],
  ['POST', /^\/bug-reports$/, () => [201, { id: 'preview-bug', status: 'NEW' }]],
  ['GET', /^\/admin\/bug-reports$/, () => [200, []]],
];

/**
 * The answer to one API call, `{ status, body }` (body undefined for an empty answer). `path` is
 * the URL path, with or without the leading `/api`; the query string is ignored.
 */
export function answer(method, path) {
  const route = String(path ?? '').split('?')[0].replace(/^\/api(?=\/)/, '');
  const verb = String(method ?? 'GET').toUpperCase();
  for (const [routeMethod, pattern, reply] of ROUTES) {
    if (verb === routeMethod && pattern.test(route)) {
      const [status, body] = reply();
      return { status, body: status === 204 ? undefined : body };
    }
  }
  return { status: 404, body: { message: `Not in the preview: ${verb} ${route}` } };
}
