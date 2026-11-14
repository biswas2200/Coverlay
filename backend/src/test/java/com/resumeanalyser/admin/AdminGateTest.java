package com.resumeanalyser.admin;

import com.resumeanalyser.account.UserRepository;
import com.resumeanalyser.account.UserRole;
import com.resumeanalyser.account.dto.UserDto;
import com.resumeanalyser.auth.JwtService;
import com.resumeanalyser.auth.SecurityConfig;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.web.servlet.MockMvc;

import java.time.Instant;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * The admin API behind the real {@link SecurityConfig} chain: it is not at
 * {@code /admin}, a caller who is not an administrator cannot tell the real
 * path from one that does not exist, and an administrator gets through.
 */
@WebMvcTest(controllers = AdminController.class, properties = {
        "app.cors.allowed-origins=http://localhost:4200",
        "app.admin.path=k3Zq8vT1xY7mB4nW9cR2dF6h"
})
@Import(SecurityConfig.class)
class AdminGateTest {

    private static final String SECRET = "/k3Zq8vT1xY7mB4nW9cR2dF6h";

    @Autowired
    private MockMvc mockMvc;

    @Value("${app.admin.base-path}")
    private String admin;

    @MockBean
    private AdminService adminService;

    @MockBean
    private JwtService jwtService;

    @MockBean
    private UserDetailsService userDetailsService;

    @MockBean
    private UserRepository userRepository;

    @Test
    void theConfiguredPathIsTheOneInUse() {
        assertThat(admin).isEqualTo(SECRET);
    }

    @Test
    void withNoSession_theAdminPathAnswersLikeEveryOtherAddress() throws Exception {
        mockMvc.perform(get(SECRET + "/users").param("email", "a@b.c")).andExpect(status().isUnauthorized());
        mockMvc.perform(get("/admin/users").param("email", "a@b.c")).andExpect(status().isUnauthorized());
        mockMvc.perform(get("/no-such-address")).andExpect(status().isUnauthorized());
        verifyNoInteractions(adminService);
    }

    @Test
    @WithMockUser(roles = "USER")
    void aSignedInUser_cannotTellTheAdminPathFromAnAddressThatDoesNotExist() throws Exception {
        String real = mockMvc.perform(get(SECRET + "/users").param("email", "a@b.c"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.message").value("Not found"))
                .andReturn().getResponse().getContentAsString();
        String missing = mockMvc.perform(get("/no-such-address"))
                .andExpect(status().isNotFound())
                .andReturn().getResponse().getContentAsString();

        assertThat(withoutTimestamp(real)).isEqualTo(withoutTimestamp(missing));
        verifyNoInteractions(adminService);
    }

    @Test
    @WithMockUser(roles = "USER")
    void aSignedInUser_getsNotFoundForEveryAdminAddress() throws Exception {
        mockMvc.perform(get(SECRET)).andExpect(status().isNotFound());
        mockMvc.perform(get(SECRET + "/jobs/status")).andExpect(status().isNotFound());
        mockMvc.perform(get(SECRET + "/anything/at/all")).andExpect(status().isNotFound());
    }

    @Test
    @WithMockUser(roles = "ADMIN")
    void theOldAdminAddress_isGone_evenForAnAdministrator() throws Exception {
        mockMvc.perform(get("/admin/users").param("email", "a@b.c")).andExpect(status().isNotFound());
        verifyNoInteractions(adminService);
    }

    @Test
    @WithMockUser(roles = "ADMIN")
    void anAdministrator_getsThrough() throws Exception {
        when(adminService.findByEmail(anyString()))
                .thenReturn(new UserDto(UUID.randomUUID(), "a@b.c", UserRole.USER, Instant.now()));

        mockMvc.perform(get(SECRET + "/users").param("email", "a@b.c"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.email").value("a@b.c"))
                // Another account's record never carries the admin path.
                .andExpect(jsonPath("$.adminPath").doesNotExist());
    }

    private static String withoutTimestamp(String json) {
        return json.replaceAll("\"timestamp\":\"[^\"]*\"", "");
    }
}
