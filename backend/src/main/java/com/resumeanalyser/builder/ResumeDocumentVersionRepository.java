package com.resumeanalyser.builder;

import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.UUID;

/** Persistence for {@link ResumeDocumentVersion}. */
public interface ResumeDocumentVersionRepository extends JpaRepository<ResumeDocumentVersion, UUID> {

    /** The versions of a document, oldest first. */
    List<ResumeDocumentVersion> findByDocumentOrderByNumberAsc(ResumeDocument document);
}
