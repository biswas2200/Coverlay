package com.resumeanalyser.builder;

import com.resumeanalyser.account.User;
import org.mockito.Mockito;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

/**
 * The two builder repositories as Mockito mocks that behave like a small database, so a service test can look at what was
 * really stored, not only at which calls were made. The project has no database-backed tests; the real mapping is checked
 * against Postgres separately.
 */
final class InMemoryBuilderStore {

    final ResumeDocumentRepository documents = Mockito.mock(ResumeDocumentRepository.class);
    final ResumeDocumentVersionRepository versions = Mockito.mock(ResumeDocumentVersionRepository.class);

    final List<ResumeDocument> storedDocuments = new ArrayList<>();
    final List<ResumeDocumentVersion> storedVersions = new ArrayList<>();

    InMemoryBuilderStore() {
        when(documents.save(any(ResumeDocument.class))).thenAnswer(call -> {
            ResumeDocument document = call.getArgument(0);
            if (document.getId() == null) {
                document.setId(UUID.randomUUID());
            }
            if (!storedDocuments.contains(document)) {
                storedDocuments.add(document);
            }
            return document;
        });
        when(documents.findByIdAndUser(any(), any())).thenAnswer(call -> {
            UUID id = call.getArgument(0);
            User user = call.getArgument(1);
            return storedDocuments.stream().filter(d -> d.getId().equals(id) && d.getUser() == user).findFirst();
        });
        when(documents.findByUserOrderByUpdatedAtDesc(any())).thenAnswer(call -> {
            User user = call.getArgument(0);
            return storedDocuments.stream().filter(d -> d.getUser() == user)
                    .sorted(Comparator.comparing(ResumeDocument::getUpdatedAt).reversed()).toList();
        });
        Mockito.doAnswer(call -> {
            ResumeDocument document = call.getArgument(0);
            storedDocuments.remove(document);
            storedVersions.removeIf(v -> v.getDocument() == document); // the database cascades
            return null;
        }).when(documents).delete(any(ResumeDocument.class));

        when(versions.save(any(ResumeDocumentVersion.class))).thenAnswer(call -> {
            ResumeDocumentVersion version = call.getArgument(0);
            if (version.getId() == null) {
                version.setId(UUID.randomUUID());
            }
            if (!storedVersions.contains(version)) {
                storedVersions.add(version);
            }
            return version;
        });
        when(versions.findByDocumentOrderByNumberAsc(any())).thenAnswer(call -> {
            ResumeDocument document = call.getArgument(0);
            return storedVersions.stream().filter(v -> v.getDocument() == document)
                    .sorted(Comparator.comparingInt(ResumeDocumentVersion::getNumber)).toList();
        });
        Mockito.doAnswer(call -> {
            storedVersions.remove((ResumeDocumentVersion) call.getArgument(0));
            return null;
        }).when(versions).delete(any(ResumeDocumentVersion.class));
    }

    /** The numbers of the versions still stored for a document, oldest first. */
    List<Integer> numbersOf(ResumeDocument document) {
        return storedVersions.stream().filter(v -> v.getDocument() == document)
                .map(ResumeDocumentVersion::getNumber).sorted().toList();
    }
}
