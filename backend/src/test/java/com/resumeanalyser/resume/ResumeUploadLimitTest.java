package com.resumeanalyser.resume;

import com.resumeanalyser.account.User;
import com.resumeanalyser.account.UserRepository;
import com.resumeanalyser.common.GlobalExceptionHandler;
import com.resumeanalyser.resume.dto.ResumeDto;
import com.resumeanalyser.resume.mapper.ParsedProfileMapper;
import com.resumeanalyser.resume.mapper.ResumeMapper;
import jakarta.servlet.Filter;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.ImportAutoConfiguration;
import org.springframework.boot.autoconfigure.http.HttpMessageConvertersAutoConfiguration;
import org.springframework.boot.autoconfigure.jackson.JacksonAutoConfiguration;
import org.springframework.boot.autoconfigure.web.servlet.DispatcherServletAutoConfiguration;
import org.springframework.boot.autoconfigure.web.servlet.MultipartAutoConfiguration;
import org.springframework.boot.autoconfigure.web.servlet.ServletWebServerFactoryAutoConfiguration;
import org.springframework.boot.autoconfigure.web.servlet.WebMvcAutoConfiguration;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.multipart.MultipartFile;

import java.security.Principal;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicLong;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * {@code POST /resumes} against a real servlet container with the real {@code application.yml}, to check the multipart
 * limit itself: "PDF or DOCX, up to 5 MB" (SRS FR-1.1 / FR-1.3). A mocked request cannot check it, because the limit is
 * enforced by Tomcat before Spring sees a file. This is what failed on 14 Nov 2026: with no limit set, Spring's default of
 * 1 MB applied, every resume over 1 MB was refused, and the refusal was answered 500.
 *
 * <p>Only the web layer is started (no database, no object store, no ML service): the resume controller, both exception
 * handlers, and the real multipart setup, with the service and mappers mocked. A filter signs the request in as
 * {@code user@example.com} so the controller has a user, which stands in for the JWT filter.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, classes = ResumeUploadLimitTest.WebLayer.class)
class ResumeUploadLimitTest {

    private static final int MB = 1024 * 1024;

    @Configuration
    @ImportAutoConfiguration({
            ServletWebServerFactoryAutoConfiguration.class,
            DispatcherServletAutoConfiguration.class,
            WebMvcAutoConfiguration.class,
            HttpMessageConvertersAutoConfiguration.class,
            JacksonAutoConfiguration.class,
            MultipartAutoConfiguration.class
    })
    @Import({ResumeController.class, ResumeExceptionHandler.class, GlobalExceptionHandler.class})
    static class WebLayer {

        @Bean
        Filter signedInAsUser() {
            Principal user = new UsernamePasswordAuthenticationToken("user@example.com", null, List.of());
            return (request, response, chain) -> chain.doFilter(new HttpServletRequestWrapper((HttpServletRequest) request) {
                @Override
                public Principal getUserPrincipal() {
                    return user;
                }
            }, response);
        }
    }

    @Autowired
    private TestRestTemplate http;

    @MockBean
    private ResumeService resumeService;
    @MockBean
    private UserRepository userRepository;
    @MockBean
    private ResumeMapper resumeMapper;
    @MockBean
    private ParsedProfileMapper parsedProfileMapper;

    /** How many bytes the file had when the controller got it; -1 until a request reaches the service. */
    private final AtomicLong sizeSeenByService = new AtomicLong(-1);

    @BeforeEach
    void signedInUserCanUpload() {
        User user = new User();
        user.setId(UUID.randomUUID());
        when(userRepository.findByEmail("user@example.com")).thenReturn(Optional.of(user));

        Resume saved = new Resume();
        when(resumeService.upload(any(), any())).thenAnswer(call -> {
            sizeSeenByService.set(((MultipartFile) call.getArgument(1)).getSize());
            return saved;
        });
        when(resumeMapper.toDto(saved)).thenReturn(new ResumeDto(UUID.randomUUID(), user.getId(), "u/1-cv.pdf", 1, null));
    }

    @Test
    void a4MbResumeIsAccepted() {
        ResponseEntity<Map> response = uploadOfSize(4 * MB);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        assertThat(sizeSeenByService.get()).isEqualTo(4L * MB);
    }

    @Test
    void aResumeOfExactlyTheLimitIsAccepted() {
        ResponseEntity<Map> response = uploadOfSize(5 * MB);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        assertThat(sizeSeenByService.get()).isEqualTo(5L * MB);
    }

    @Test
    void aResumeOneByteOverTheLimitIsRefusedWith413() {
        ResponseEntity<Map> response = uploadOfSize(5 * MB + 1);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.PAYLOAD_TOO_LARGE);
        assertThat(response.getBody()).containsEntry("message", "A resume can be at most 5 MB.");
        verify(resumeService, never()).upload(any(), any());
    }

    @Test
    void a6MbResumeIsRefusedWith413AndAReadableMessageNotA500() {
        ResponseEntity<Map> response = uploadOfSize(6 * MB);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.PAYLOAD_TOO_LARGE);
        assertThat(response.getBody())
                .containsEntry("status", 413)
                .containsEntry("message", "A resume can be at most 5 MB.");
        // 500 is the one answer that carries a trace id; an oversize file is the caller's to fix, not a bug.
        assertThat(response.getBody().get("traceId")).isNull();
        verify(resumeService, never()).upload(any(), any());
    }

    private ResponseEntity<Map> uploadOfSize(int bytes) {
        MultiValueMap<String, Object> form = new LinkedMultiValueMap<>();
        HttpHeaders fileHeaders = new HttpHeaders();
        fileHeaders.setContentType(MediaType.APPLICATION_PDF);
        form.add("file", new HttpEntity<>(new NamedBytes(new byte[bytes], "cv.pdf"), fileHeaders));

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.MULTIPART_FORM_DATA);
        return http.postForEntity("/resumes", new HttpEntity<>(form, headers), Map.class);
    }

    /** A byte array that goes out as a file part with a file name, like a browser's file input. */
    private static final class NamedBytes extends ByteArrayResource {
        private final String name;

        NamedBytes(byte[] bytes, String name) {
            super(bytes);
            this.name = name;
        }

        @Override
        public String getFilename() {
            return name;
        }
    }
}
