package com.resumeanalyser.builder.dto;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.UUID;

/** {@code POST /builder/documents}: the start answers, the template, and (not available yet) an upload to start from. */
public record CreateDocumentRequest(JsonNode answers, String templateId, UUID fromUploadId) {
}
