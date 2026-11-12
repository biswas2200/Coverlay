package com.resumeanalyser.builder;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;
import java.time.Instant;
import java.util.UUID;

/**
 * One saved state of a resume (RB-VER). A version is complete (a whole resume, not a change) and is never edited: history is
 * append-only (RB-VER-07, BE-03). Only the oldest are removed, when a document passes 50 (RB-VER-06).
 */
@Entity
@Table(name = "resume_document_versions")
@Getter
@Setter
public class ResumeDocumentVersion {

    @Id
    @GeneratedValue
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "document_id", nullable = false)
    private ResumeDocument document;

    /** 1, 2, 3 ... within the document; never reused. */
    @Column(nullable = false)
    private int number;

    /** One of {@code template}, {@code import}, {@code you}, {@code ai}, {@code restore} (RB-VER-01). */
    @Column(nullable = false, length = 20)
    private String source;

    @Column(nullable = false, length = 200)
    private String summary;

    /** The whole resume in its canonical form ({@link ResumeNormalizer}). */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(nullable = false)
    private JsonNode content;

    /** Set by the server's clock, never the client's (BE-03). */
    @Column(name = "saved_at", nullable = false, updatable = false)
    private Instant at;
}
