-- Resume Builder documents and their versions (docs/prototype-spec.md section 9.1: RB-VER, BE-02, BE-03, BE-04).
-- V11 is left free for the accounts / consent / applications migration planned in the data model, which will point
-- job_applications.resume_version_id at resume_document_versions(id).

CREATE TABLE resume_documents (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title           VARCHAR(80)  NOT NULL,                 -- the target role, or "My resume"
    answers         JSONB        NOT NULL,                 -- the start answers (RB-TPL-01)
    template_id     VARCHAR(40)  NOT NULL,
    format          JSONB        NOT NULL,                 -- the page format (RB-FMT); not versioned
    current_version INTEGER      NOT NULL CHECK (current_version >= 1),
    revision        BIGINT       NOT NULL DEFAULT 0,       -- optimistic lock (RB-VER-07)
    created_at      TIMESTAMPTZ  NOT NULL,
    updated_at      TIMESTAMPTZ  NOT NULL
);
CREATE INDEX idx_resume_documents_user ON resume_documents (user_id, updated_at DESC);

CREATE TABLE resume_document_versions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID         NOT NULL REFERENCES resume_documents(id) ON DELETE CASCADE,
    number      INTEGER      NOT NULL CHECK (number >= 1),  -- 1, 2, 3 ... within the document; never reused
    source      VARCHAR(20)  NOT NULL CHECK (source IN ('template', 'import', 'you', 'ai', 'restore')),  -- RB-VER-01
    summary     VARCHAR(200) NOT NULL,
    content     JSONB        NOT NULL,                      -- the whole resume, in its canonical form
    saved_at    TIMESTAMPTZ  NOT NULL,                      -- the server's clock (BE-03)
    UNIQUE (document_id, number)
);
