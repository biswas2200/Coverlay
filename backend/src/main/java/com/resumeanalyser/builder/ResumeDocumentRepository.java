package com.resumeanalyser.builder;

import com.resumeanalyser.account.User;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/** Persistence for {@link ResumeDocument}. Every lookup names the owner, so another person's id is simply not found (BE-04). */
public interface ResumeDocumentRepository extends JpaRepository<ResumeDocument, UUID> {

    Optional<ResumeDocument> findByIdAndUser(UUID id, User user);

    /** A person's documents, most recently changed first. */
    List<ResumeDocument> findByUserOrderByUpdatedAtDesc(User user);
}
