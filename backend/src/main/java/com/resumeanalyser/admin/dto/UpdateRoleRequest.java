package com.resumeanalyser.admin.dto;

import com.resumeanalyser.account.UserRole;
import jakarta.validation.constraints.NotNull;

/**
 * Body of the admin API's {@code PATCH .../users/{id}/role}: the access level to give the
 * account (USER / ADMIN).
 */
public record UpdateRoleRequest(@NotNull UserRole role) {}
