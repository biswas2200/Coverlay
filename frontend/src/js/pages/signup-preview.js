import { byId, el, setText, show } from '../core/dom.js';
import { regionFromTimeZone } from './settings-rules.js';
import { analyticsDefault, emailState, finalStepError, normalizePhone, otpValid, validPassword } from './signup-rules.js';

// The planned sign-up, clickable: account -> phone with a code -> privacy choices. Nothing is
// sent anywhere; the code is always 123456.

let step = 1;
let codeSent = false;

wire();
setRegion(regionFromTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone));
renderSteps();

function goTo(next) {
  step = next;
  for (const n of [1, 2, 3]) {
    show(byId(`step-${n}`), n === step);
  }
  renderSteps();
}

function renderSteps() {
  for (const item of document.querySelectorAll('.signup-steps li')) {
    const n = Number(item.dataset.step);
    item.classList.toggle('is-done', n < step);
    item.toggleAttribute('aria-current', n === step);
  }
}

function setRegion(region) {
  byId('su-region').value = region;
  byId('su-analytics').checked = analyticsDefault(region);
  setText(byId('su-default'), region === 'EU/UK' ? ' Off until you tick it (EU/UK).' : ' On by default; you can switch it off any time.');
}

function wire() {
  byId('su-email').addEventListener('input', () => show(byId('su-deleting'), false));
  byId('step-1').addEventListener('submit', (event) => {
    event.preventDefault();
    const state = emailState(byId('su-email').value);
    if (state === 'invalid') {
      setText(byId('su-error-1'), 'Enter a valid email address.');
      return;
    }
    if (state === 'deleting') {
      const date = new Date(Date.now() + 9 * 24 * 60 * 60 * 1000);
      setText(byId('su-deleting-date'), date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }));
      show(byId('su-deleting'));
      setText(byId('su-error-1'), '');
      return;
    }
    if (!validPassword(byId('su-password').value)) {
      setText(byId('su-error-1'), 'Use 8 to 72 characters for the password.');
      return;
    }
    setText(byId('su-error-1'), '');
    goTo(2);
  });
  byId('su-restore').addEventListener('click', () => {
    show(byId('su-deleting'), false);
    setText(byId('su-error-1'), '');
    show(byId('su-done'));
    setText(byId('su-done'), 'Restored (preview): the old account is back and the deletion is cancelled. Sign in as usual.');
  });
  byId('su-fresh').addEventListener('click', () => {
    show(byId('su-deleting'), false);
    setText(byId('su-error-1'), 'The old account is deleted now (preview). Choose a password to start fresh with the same email.');
    byId('su-email').value = 'fresh-start@example.com';
  });
  byId('step-2').addEventListener('submit', (event) => {
    event.preventDefault();
    if (!codeSent) {
      if (!normalizePhone(byId('su-phone').value)) {
        setText(byId('su-error-2'), 'Enter a mobile number like +91 98765 43210.');
        return;
      }
      codeSent = true;
      setText(byId('su-error-2'), '');
      show(byId('su-otp-field'));
      setText(byId('su-phone-submit'), 'Verify');
      byId('su-otp').focus();
      return;
    }
    if (!otpValid(byId('su-otp').value)) {
      setText(byId('su-error-2'), "That code doesn't match. In the preview it's 123456.");
      return;
    }
    setText(byId('su-error-2'), '');
    goTo(3);
  });
  byId('su-region').addEventListener('change', (event) => setRegion(event.target.value));
  byId('step-3').addEventListener('submit', (event) => {
    event.preventDefault();
    const error = finalStepError({ adult: byId('su-age').checked, terms: byId('su-terms').checked });
    setText(byId('su-error-3'), error);
    if (error) {
      return;
    }
    show(byId('step-3'), false);
    show(byId('su-done'));
    setText(byId('su-done'), `Account created (preview). Analytics ${byId('su-analytics').checked ? 'on' : 'off'}; you can change it in Settings & privacy. `);
    byId('su-done').append(el('a', { href: 'resume-builder.html#linkedin' }, 'Start your resume from your LinkedIn profile'), '.');
    step = 4;
    renderSteps();
  });
}
