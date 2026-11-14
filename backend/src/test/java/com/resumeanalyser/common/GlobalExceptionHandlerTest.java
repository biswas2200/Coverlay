package com.resumeanalyser.common;

import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.web.servlet.MultipartProperties;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.util.unit.DataSize;
import org.springframework.web.multipart.MaxUploadSizeExceededException;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit tests for the parts of {@link GlobalExceptionHandler} that need no web layer: what a file over the multipart
 * limit is answered with, what a request that is too large is answered with, and what two writes that raced are
 * answered with. Where the handler sits in a running request is covered by {@code ResumeControllerUploadTest}; the real
 * upload limit by {@code ResumeUploadLimitTest}.
 */
class GlobalExceptionHandlerTest {

    private final GlobalExceptionHandler handler = handlerWithLimit(DataSize.ofMegabytes(5));

    @Test
    void anUploadOverTheLimitIsAnswered413() {
        ResponseEntity<ApiError> response = handlerWithLimit(DataSize.ofMegabytes(5))
                .handleMaxUploadSize(new MaxUploadSizeExceededException(DataSize.ofMegabytes(5).toBytes()));

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.PAYLOAD_TOO_LARGE);
        assertThat(response.getBody().status()).isEqualTo(413);
        assertThat(response.getBody().message()).isEqualTo("A resume can be at most 5 MB.");
        assertThat(response.getBody().traceId()).isNull();
    }

    @Test
    void theMessageNamesTheConfiguredLimitNotAFixedOne() {
        ResponseEntity<ApiError> response = handlerWithLimit(DataSize.ofMegabytes(2))
                .handleMaxUploadSize(new MaxUploadSizeExceededException(-1));

        assertThat(response.getBody().message()).isEqualTo("A resume can be at most 2 MB.");
    }

    @Test
    void aLimitThatIsNotWholeMegabytesIsShownInKilobytes() {
        ResponseEntity<ApiError> response = handlerWithLimit(DataSize.ofKilobytes(512))
                .handleMaxUploadSize(new MaxUploadSizeExceededException(-1));

        assertThat(response.getBody().message()).isEqualTo("A resume can be at most 512 KB.");
    }

    @Test
    void theExceptionsOwnTextNeverReachesTheClient() {
        // The container's message names the field and a byte count; none of that is for the user.
        ResponseEntity<ApiError> response = handlerWithLimit(DataSize.ofMegabytes(5)).handleMaxUploadSize(
                new MaxUploadSizeExceededException(-1,
                        new IllegalStateException("The field file exceeds its maximum permitted size of 5242880 bytes.")));

        assertThat(response.getBody().message()).doesNotContain("field").doesNotContain("5242880");
    }

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

    private static GlobalExceptionHandler handlerWithLimit(DataSize maxFileSize) {
        MultipartProperties multipart = new MultipartProperties();
        multipart.setMaxFileSize(maxFileSize);
        return new GlobalExceptionHandler(multipart);
    }
}
