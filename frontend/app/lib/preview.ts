/**
 * Whether the clickable-preview screens are in this build: the Team insights mock-up and the preview hub. They are for
 * design review, not part of the product (docs/prototype-spec.md, RB-PRE-01), so a production build leaves them out.
 */
export const PREVIEW: boolean = import.meta.env.DEV || import.meta.env.VITE_PREVIEW === 'true';
