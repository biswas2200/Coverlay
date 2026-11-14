package com.resumeanalyser.admin;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.env.EnvironmentPostProcessor;
import org.springframework.core.Ordered;
import org.springframework.core.env.ConfigurableEnvironment;
import org.springframework.core.env.MapPropertySource;
import java.security.SecureRandom;
import java.util.HexFormat;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Decides where the admin API lives. It is never at {@code /admin}: every
 * admin endpoint is mapped under {@code ${app.admin.base-path}}, one secret
 * path segment that is not in the code, the API docs or the frontend bundle.
 * <ul>
 *   <li>{@code APP_ADMIN_PATH} set: that value is used (and checked: long,
 *       random-looking, no "admin" in it), so it stays the same across
 *       restarts and across instances. Production sets it.</li>
 *   <li>Not set: a fresh random one is made on every start. Nothing needs to
 *       know it ahead of time, because an administrator's client is told the
 *       path when it signs in ({@code GET /auth/me}).</li>
 * </ul>
 * The path is one layer only. Knowing it gives nothing without an ADMIN
 * account: see {@link AdminGateFilter} and each controller's {@code @PreAuthorize}.
 */
public class AdminPathEnvironmentPostProcessor implements EnvironmentPostProcessor, Ordered {

    /** What the operator sets ({@code APP_ADMIN_PATH}): the secret segment, without a slash. */
    static final String KEY_PROPERTY = "app.admin.path";

    /** What the code reads: {@code "/" + segment}. */
    public static final String BASE_PATH_PROPERTY = "app.admin.base-path";

    private static final Pattern ALLOWED = Pattern.compile("[A-Za-z0-9_-]{24,64}");
    private static final int MIN_DISTINCT_CHARACTERS = 10;

    @Override
    public void postProcessEnvironment(ConfigurableEnvironment environment, SpringApplication application) {
        String configured = environment.getProperty(KEY_PROPERTY, "").trim();
        String key = configured.isEmpty() ? randomKey() : validated(configured);
        environment.getPropertySources().addFirst(
                new MapPropertySource("adminBasePath", Map.of(BASE_PATH_PROPERTY, "/" + key)));
    }

    /** After the configuration files are loaded, so {@code application.yml} and the environment are both visible. */
    @Override
    public int getOrder() {
        return Ordered.LOWEST_PRECEDENCE;
    }

    static String randomKey() {
        byte[] bytes = new byte[24];
        new SecureRandom().nextBytes(bytes);
        return HexFormat.of().formatHex(bytes);
    }

    /**
     * Refuses to start with a path that could be guessed, rather than running
     * with a weak one.
     */
    static String validated(String key) {
        String problem = null;
        if (!ALLOWED.matcher(key).matches()) {
            problem = "it must be 24 to 64 characters, only letters, digits, '-' and '_' (no '/')";
        } else if (key.toLowerCase(Locale.ROOT).contains("admin")) {
            problem = "it must not contain the word 'admin'";
        } else if (key.chars().distinct().count() < MIN_DISTINCT_CHARACTERS) {
            problem = "it repeats too few characters to be random";
        }
        if (problem != null) {
            // The value itself is not put in the message: this ends up in logs.
            throw new IllegalStateException("APP_ADMIN_PATH is not safe to use: " + problem
                    + ". Make one with: openssl rand -hex 24");
        }
        return key;
    }
}
