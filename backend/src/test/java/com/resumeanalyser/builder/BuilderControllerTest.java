package com.resumeanalyser.builder;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.resumeanalyser.account.User;
import com.resumeanalyser.account.UserRepository;
import com.resumeanalyser.auth.JwtAuthenticationFilter;
import com.resumeanalyser.builder.dto.DocumentDto;
import com.resumeanalyser.builder.dto.DocumentSummaryDto;
import com.resumeanalyser.builder.dto.VersionDto;
import com.resumeanalyser.common.BadRequestException;
import com.resumeanalyser.common.ConflictException;
import com.resumeanalyser.common.PayloadTooLargeException;
import com.resumeanalyser.common.ResourceNotFoundException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.ComponentScan;
import org.springframework.context.annotation.FilterType;
import org.springframework.http.MediaType;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Web-layer tests for {@link BuilderController} (docs/prototype-spec.md section 9.1): every call needs a signed-in person and
 * acts on that person's own documents, and every failure the service names has its status. The JWT filter is excluded as in
 * {@code WatchlistControllerTest}; the signed-in person comes from {@code @WithMockUser}.
 */
@WebMvcTest(
        controllers = BuilderController.class,
        excludeFilters = @ComponentScan.Filter(type = FilterType.ASSIGNABLE_TYPE, classes = JwtAuthenticationFilter.class)
)
class BuilderControllerTest {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final UUID ID = UUID.fromString("3f2b8a52-6d4e-4e0b-9a43-0c1b2d3e4f50");

    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private BuilderDocumentService service;

    @MockBean
    private UserRepository userRepository;

    private final User asha = new User();

    @BeforeEach
    void signedInAsAsha() {
        when(userRepository.findByEmail("asha@example.com")).thenReturn(Optional.of(asha));
    }

    private static JsonNode json(String text) {
        try {
            return JSON.readTree(text);
        } catch (Exception e) {
            throw new IllegalArgumentException(text, e);
        }
    }

    private static VersionDto version(int number, String source, String summary) {
        return new VersionDto(number, source, summary, 1_793_990_000_000L, json("{\"name\":\"Jane Doe\"}"));
    }

    private static DocumentDto document() {
        return new DocumentDto(ID, "Backend Developer", new BuilderAnswers("Backend Developer", "senior", "modern", 2), "compact",
                FormatNormalizer.normalize(null), List.of(version(1, "template", "Started from template Compact")), 1);
    }

    private static MockHttpServletRequestBuilder body(MockHttpServletRequestBuilder request, String content) {
        return request.with(csrf()).contentType(MediaType.APPLICATION_JSON).content(content);
    }

    // ---------- sign-in ----------

    @Test
    void everyCall_needsASignedInPerson() throws Exception {
        List<MockHttpServletRequestBuilder> calls = List.of(
                post("/builder/documents").contentType(MediaType.APPLICATION_JSON).content("{}"),
                get("/builder/documents"),
                get("/builder/documents/{id}", ID),
                put("/builder/documents/{id}/format", ID).contentType(MediaType.APPLICATION_JSON).content("{}"),
                put("/builder/documents/{id}/template", ID).contentType(MediaType.APPLICATION_JSON).content("{}"),
                post("/builder/documents/{id}/versions", ID).contentType(MediaType.APPLICATION_JSON).content("{}"),
                post("/builder/documents/{id}/versions/{n}/restore", ID, 1),
                get("/builder/documents/{id}/reading-order", ID),
                delete("/builder/documents/{id}", ID));

        for (MockHttpServletRequestBuilder call : calls) {
            mockMvc.perform(call.with(csrf())).andExpect(status().isUnauthorized());
        }
        verifyNoInteractions(service);
    }

    // ---------- start, read, list ----------

    @Test
    @WithMockUser(username = "asha@example.com")
    void start_createsTheDocumentForTheSignedInPerson_andAnswers201() throws Exception {
        when(service.create(eq(asha), any(), eq("compact"))).thenReturn(document());

        mockMvc.perform(body(post("/builder/documents"), "{\"answers\":{\"role\":\"Backend Developer\",\"level\":\"senior\"},\"templateId\":\"compact\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.id").value(ID.toString()))
                .andExpect(jsonPath("$.templateId").value("compact"))
                .andExpect(jsonPath("$.current").value(1))
                .andExpect(jsonPath("$.versions[0].number").value(1))
                .andExpect(jsonPath("$.versions[0].source").value("template"))
                .andExpect(jsonPath("$.versions[0].at").value(1_793_990_000_000L))
                .andExpect(jsonPath("$.versions[0].resume.name").value("Jane Doe"))
                .andExpect(jsonPath("$.answers.pages").value(2))
                .andExpect(jsonPath("$.format.fontSize").value(11.0));

        ArgumentCaptor<JsonNode> answers = ArgumentCaptor.forClass(JsonNode.class);
        verify(service).create(eq(asha), answers.capture(), eq("compact"));
        assertThat(answers.getValue()).isEqualTo(json("{\"role\":\"Backend Developer\",\"level\":\"senior\"}"));
    }

    @Test
    @WithMockUser(username = "asha@example.com")
    void start_fromAnUpload_isNotAvailableYet_andSaysSo() throws Exception {
        mockMvc.perform(body(post("/builder/documents"), "{\"answers\":{},\"templateId\":\"clean\",\"fromUploadId\":\"" + UUID.randomUUID() + "\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("upload")));

        verifyNoInteractions(service);
    }

    @Test
    @WithMockUser(username = "asha@example.com")
    void start_withAnUnknownTemplate_is400WithTheReason() throws Exception {
        when(service.create(eq(asha), any(), eq("fancy"))).thenThrow(new BadRequestException("There is no template 'fancy'."));

        mockMvc.perform(body(post("/builder/documents"), "{\"answers\":{},\"templateId\":\"fancy\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value("There is no template 'fancy'."));
    }

    @Test
    @WithMockUser(username = "asha@example.com")
    void aBodyThatIsNotJson_is400() throws Exception {
        mockMvc.perform(body(post("/builder/documents"), "{not json")).andExpect(status().isBadRequest());

        verifyNoInteractions(service);
    }

    @Test
    @WithMockUser(username = "asha@example.com")
    void read_returnsTheDocument() throws Exception {
        when(service.get(asha, ID)).thenReturn(document());

        mockMvc.perform(get("/builder/documents/{id}", ID))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(ID.toString()))
                .andExpect(jsonPath("$.title").value("Backend Developer"));
    }

    @Test
    @WithMockUser(username = "asha@example.com")
    void read_ofADocumentThatIsNotTheirs_is404() throws Exception {
        when(service.get(asha, ID)).thenThrow(new ResourceNotFoundException("Resume document not found"));

        mockMvc.perform(get("/builder/documents/{id}", ID))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.message").value("Resume document not found"));
    }

    @Test
    @WithMockUser(username = "asha@example.com")
    void aMalformedId_is400() throws Exception {
        mockMvc.perform(get("/builder/documents/{id}", "not-a-uuid")).andExpect(status().isBadRequest());

        verifyNoInteractions(service);
    }

    @Test
    @WithMockUser(username = "asha@example.com")
    void list_returnsTheirDocuments() throws Exception {
        when(service.list(asha)).thenReturn(List.of(new DocumentSummaryDto(ID, "Backend Developer", "compact", 3, 1_793_990_000_000L)));

        mockMvc.perform(get("/builder/documents"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].id").value(ID.toString()))
                .andExpect(jsonPath("$[0].title").value("Backend Developer"))
                .andExpect(jsonPath("$[0].current").value(3))
                .andExpect(jsonPath("$[0].updatedAt").value(1_793_990_000_000L))
                .andExpect(jsonPath("$[0].versions").doesNotExist());
    }

    // ---------- format and template ----------

    @Test
    @WithMockUser(username = "asha@example.com")
    void format_returnsTheNormalisedFormat() throws Exception {
        when(service.setFormat(eq(asha), eq(ID), any())).thenReturn(FormatNormalizer.normalize(json("{\"fontSize\":12,\"font\":\"serif\"}")));

        mockMvc.perform(body(put("/builder/documents/{id}/format", ID), "{\"format\":{\"fontSize\":12,\"font\":\"serif\"}}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.fontSize").value(12.0))
                .andExpect(jsonPath("$.font").value("serif"))
                .andExpect(jsonPath("$.hidden").isArray());

        ArgumentCaptor<JsonNode> format = ArgumentCaptor.forClass(JsonNode.class);
        verify(service).setFormat(eq(asha), eq(ID), format.capture());
        assertThat(format.getValue()).isEqualTo(json("{\"fontSize\":12,\"font\":\"serif\"}"));
    }

    @Test
    @WithMockUser(username = "asha@example.com")
    void template_returnsTheDocumentWithTheNewVersion() throws Exception {
        when(service.setTemplate(asha, ID, "sidebar")).thenReturn(document());

        mockMvc.perform(body(put("/builder/documents/{id}/template", ID), "{\"templateId\":\"sidebar\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(ID.toString()));
    }

    // ---------- versions ----------

    @Test
    @WithMockUser(username = "asha@example.com")
    void writeVersion_passesExactlyWhatWasSent_andAnswers201() throws Exception {
        when(service.writeVersion(eq(asha), eq(ID), eq(1), any(), eq("you"), eq("You edited Summary")))
                .thenReturn(version(2, "you", "You edited Summary"));

        mockMvc.perform(body(post("/builder/documents/{id}/versions", ID),
                        "{\"baseVersion\":1,\"resume\":{\"name\":\"Jane\"},\"source\":\"you\",\"summary\":\"You edited Summary\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.number").value(2))
                .andExpect(jsonPath("$.summary").value("You edited Summary"));
    }

    @Test
    @WithMockUser(username = "asha@example.com")
    void writeVersion_ignoresATimeTheClientSends() throws Exception {
        when(service.writeVersion(any(), any(), any(), any(), any(), any())).thenReturn(version(2, "you", "x"));

        mockMvc.perform(body(post("/builder/documents/{id}/versions", ID),
                        "{\"baseVersion\":1,\"resume\":{},\"source\":\"you\",\"summary\":\"x\",\"at\":1,\"number\":99,\"id\":\"x\"}"))
                .andExpect(status().isCreated());

        // The service has no parameter for a time or a number, so the server's clock and counter are the only source (BE-03).
        verify(service).writeVersion(eq(asha), eq(ID), eq(1), any(), eq("you"), eq("x"));
    }

    @Test
    @WithMockUser(username = "asha@example.com")
    void writeVersion_withNoBaseVersion_isPassedOnAsNull_forTheServiceToRefuse() throws Exception {
        when(service.writeVersion(eq(asha), eq(ID), isNull(), any(), any(), any()))
                .thenThrow(new BadRequestException("baseVersion is required"));

        mockMvc.perform(body(post("/builder/documents/{id}/versions", ID), "{\"resume\":{},\"source\":\"you\",\"summary\":\"x\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value("baseVersion is required"));
    }

    @Test
    @WithMockUser(username = "asha@example.com")
    void writeVersion_basedOnAnOldVersion_is409() throws Exception {
        when(service.writeVersion(any(), any(), any(), any(), any(), any()))
                .thenThrow(new ConflictException("This resume has moved on: your change is based on version 1 but the current version is 2."));

        mockMvc.perform(body(post("/builder/documents/{id}/versions", ID), "{\"baseVersion\":1,\"resume\":{},\"source\":\"you\",\"summary\":\"x\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.status").value(409))
                .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("moved on")));
    }

    @Test
    @WithMockUser(username = "asha@example.com")
    void writeVersion_ofAResumeThatIsTooLarge_is413() throws Exception {
        when(service.writeVersion(any(), any(), any(), any(), any(), any()))
                .thenThrow(new PayloadTooLargeException("A resume can be at most 200 KB."));

        mockMvc.perform(body(post("/builder/documents/{id}/versions", ID), "{\"baseVersion\":1,\"resume\":{},\"source\":\"you\",\"summary\":\"x\"}"))
                .andExpect(status().isPayloadTooLarge())
                .andExpect(jsonPath("$.message").value("A resume can be at most 200 KB."));
    }

    @Test
    @WithMockUser(username = "asha@example.com")
    void restore_answersWithTheNewVersion() throws Exception {
        when(service.restore(asha, ID, 1)).thenReturn(version(3, "restore", "Restored v1"));

        mockMvc.perform(post("/builder/documents/{id}/versions/{n}/restore", ID, 1).with(csrf()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.number").value(3))
                .andExpect(jsonPath("$.source").value("restore"))
                .andExpect(jsonPath("$.summary").value("Restored v1"));
    }

    @Test
    @WithMockUser(username = "asha@example.com")
    void restore_ofAVersionThatIsGone_is404() throws Exception {
        when(service.restore(asha, ID, 99)).thenThrow(new ResourceNotFoundException("Version not found"));

        mockMvc.perform(post("/builder/documents/{id}/versions/{n}/restore", ID, 99).with(csrf()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.message").value("Version not found"));
    }

    @Test
    @WithMockUser(username = "asha@example.com")
    void restore_withAVersionThatIsNotANumber_is400() throws Exception {
        mockMvc.perform(post("/builder/documents/{id}/versions/{n}/restore", ID, "latest").with(csrf())).andExpect(status().isBadRequest());

        verify(service, never()).restore(any(), any(), anyInt());
    }

    // ---------- reading order ----------

    @Test
    @WithMockUser(username = "asha@example.com")
    void readingOrder_ofTheCurrentVersion_returnsTheTextAndTheNotes() throws Exception {
        when(service.readingOrder(asha, ID, null))
                .thenReturn(new ReadingOrder("Jane Doe\njane@email.com\n\nSUMMARY\nBackend developer", List.of("One column and no tables: the safest layout for applicant tracking systems.")));

        mockMvc.perform(get("/builder/documents/{id}/reading-order", ID))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.text").value("Jane Doe\njane@email.com\n\nSUMMARY\nBackend developer"))
                .andExpect(jsonPath("$.notes[0]").value("One column and no tables: the safest layout for applicant tracking systems."))
                .andExpect(jsonPath("$.notes.length()").value(1));
    }

    @Test
    @WithMockUser(username = "asha@example.com")
    void readingOrder_ofAnotherVersion_passesTheNumber() throws Exception {
        when(service.readingOrder(asha, ID, 2)).thenReturn(new ReadingOrder("x", List.of("n")));

        mockMvc.perform(get("/builder/documents/{id}/reading-order", ID).param("version", "2"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.text").value("x"));

        verify(service).readingOrder(asha, ID, 2);
    }

    @Test
    @WithMockUser(username = "asha@example.com")
    void readingOrder_withAVersionThatIsNotANumber_is400() throws Exception {
        mockMvc.perform(get("/builder/documents/{id}/reading-order", ID).param("version", "latest"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("version")));

        verifyNoInteractions(service);
    }

    @Test
    @WithMockUser(username = "asha@example.com")
    void readingOrder_ofAVersionOrDocumentThatIsNotThere_is404() throws Exception {
        when(service.readingOrder(asha, ID, 99)).thenThrow(new ResourceNotFoundException("Version not found"));

        mockMvc.perform(get("/builder/documents/{id}/reading-order", ID).param("version", "99"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.message").value("Version not found"));
    }

    // ---------- delete ----------

    @Test
    @WithMockUser(username = "asha@example.com")
    void delete_answers204() throws Exception {
        mockMvc.perform(delete("/builder/documents/{id}", ID).with(csrf())).andExpect(status().isNoContent());

        verify(service).delete(asha, ID);
    }

    @Test
    @WithMockUser(username = "asha@example.com")
    void delete_ofADocumentThatIsNotTheirs_is404() throws Exception {
        org.mockito.Mockito.doThrow(new ResourceNotFoundException("Resume document not found")).when(service).delete(asha, ID);

        mockMvc.perform(delete("/builder/documents/{id}", ID).with(csrf())).andExpect(status().isNotFound());
    }
}
