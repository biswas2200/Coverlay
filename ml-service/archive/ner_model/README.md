# Archived: the local resume NER model

> Status: archived (November 2026). The service no longer runs this code.
> Replaced by: Gemini extraction for every domain (`app/services/parser.py`).
> Why: the model often tagged the wrong span as a job title, company or degree,
> and it was the slowest step of an analysis on a CPU.
> The full story is in [`docs/archive/ner-model.md`](../../../docs/archive/ner-model.md).

Nothing here is deleted. The files keep the paths they had inside `ml-service/`,
so restoring one is a single `git mv` back.

## What is here

| File | What it did |
|---|---|
| `app/services/local_ner_parser.py` | Ran the fine-tuned `yashpwr/resume-ner-bert` model over the Experience and Education sections and turned its tags into a `ResumeProfile`. |
| `app/services/sectioner.py` | Split resume text into Skills / Experience / Education by heading, so the model only read those sections. |
| `app/services/gcs_download.py` | Downloaded the model folder from the project bucket at start-up (ADC) when it was missing. |
| `scripts/fetch_ner_models.sh` | Downloaded the teacher and student models by hand and checked their SHA-256. |
| `scripts/evaluate_ner_extraction.py` | Scored the parser against the 220 annotated DataTurks resumes. |
| `training/evaluate_model.py` | Plugged a trained model into the parser and scored it on the test sets (the harness behind `training/RESULTS.md`). |
| `tests/` | The unit tests for the files above. `pytest.ini` sets `testpaths = tests`, so they are not collected any more. |

The rest of the training pipeline that produced the model (`ml-service/training/`)
was left where it is: it is offline tooling and its tests still run. Only
`evaluate_model.py` moved here, because it needs the parser above.

The trained weights stay in the bucket:

- `gs://smart-resume-analyzer-a7x2-data/runs/teacher`: SHA-256 of `model.safetensors` `ab0fd6ea92dee31fed5e3f56a278197e8c55a358df19328a79981b00912fe189`
- `gs://smart-resume-analyzer-a7x2-data/runs/student`: `d51d3ca32c2199ebe5114a51dd48c7143f27c1abf6217d3e20333bf5b893d1c1`

## How to bring it back

1. Move the files back:

   ```bash
   cd ml-service
   git mv archive/ner_model/app/services/*.py app/services/
   git mv archive/ner_model/scripts/* scripts/
   git mv archive/ner_model/training/* training/
   git mv archive/ner_model/tests/* tests/
   ```

2. Add the settings it read back to `app/config.py`'s `Settings`:

   ```python
   ner_model_name: str = "models/ner/teacher-run1"
   ner_model_gcs_uri: str = ""
   ner_model_revision: str = "ab0fd6ea92dee31fed5e3f56a278197e8c55a358df19328a79981b00912fe189"
   ```

3. Call `local_ner_parser.ensure_local_model(settings)` from the FastAPI
   lifespan in `app/main.py`, so the model is downloaded before serving.

4. Route the domains it should serve to `parse_resume_local()` in
   `app/services/pipeline.py`, and set `NER_MODEL_GCS_URI` plus a volume for
   `/srv/models` in the compose files again.

The archived code still imports `app.services.dictionary_skills` and
`app.services.normalizer`, which are unchanged and still in the service.
