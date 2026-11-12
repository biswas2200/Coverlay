package com.resumeanalyser.admin;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.resumeanalyser.common.ApiError;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.AnonymousAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;
import java.io.IOException;

/**
 * Stands in front of the admin API (everything under the secret base path,
 * see {@link AdminPathEnvironmentPostProcessor}) and does two things.
 * <p>
 * <b>Hides it.</b> A signed-in account that is not an administrator gets the
 * same 404 an address that does not exist gets, so even a correct guess of
 * the path tells the caller nothing. (A caller with no session gets the same
 * 401 every address gives; that is left to the rest of the chain.)
 * <p>
 * <b>Keeps a record.</b> Every admin call, and every refused one, is written
 * to the {@code admin.audit} log: who, what, the result and from where. The
 * secret path and the query string (which can carry an email) are left out.
 * <p>
 * This is not the access check itself: the URL rule in {@code SecurityConfig}
 * and {@code @PreAuthorize} on each endpoint still decide that.
 */
public class AdminGateFilter extends OncePerRequestFilter {

    private static final Logger audit = LoggerFactory.getLogger("admin.audit");
    private static final String ADMIN_AUTHORITY = "ROLE_ADMIN";

    private final String basePath;
    private final ObjectMapper objectMapper;

    public AdminGateFilter(String basePath, ObjectMapper objectMapper) {
        this.basePath = basePath;
        this.objectMapper = objectMapper;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String path = request.getRequestURI().substring(request.getContextPath().length());
        if (!path.equals(basePath) && !path.startsWith(basePath + "/")) {
            chain.doFilter(request, response);
            return;
        }

        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        boolean signedIn = authentication != null && authentication.isAuthenticated()
                && !(authentication instanceof AnonymousAuthenticationToken);
        if (!signedIn) {
            // No session: the chain answers 401, as it does for every other address.
            chain.doFilter(request, response);
            return;
        }

        String action = request.getMethod() + " " + sanitised(path.substring(basePath.length()));
        boolean admin = authentication.getAuthorities().stream()
                .anyMatch(authority -> ADMIN_AUTHORITY.equals(authority.getAuthority()));
        if (!admin) {
            audit.warn("refused account={} action=\"{}\" ip={}", authentication.getName(), action, request.getRemoteAddr());
            response.setStatus(HttpStatus.NOT_FOUND.value());
            response.setContentType(MediaType.APPLICATION_JSON_VALUE);
            objectMapper.writeValue(response.getWriter(), ApiError.notFound());
            return;
        }

        try {
            chain.doFilter(request, response);
        } finally {
            audit.info("admin={} action=\"{}\" status={} ip={}",
                    authentication.getName(), action, response.getStatus(), request.getRemoteAddr());
        }
    }

    /** A request path is the caller's text: keep it on one log line and a sensible length. */
    private static String sanitised(String path) {
        String clean = path.replaceAll("[^A-Za-z0-9/_.~-]", "?");
        return clean.length() > 200 ? clean.substring(0, 200) : clean;
    }
}
