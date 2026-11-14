package com.resumeanalyser.auth;

import com.resumeanalyser.account.UserRepository;
import com.resumeanalyser.job.WatchlistController;
import com.resumeanalyser.job.WatchlistService;
import io.jsonwebtoken.MalformedJwtException;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.test.web.servlet.MockMvc;

import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * The real {@link SecurityConfig} chain, with the real {@link JwtAuthenticationFilter}
 * on mocked token parsing: no valid token is 401 (the frontend then signs the user
 * out and back in). What the admin API answers is in {@code AdminGateTest}.
 * {@link WatchlistController} just stands in for any authenticated endpoint.
 */
@WebMvcTest(controllers = WatchlistController.class, properties = "app.cors.allowed-origins=http://localhost:4200")
@Import(SecurityConfig.class)
class SecurityConfigTest {

    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private JwtService jwtService;

    @MockBean
    private UserDetailsService userDetailsService;

    @MockBean
    private WatchlistService watchlistService;

    @MockBean
    private UserRepository userRepository;

    @Test
    void noToken_isUnauthorized() throws Exception {
        mockMvc.perform(get("/watchlist")).andExpect(status().isUnauthorized());
    }

    @Test
    void anExpiredOrForgedToken_isUnauthorized() throws Exception {
        when(jwtService.extractEmail(anyString())).thenThrow(new MalformedJwtException("bad token"));

        mockMvc.perform(get("/watchlist").header("Authorization", "Bearer not-a-real-token"))
                .andExpect(status().isUnauthorized());
    }
}
