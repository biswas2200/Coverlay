package com.resumeanalyser.resume;

import com.resumeanalyser.account.UserRepository;
import com.resumeanalyser.auth.JwtAuthenticationFilter;
import com.resumeanalyser.resume.mapper.ParsedProfileMapper;
import com.resumeanalyser.resume.mapper.ResumeMapper;
import jakarta.servlet.http.HttpServletRequest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.ComponentScan;
import org.springframework.context.annotation.FilterType;
import org.springframework.http.MediaType;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.multipart.MultipartHttpServletRequest;
import org.springframework.web.multipart.MultipartResolver;

import static org.mockito.Mockito.verifyNoInteractions;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Web-layer test for what {@code POST /resumes} answers when the servlet container refuses a file for being over the
 * multipart limit ({@code spring.servlet.multipart.max-file-size}, 5 MB: FR-1.1 / FR-1.3).
 *
 * <p>MockMvc never enforces that limit itself, so a stand-in {@link MultipartResolver} throws what the real one throws,
 * at the point where the real one throws it: while the request is being resolved, before any controller is chosen. That
 * point matters. A controller advice that is scoped to a package, such as {@code ResumeExceptionHandler}, does not apply
 * there, so only the app-wide {@code GlobalExceptionHandler} can answer, and a test that threw from the service instead
 * would not notice if the handler sat in the wrong place. That the limit really is 5 MB, and that a 4 MB file gets
 * through it, is checked against a real servlet container in {@link ResumeUploadLimitTest}.
 */
@WebMvcTest(
        controllers = ResumeController.class,
        excludeFilters = @ComponentScan.Filter(type = FilterType.ASSIGNABLE_TYPE, classes = JwtAuthenticationFilter.class)
)
class ResumeControllerUploadTest {

    /** Refuses every multipart request the way the container refuses a file over the limit. */
    @TestConfiguration
    static class OversizeMultipartResolver {

        @Bean
        MultipartResolver multipartResolver() {
            return new MultipartResolver() {
                @Override
                public boolean isMultipart(HttpServletRequest request) {
                    return request.getContentType() != null && request.getContentType().startsWith("multipart/");
                }

                @Override
                public MultipartHttpServletRequest resolveMultipart(HttpServletRequest request) {
                    throw new MaxUploadSizeExceededException(-1);
                }

                @Override
                public void cleanupMultipart(MultipartHttpServletRequest request) {
                    // nothing was resolved
                }
            };
        }
    }

    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private ResumeService resumeService;
    @MockBean
    private UserRepository userRepository;
    @MockBean
    private ResumeMapper resumeMapper;
    @MockBean
    private ParsedProfileMapper parsedProfileMapper;

    @Test
    @WithMockUser(username = "user@example.com", roles = "USER")
    void upload_overTheLimit_isAnswered413WithAReadableMessageNotA500() throws Exception {
        mockMvc.perform(post("/resumes").with(csrf())
                        .contentType("multipart/form-data; boundary=resume-boundary")
                        .content("--resume-boundary--\r\n"))
                .andExpect(status().isPayloadTooLarge())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
                .andExpect(jsonPath("$.status").value(413))
                .andExpect(jsonPath("$.message").value("A resume can be at most 5 MB."))
                .andExpect(jsonPath("$.traceId").doesNotExist());

        // Refused before the file reached the service: nothing stored, no ML call.
        verifyNoInteractions(resumeService);
    }
}
