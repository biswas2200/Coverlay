package com.resumeanalyser.builder.dto;

import com.fasterxml.jackson.databind.JsonNode;

/**
 * A version as the API shows it (docs/prototype-spec.md, RB-VER): {@code at} is milliseconds since 1970, like the prototype's.
 */
public record VersionDto(int number, String source, String summary, long at, JsonNode resume) {
}
