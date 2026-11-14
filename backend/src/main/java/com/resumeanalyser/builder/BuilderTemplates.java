package com.resumeanalyser.builder;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.resumeanalyser.common.BadRequestException;
import java.util.List;

/**
 * The fixed catalogue of templates and what choosing one does to the format (docs/prototype-spec.md, RB-TPL-02, RB-FMT-05).
 * The numbers are the prototype's {@code TEMPLATES} and {@code chooseTemplate}: a template sets the text size, all four
 * margins and the columns, and brings a typeface only where it has one; leaving Classic goes back to sans.
 */
public final class BuilderTemplates {

    private static final ObjectMapper JSON = new ObjectMapper();

    private static final List<BuilderTemplate> CATALOGUE = List.of(
            new BuilderTemplate("clean", "Clean", 11, 19.1, 1, null, false),
            new BuilderTemplate("modern", "Modern", 11, 19.1, 1, null, false),
            new BuilderTemplate("compact", "Compact", 10, 12.7, 1, null, false),
            new BuilderTemplate("academic", "Academic", 11, 19.1, 1, null, false),
            new BuilderTemplate("classic", "Classic", 11, 19.1, 1, "classic", true),
            new BuilderTemplate("sidebar", "Sidebar", 10.5, 15, 2, null, false),
            new BuilderTemplate("executive", "Executive", 11, 19.1, 2, "serif", false));

    private BuilderTemplates() {
    }

    /** Every template, in the catalogue's fixed order. */
    public static List<BuilderTemplate> all() {
        return CATALOGUE;
    }

    /** @throws BadRequestException when there is no template with this id (a template is never guessed) */
    public static BuilderTemplate byId(String id) {
        for (BuilderTemplate template : CATALOGUE) {
            if (template.id().equals(id)) {
                return template;
            }
        }
        String known = String.join(", ", CATALOGUE.stream().map(BuilderTemplate::id).toList());
        throw new BadRequestException("There is no template '" + (id == null ? "" : id) + "'. Choose one of: " + known + ".");
    }

    /**
     * The format after choosing {@code template}: its size, margins and columns replace the person's, a template with its own
     * typeface sets it, one without keeps the person's (except that leaving Classic returns to sans), and every other setting
     * stays as it was.
     */
    public static BuilderFormat apply(BuilderTemplate template, BuilderFormat current) {
        String font = template.font() != null ? template.font() : "classic".equals(current.font()) ? "sans" : current.font();

        ObjectNode format = JSON.valueToTree(current);
        format.put("font", font);
        format.put("columns", template.columns());
        format.put("fontSize", template.fontSize());
        for (String key : new String[] {"marginTop", "marginBottom", "marginLeft", "marginRight"}) {
            format.put(key, template.margin());
        }
        return FormatNormalizer.normalize(format);
    }
}
