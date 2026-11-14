package com.resumeanalyser.builder.dto;

import com.fasterxml.jackson.databind.JsonNode;

/**
 * {@code POST /builder/documents/{id}/versions}. There is no time and no number: the server's clock and counter are the only
 * source of both (BE-03), so anything the client sends for them is ignored.
 */
public record WriteVersionRequest(Integer baseVersion, JsonNode resume, String source, String summary) {
}
