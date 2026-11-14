package com.resumeanalyser.common;

/**
 * What was sent is bigger than the limit for it, such as a resume over 200 KB. It is refused, never truncated. Answered with
 * 413 Payload Too Large by {@link GlobalExceptionHandler}.
 */
public class PayloadTooLargeException extends RuntimeException {

    /** @param message safe to show the user */
    public PayloadTooLargeException(String message) {
        super(message);
    }
}
