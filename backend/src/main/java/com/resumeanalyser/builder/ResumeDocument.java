package com.resumeanalyser.builder;

import com.fasterxml.jackson.databind.JsonNode;
import com.resumeanalyser.account.User;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;
import java.time.Instant;
import java.util.UUID;

/**
 * One resume made in the Builder (docs/prototype-spec.md section 9.1). The resume itself lives in its versions
 * ({@link ResumeDocumentVersion}); the document keeps what is not versioned: the start answers, the template and the
 * format (RB-FMT), and which version is current. A person reaches only their own documents (BE-04).
 */
@Entity
@Table(name = "resume_documents")
@Getter
@Setter
public class ResumeDocument {

    @Id
    @GeneratedValue
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    /** What the document is called in the list: the target role, or "My resume" when there is none. */
    @Column(nullable = false, length = 80)
    private String title;

    /** The start answers (RB-TPL-01), as {@link BuilderAnswers} in JSON. */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(nullable = false)
    private JsonNode answers;

    @Column(name = "template_id", nullable = false, length = 40)
    private String templateId;

    /** The format (RB-FMT) in JSON; read back through {@link FormatNormalizer}, so an older value loads valid. */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(nullable = false)
    private JsonNode format;

    /** The number of the current version. */
    @Column(name = "current_version", nullable = false)
    private int current;

    /** Optimistic lock: two writes that both read the same document cannot both win (RB-VER-07). */
    @Version
    @Column(nullable = false)
    private long revision;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;
}
