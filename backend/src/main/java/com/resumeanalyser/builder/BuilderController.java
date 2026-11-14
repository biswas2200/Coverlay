package com.resumeanalyser.builder;

import com.resumeanalyser.account.User;
import com.resumeanalyser.account.UserRepository;
import com.resumeanalyser.builder.dto.CreateDocumentRequest;
import com.resumeanalyser.builder.dto.DocumentDto;
import com.resumeanalyser.builder.dto.DocumentSummaryDto;
import com.resumeanalyser.builder.dto.FormatRequest;
import com.resumeanalyser.builder.dto.TemplateRequest;
import com.resumeanalyser.builder.dto.VersionDto;
import com.resumeanalyser.builder.dto.WriteVersionRequest;
import com.resumeanalyser.common.BadRequestException;
import com.resumeanalyser.common.ResourceNotFoundException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import java.util.List;
import java.util.UUID;

/**
 * The Resume Builder's documents (docs/prototype-spec.md section 9.1). Every call acts on the signed-in person's own
 * documents; another person's id is a 404 (BE-04). Validation lives in {@link BuilderDocumentService}.
 *
 * <p>Not here yet: export (RB-EXP) and Lay AI chat (RB-AI), which need the renderers and the ML service.
 */
@RestController
@RequestMapping("/builder/documents")
public class BuilderController {

    private final BuilderDocumentService service;
    private final UserRepository userRepository;

    public BuilderController(BuilderDocumentService service, UserRepository userRepository) {
        this.service = service;
        this.userRepository = userRepository;
    }

    @PostMapping
    public ResponseEntity<DocumentDto> start(@RequestBody CreateDocumentRequest request, Authentication authentication) {
        if (request.fromUploadId() != null) {
            throw new BadRequestException("Starting from an upload is not available yet. Start from a template instead.");
        }
        DocumentDto created = service.create(currentUser(authentication), request.answers(), request.templateId());
        return ResponseEntity.status(HttpStatus.CREATED).body(created);
    }

    @GetMapping
    public List<DocumentSummaryDto> list(Authentication authentication) {
        return service.list(currentUser(authentication));
    }

    @GetMapping("/{id}")
    public DocumentDto read(@PathVariable UUID id, Authentication authentication) {
        return service.get(currentUser(authentication), id);
    }

    @PutMapping("/{id}/format")
    public BuilderFormat format(@PathVariable UUID id, @RequestBody FormatRequest request, Authentication authentication) {
        return service.setFormat(currentUser(authentication), id, request.format());
    }

    @PutMapping("/{id}/template")
    public DocumentDto template(@PathVariable UUID id, @RequestBody TemplateRequest request, Authentication authentication) {
        return service.setTemplate(currentUser(authentication), id, request.templateId());
    }

    @PostMapping("/{id}/versions")
    public ResponseEntity<VersionDto> writeVersion(@PathVariable UUID id, @RequestBody WriteVersionRequest request, Authentication authentication) {
        VersionDto written = service.writeVersion(currentUser(authentication), id, request.baseVersion(), request.resume(),
                request.source(), request.summary());
        return ResponseEntity.status(HttpStatus.CREATED).body(written);
    }

    @PostMapping("/{id}/versions/{number}/restore")
    public VersionDto restore(@PathVariable UUID id, @PathVariable int number, Authentication authentication) {
        return service.restore(currentUser(authentication), id, number);
    }

    /** How an ATS reads the resume (RB-ATS): the current version, or the one named by {@code version}. */
    @GetMapping("/{id}/reading-order")
    public ReadingOrder readingOrder(@PathVariable UUID id, @RequestParam(required = false) Integer version, Authentication authentication) {
        return service.readingOrder(currentUser(authentication), id, version);
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable UUID id, Authentication authentication) {
        service.delete(currentUser(authentication), id);
        return ResponseEntity.noContent().build();
    }

    private User currentUser(Authentication authentication) {
        return userRepository.findByEmail(authentication.getName())
                .orElseThrow(() -> new ResourceNotFoundException("No user with email " + authentication.getName()));
    }
}
