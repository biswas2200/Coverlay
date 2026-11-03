"""A rules-only profile: name, email, phone and dictionary skills, with no
model and no network call. Two jobs:

1. The profile card of a locked result (services/pipeline.py), when the AI
   engine cannot run for this request (LLM_PROVIDER=none, or the daily
   budget is spent): the user still sees who the resume belongs to and
   which skills it names, just no role matches.
2. Filling the contact fields Gemini left empty (a phone number inside a
   header graphic's text layer, say), via extract_name/email/phone.

Experience and education stay empty here: no rule is safe enough across
resume layouts to split jobs and degrees, which is why the archived NER
model existed (docs/archive/ner-model.md) and why Gemini now does it.
"""

import re

from app.models.schemas import ResumeProfile
from app.services.dictionary_skills import GENERAL_TAXONOMY_PATH, find_skills
from app.services.normalizer import normalize_skills

# One unbounded character class on each side of the "@": this runs on
# uploaded text, so no nested quantifiers that could backtrack badly.
_EMAIL_RE = re.compile(r"[\w.+-]+@[\w.-]+")
# The first branch is the Indian mobile written as two groups of five
# ("+91 98765 43210"); the second covers 3/4-digit groupings.
_PHONE_RE = re.compile(
    r"(?:\+?\d{1,3}[-.\s]?)?(?:\d{5}[-.\s]\d{5}|\(?\d{3,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4})"
)

# A name line: 2-4 words of letters (any script, so "José García" counts)
# plus dots, apostrophes and hyphens, within the first few non-empty lines,
# and none of the words that mark a heading or a job title.
_NAME_SEARCH_LINES = 3
_NAME_WORD = r"[^\W\d_](?:[^\W\d_]|[.'-])*"
_NAME_LINE_RE = re.compile(rf"{_NAME_WORD}(?: {_NAME_WORD}){{1,3}}")
_NOT_NAME_WORDS = {
    "resume", "curriculum", "vitae", "cv", "profile", "biodata", "summary", "objective", "contact",
    "experience", "education", "skills", "details", "personal",
    "engineer", "developer", "manager", "analyst", "consultant", "designer", "associate", "intern",
    "specialist", "executive", "officer", "lead", "architect", "administrator", "scientist", "director",
}


def basic_profile(resume_text: str) -> ResumeProfile:
    """Contact fields plus every skill either taxonomy finds in the text."""
    skills = normalize_skills(
        [*find_skills(resume_text), *find_skills(resume_text, GENERAL_TAXONOMY_PATH)], include_general=True
    )
    return ResumeProfile(
        name=extract_name(resume_text),
        email=extract_email(resume_text),
        phone=extract_phone(resume_text),
        skills=skills,
    )


def extract_name(text: str) -> str:
    """The first of the opening lines that looks like a person's name, or ""."""
    lines = (" ".join(line.split()) for line in text.splitlines())
    for line in [line for line in lines if line][:_NAME_SEARCH_LINES]:
        words = line.split(" ")
        if not _NAME_LINE_RE.fullmatch(line):
            continue
        if any(word.lower().strip(".") in _NOT_NAME_WORDS for word in words):
            continue
        if all(word[0].isupper() for word in words):
            return line
    return ""


def extract_email(text: str) -> str:
    match = _EMAIL_RE.search(text)
    return match.group(0) if match else ""


def extract_phone(text: str) -> str:
    match = _PHONE_RE.search(text)
    return match.group(0) if match else ""
