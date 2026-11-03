"""basic_profile.py -- the rules-only profile card of a locked result, and
the contact rules that fill what Gemini leaves empty. Pure functions over
text, no model (the cases come from the archived NER parser's tests, where
these rules started)."""

from app.services.basic_profile import basic_profile, extract_email, extract_name, extract_phone


def test_extract_name_takes_the_first_line_when_it_looks_like_a_name():
    assert extract_name("Abhishek Jha\nApplication Development Associate - Accenture") == "Abhishek Jha"


def test_extract_name_accepts_all_caps_and_accented_names():
    assert extract_name("  JOHN   SMITH  \nBackend Engineer") == "JOHN SMITH"
    assert extract_name("José García\nMadrid") == "José García"


def test_extract_name_skips_title_lines_and_headings():
    assert extract_name("Curriculum Vitae\nPriya Sharma\npriya@example.com") == "Priya Sharma"
    assert extract_name("Senior Software Engineer\nExperience\nAcme") == ""


def test_extract_name_rejects_lines_with_digits_or_email():
    assert extract_name("priya@example.com\n+91 98765 43210\nPune, India") == ""


def test_extract_email_finds_the_first_address():
    assert extract_email("Contact: jane.doe@example.com for more info") == "jane.doe@example.com"
    assert extract_email("Contact: jane dot doe at example dot com") == ""


def test_extract_phone_reads_indian_numbers_written_in_two_groups_of_five():
    for written in ("+91 98765 43210", "98765-43210", "+91 9876543210", "9876543210"):
        assert extract_phone(f"Priya Sharma\n{written} | Bengaluru") == written


def test_extract_phone_still_reads_us_style_numbers_and_skips_years():
    assert extract_phone("Call +1 (555) 123-4567") == "+1 (555) 123-4567"
    assert extract_phone("B.Tech (2016 - 2020), Jun 2022 - Present") == ""


def test_basic_profile_has_contact_fields_and_dictionary_skills_from_both_taxonomies():
    text = (
        "Anita Desai\nanita@example.com | +91 98765 43210\n"
        "Skills: Python, SQL, Patient Care, BLS\n"
        "Experience\nStaff Nurse, Apollo Hospitals, 2019-2024"
    )

    profile = basic_profile(text)

    assert (profile.name, profile.email, profile.phone) == ("Anita Desai", "anita@example.com", "+91 98765 43210")
    assert {"Python", "SQL"} <= set(profile.skills)  # engineering taxonomy
    assert any(skill.lower() == "patient care" for skill in profile.skills)  # all-domain taxonomy
    assert profile.experience == [] and profile.education == []  # no rule splits jobs or degrees
