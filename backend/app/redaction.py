from functools import lru_cache

from gliner2 import GLiNER2
from presidio_anonymizer import AnonymizerEngine
from presidio_anonymizer.entities import OperatorConfig, RecognizerResult

# The Presidio entity type for each model label. The name labels share one type, so
# Presidio merges overlapping finds ("Alex Smith", "Alex", "Smith") into one [NAME].
ENTITY_TYPES = {
    "full_name": "NAME",
    "first_name": "NAME",
    "last_name": "NAME",
    "email": "EMAIL",
    "phone_number": "PHONE",
}

OPERATORS = {
    entity_type: OperatorConfig("replace", {"new_value": f"[{entity_type}]"})
    for entity_type in set(ENTITY_TYPES.values())
}

anonymizer = AnonymizerEngine()


def find_personal_details(model: GLiNER2, text: str) -> list[RecognizerResult]:
    """Where the model finds a name, email address or phone number in the text."""
    found = model.extract_entities(
        text, list(ENTITY_TYPES), include_spans=True, include_confidence=True
    )
    return [
        RecognizerResult(ENTITY_TYPES[label], span["start"], span["end"], span["confidence"])
        for label, spans in found["entities"].items()
        for span in spans
    ]


# The model takes about a second per question, and the questions don't change
@lru_cache(maxsize=1024)
def redact(model: GLiNER2, text: str) -> str:
    """The text with each name, email address and phone number replaced by a placeholder."""
    return anonymizer.anonymize(text, find_personal_details(model, text), OPERATORS).text
