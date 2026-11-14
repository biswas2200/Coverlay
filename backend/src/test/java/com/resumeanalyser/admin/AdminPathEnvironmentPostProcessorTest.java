package com.resumeanalyser.admin;

import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** The admin path is the operator's when it is strong, random when unset, and never a weak one. */
class AdminPathEnvironmentPostProcessorTest {

    private final AdminPathEnvironmentPostProcessor processor = new AdminPathEnvironmentPostProcessor();

    private String basePathFor(String configured) {
        MockEnvironment environment = new MockEnvironment();
        if (configured != null) {
            environment.setProperty("app.admin.path", configured);
        }
        processor.postProcessEnvironment(environment, null);
        return environment.getProperty(AdminPathEnvironmentPostProcessor.BASE_PATH_PROPERTY);
    }

    @Test
    void aStrongConfiguredPath_isUsedAsItIs() {
        assertThat(basePathFor("k3Zq8vT1xY7mB4nW9cR2dF6h")).isEqualTo("/k3Zq8vT1xY7mB4nW9cR2dF6h");
    }

    @Test
    void withNothingConfigured_aNewRandomPathIsMadeEachStart() {
        String first = basePathFor(null);
        String second = basePathFor("  ");

        assertThat(first).matches("/[0-9a-f]{48}");
        assertThat(second).matches("/[0-9a-f]{48}").isNotEqualTo(first);
    }

    @Test
    void aGuessablePath_stopsTheAppFromStarting() {
        for (String weak : new String[] {
                "admin",                              // the obvious one
                "short-path",                         // too short
                "my-secret-admin-console-path-2026",  // names itself
                "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",   // not random
                "has/a/slash/in/it/0123456789abcdef", // more than one segment
        }) {
            assertThatThrownBy(() -> basePathFor(weak))
                    .as(weak)
                    .isInstanceOf(IllegalStateException.class)
                    .hasMessageContaining("APP_ADMIN_PATH")
                    .hasMessageNotContaining(weak);
        }
    }
}
