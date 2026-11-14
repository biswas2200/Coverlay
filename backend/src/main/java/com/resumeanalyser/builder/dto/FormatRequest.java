package com.resumeanalyser.builder.dto;

import com.fasterxml.jackson.databind.JsonNode;

/** {@code PUT /builder/documents/{id}/format}: whatever format the page holds; the server makes it valid. */
public record FormatRequest(JsonNode format) {
}
