package com.resumeanalyser.builder.dto;

import java.util.UUID;

/** One row of a person's list of documents: enough to choose one, without its versions. */
public record DocumentSummaryDto(UUID id, String title, String templateId, int current, long updatedAt) {
}
