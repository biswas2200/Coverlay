package com.resumeanalyser.common;

import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;

import static org.assertj.core.api.Assertions.assertThat;

/** What the app-wide handler answers for the exceptions it owns. */
class GlobalExceptionHandlerTest {

    private final GlobalExceptionHandler handler = new GlobalExceptionHandler();

    @Test
    void aRequestThatIsTooLarge_isAnswered413_withTheReasonAndNeverTruncated() {
        ResponseEntity<ApiError> response = handler.handlePayloadTooLarge(new PayloadTooLargeException("A resume can be at most 200 KB."));

        assertThat(response.getStatusCode().value()).isEqualTo(413);
        assertThat(response.getBody()).isNotNull();
        assertThat(response.getBody().status()).isEqualTo(413);
        assertThat(response.getBody().message()).isEqualTo("A resume can be at most 200 KB.");
        assertThat(response.getBody().traceId()).as("an expected failure has no trace id").isNull();
    }

    @Test
    void twoWritesThatRaced_theLoserIsAnswered409_withoutLeakingTheEntity() {
        // JPA's optimistic lock surfaces at commit, after the service method returned: RB-VER-07 still says conflict.
        var raced = new org.springframework.orm.ObjectOptimisticLockingFailureException(
                "com.resumeanalyser.builder.ResumeDocument", java.util.UUID.randomUUID());

        ResponseEntity<ApiError> response = handler.handleOptimisticLock(raced);

        assertThat(response.getStatusCode().value()).isEqualTo(409);
        assertThat(response.getBody()).isNotNull();
        assertThat(response.getBody().status()).isEqualTo(409);
        assertThat(response.getBody().message()).contains("changed").contains("try again");
        assertThat(response.getBody().message()).doesNotContain("ResumeDocument").doesNotContain("resumeanalyser");
        assertThat(response.getBody().traceId()).isNull();
    }
}
