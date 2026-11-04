// The planned sign-up (preview): which email states the form can meet, phone and code checks,
// and the analytics default by region. DOM-free so tests/signup-rules.test.js can run it.

import { defaultConsents } from './settings-rules.js';

export const SAMPLE_OTP = '123456';

/**
 * What the form does with an email: "free" (sign up), "deleting" (the account is in its
 * 14-day undo window: restore it or delete it now and start fresh), "invalid". In the preview
 * deleting@example.com stands for an account being deleted. Once an account is purged, its
 * email is simply free again -- never "already exists".
 */
export function emailState(email) {
  const value = String(email ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    return 'invalid';
  }
  return value === 'deleting@example.com' ? 'deleting' : 'free';
}

export function validPassword(password) {
  const length = String(password ?? '').length;
  return length >= 8 && length <= 72;
}

/** A mobile number with its country code: 10 to 15 digits, spaces and dashes allowed. */
export function normalizePhone(raw) {
  const value = String(raw ?? '').replace(/[\s-]/g, '');
  return /^\+?\d{10,15}$/.test(value) ? (value.startsWith('+') ? value : `+91${value}`) : null;
}

export function otpValid(code) {
  return String(code ?? '').trim() === SAMPLE_OTP;
}

/** Whether the analytics box starts ticked: no in the EU/UK (opt-in), yes elsewhere. */
export function analyticsDefault(region) {
  return defaultConsents(region).analytics;
}

/** Why the last step can't finish, or null. 18+ and the terms are required; analytics is not. */
export function finalStepError({ adult, terms }) {
  if (!adult) {
    return 'Coverlay is for people 18 and older for now.';
  }
  if (!terms) {
    return 'Please agree to the Terms and the Privacy notice.';
  }
  return null;
}
