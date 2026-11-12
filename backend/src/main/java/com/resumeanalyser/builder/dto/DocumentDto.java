package com.resumeanalyser.builder.dto;

import com.resumeanalyser.builder.BuilderAnswers;
import com.resumeanalyser.builder.BuilderFormat;
import java.util.List;
import java.util.UUID;

/** A document with all its versions, oldest first (docs/prototype-spec.md section 9.1). {@code title} is an addition. */
public record DocumentDto(UUID id, String title, BuilderAnswers answers, String templateId, BuilderFormat format,
                          List<VersionDto> versions, int current) {
}
