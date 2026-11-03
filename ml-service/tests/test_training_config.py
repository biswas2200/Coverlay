"""Checks the NER training configuration against the models it names: the
student must split text into exactly the teacher's tokens, or token-by-token
distillation compares mismatched positions. (The service no longer serves the
trained model -- see archive/ner_model/README.md -- but the training code is
kept and still tested.)"""

import pytest

from training.config import ner_config


def test_training_starts_from_the_upstream_model():
    # The 60 % / 64 % baselines in training/RESULTS.md are this model's.
    assert ner_config.base_model == "yashpwr/resume-ner-bert"


def _cached_tokenizer(repo: str, revision: str):
    transformers = pytest.importorskip("transformers")
    try:
        return transformers.AutoTokenizer.from_pretrained(repo, revision=revision, local_files_only=True)
    except OSError:
        pytest.skip(f"{repo} tokenizer not cached on this machine")


def test_student_splits_resume_text_exactly_like_the_teacher():
    teacher = _cached_tokenizer(ner_config.base_model, ner_config.base_model_revision)
    student = _cached_tokenizer(ner_config.student_model, ner_config.student_model_revision)
    text = "Abhishek Jha\nB.Tech - Computer Science, IIT Delhi (2016)\nSAP ABAP | McKinsey & Company | São Paulo"
    assert student.tokenize(text) == teacher.tokenize(text)
    assert student.get_vocab() == teacher.get_vocab()
