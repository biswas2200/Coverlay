package com.resumeanalyser.account.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.resumeanalyser.account.UserRole;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.UUID;

/**
 * Public-facing view of a {@link com.resumeanalyser.account.User}, used in API
 * responses (e.g. as part of {@link com.resumeanalyser.auth.dto.AuthResponse}).
 * Deliberately excludes the password hash — that field must never leave the server.
 *
 * @param id        the account's database identifier
 * @param email     the account's login email
 * @param role      the account's access level (USER / ADMIN)
 * @param createdAt when the account was created
 * @param adminPath where the admin API lives, told only to an administrator about
 *                  their own account (sign-in and {@code GET /auth/me}); absent from
 *                  the JSON for everyone else
 */
public record UserDto(
        UUID id,

        @NotBlank
        @Email
        @Size(max = 320)
        String email,

        UserRole role,

        Instant createdAt,

        @JsonInclude(JsonInclude.Include.NON_NULL)
        String adminPath
) {

    /** An account as anyone but its own administrator session sees it: no admin path. */
    public UserDto(UUID id, String email, UserRole role, Instant createdAt) {
        this(id, email, role, createdAt, null);
    }
}
