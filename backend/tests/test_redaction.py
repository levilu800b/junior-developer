from app.redaction import redact


class FakeModel:
    """Stands in for GLiNER2, returning set finds so the tests don't need the real model."""

    def __init__(self, text: str, finds: dict[str, list[str]]):
        self.entities = {
            label: [
                {"text": find, "confidence": 0.99, "start": text.index(find), "end": text.index(find) + len(find)}
                for find in label_finds
            ]
            for label, label_finds in finds.items()
        }

    def extract_entities(self, text, entity_types, **kwargs):
        assert kwargs["include_spans"] is True
        return {"entities": self.entities}


def test_replaces_each_kind_of_detail():
    text = "Call Alex Smith on 07700 900000 or email alex.smith@example.com."
    model = FakeModel(
        text,
        {"full_name": ["Alex Smith"], "phone_number": ["07700 900000"], "email": ["alex.smith@example.com"]},
    )

    assert redact(model, text) == "Call [NAME] on [PHONE] or email [EMAIL]."


def test_overlapping_names_become_one_placeholder():
    text = "Call Alex Smith today."
    model = FakeModel(text, {"full_name": ["Alex Smith"], "first_name": ["Alex"], "last_name": ["Smith"]})

    assert redact(model, text) == "Call [NAME] today."


def test_first_and_last_name_found_separately_become_one_placeholder():
    text = "Call Alex Smith today."
    model = FakeModel(text, {"first_name": ["Alex"], "last_name": ["Smith"]})

    assert redact(model, text) == "Call [NAME] today."


def test_part_of_a_name_scored_higher_than_the_whole_name_is_still_one_placeholder():
    text = "Call Alex Smith today."
    model = FakeModel(text, {"full_name": ["Alex Smith"], "first_name": ["Alex"]})
    model.entities["full_name"][0]["confidence"] = 0.6

    assert redact(model, text) == "Call [NAME] today."


def test_text_without_details_is_unchanged():
    text = "What benefits can my client get?"

    assert redact(FakeModel(text, {}), text) == text
